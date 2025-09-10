/**
 * WayFinder
 * Copyright (C) 2022-2025 Permanent Data Solutions, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type { AoARIORead } from '@ar.io/sdk';
import { LocalStorageGatewaysProvider } from './gateways/local-storage-cache.js';
import { NetworkGatewaysProvider } from './gateways/network.js';
import { SimpleCacheGatewaysProvider } from './gateways/simple-cache.js';
import { StaticGatewaysProvider } from './gateways/static.js';
import { FastestPingRoutingStrategy } from './routing/ping.js';
import { PreferredWithFallbackRoutingStrategy } from './routing/preferred-with-fallback.js';
import { RandomRoutingStrategy } from './routing/random.js';
import { SimpleCacheRoutingStrategy } from './routing/simple-cache.js';
import type {
  GatewaysProvider,
  Logger,
  RoutingStrategy,
  VerificationStrategy,
  WayfinderOptions,
} from './types.js';
import { isBrowser } from './utils/browser.js';
import { DataRootVerificationStrategy } from './verification/data-root-verification.js';
import { HashVerificationStrategy } from './verification/hash-verification.js';
import { RemoteVerificationStrategy } from './verification/remote-verification.js';
import { Wayfinder } from './wayfinder.js';

export type RoutingOption = 'random' | 'fastest' | 'round-robin' | 'preferred';

export type VerificationOption = 'hash' | 'data-root' | 'remote' | 'disabled';

export type GatewaysOption =
  | 'highest-performing'
  | 'longest-tenure'
  | 'highest-staked'
  | 'highest-weight'
  | 'longest-streak';

/**
 * Attempts to load the AR.IO SDK and create an ARIO instance
 * Returns null if the SDK is not available, allowing fallback to static gateways
 */
function tryCreateDefaultARIO(): AoARIORead | null {
  try {
    // Try to require the SDK - this works in Node.js environments
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { ARIO } = require('@ar.io/sdk');
    return ARIO.mainnet();
  } catch {
    // SDK not available, will fall back to static gateways
    return null;
  }
}

export interface CreateWayfinderClientOptions {
  /**
   * The ARIO instance to use for network gateways provider
   * If not provided, will fall back to static gateways
   */
  ario?: AoARIORead;
  /**
   * The routing strategy to use
   * @default 'random'
   */
  routing?: RoutingOption;

  /**
   * The verification strategy to use
   * @default 'disabled'
   */
  verification?: VerificationOption;

  /**
   * The gateways criteria
   * @default 'highest-performing'
   */
  gateways?: GatewaysOption;

  /**
   * The trusted gateways to use
   * @default ['https://arweave.net']
   */
  trustedGateways?: string[];

  /**
   * Cache configuration. Can be:
   * - false/undefined: No caching
   * - true: Enable caching with default TTL (300 seconds)
   * - { ttlSeconds: number }: Enable caching with custom TTL
   * @default false
   */
  cache?: boolean | { ttlSeconds: number };

  /**
   * Custom logger implementation
   */
  logger?: Logger;

  /**
   * Custom gateways provider (overrides gatewaySelection)
   */
  gatewaysProvider?: GatewaysProvider;

  /**
   * Custom routing strategy (overrides routing option)
   */
  routingStrategy?: RoutingStrategy;

  /**
   * Custom verification strategy (overrides verification option)
   */
  verificationStrategy?: VerificationStrategy;
}

/**
 * Creates a Wayfinder client with the specified configuration
 * Defaults to using NetworkGatewaysProvider with AR.IO mainnet
 */
export function createWayfinderClient(
  options: CreateWayfinderClientOptions = {},
): Wayfinder {
  const {
    routing = 'random',
    verification = 'disabled',
    trustedGateways = [],
    cache = false,
    gateways = 'highest-performing',
    logger,
    ario,
    gatewaysProvider: customGatewaysProvider,
    routingStrategy: customRoutingStrategy,
    verificationStrategy: customVerificationStrategy,
  } = options;

  // Parse cache configuration
  const cacheEnabled = !!cache;
  const cacheTTLSeconds = typeof cache === 'object' ? cache.ttlSeconds : 300; // 5 minutes default

  // Set up gateways provider
  let gatewaysProvider: GatewaysProvider;
  if (customGatewaysProvider) {
    gatewaysProvider = customGatewaysProvider;
  } else {
    // Try to use NetworkGatewaysProvider with AR.IO mainnet, fall back to static gateways
    const arIOInstance = ario || tryCreateDefaultARIO();

    if (arIOInstance) {
      // Use NetworkGatewaysProvider when AR.IO SDK is available
      let sortBy:
        | 'totalDelegatedStake'
        | 'operatorStake'
        | 'startTimestamp'
        | 'weights.gatewayPerformanceRatio'
        | 'weights.tenureWeight'
        | 'weights.stakeWeight'
        | 'weights.compositeWeight'
        | 'stats.passedConsecutiveEpochs'
        | 'weights.normalizedCompositeWeight' = 'totalDelegatedStake';
      let sortOrder: 'asc' | 'desc' = 'desc';
      switch (gateways) {
        case 'highest-performing':
          sortBy = 'weights.gatewayPerformanceRatio';
          sortOrder = 'desc';
          break;
        case 'longest-tenure':
          sortBy = 'weights.tenureWeight';
          sortOrder = 'desc';
          break;
        case 'highest-staked':
          sortBy = 'weights.stakeWeight';
          sortOrder = 'desc';
          break;
        case 'highest-weight':
          sortBy = 'weights.normalizedCompositeWeight';
          sortOrder = 'desc';
          break;
        case 'longest-streak':
          sortBy = 'stats.passedConsecutiveEpochs';
          sortOrder = 'desc';
          break;
        default:
          sortBy = 'weights.normalizedCompositeWeight';
          sortOrder = 'desc';
          break;
      }
      gatewaysProvider = new NetworkGatewaysProvider({
        ario: arIOInstance,
        sortBy,
        sortOrder,
        limit: 10,
      });
    } else {
      // Fall back to static gateways when AR.IO SDK is not available
      gatewaysProvider = new StaticGatewaysProvider({
        gateways: trustedGateways.length
          ? trustedGateways
          : [
              'https://permagate.io',
              'https://arweave.net',
              'https://ardrive.net',
            ],
      });
    }

    // Wrap with cache if enabled
    if (cacheEnabled) {
      if (isBrowser()) {
        gatewaysProvider = new LocalStorageGatewaysProvider({
          gatewaysProvider: gatewaysProvider,
          ttlSeconds: cacheTTLSeconds,
        });
      } else {
        gatewaysProvider = new SimpleCacheGatewaysProvider({
          gatewaysProvider: gatewaysProvider,
          ttlSeconds: cacheTTLSeconds,
        });
      }
    }
  }

  // Set up routing strategy
  let routingStrategy: RoutingStrategy;
  if (customRoutingStrategy) {
    routingStrategy = customRoutingStrategy;
  } else {
    switch (routing) {
      case 'random':
        routingStrategy = new RandomRoutingStrategy();
        break;
      case 'fastest':
        routingStrategy = new FastestPingRoutingStrategy();
        break;
      case 'preferred':
        routingStrategy = new PreferredWithFallbackRoutingStrategy({
          preferredGateway: trustedGateways[0],
          fallbackStrategy: new RandomRoutingStrategy(),
        });
        break;
      default:
        throw new Error(`Unknown routing strategy: ${routing}`);
    }

    // Wrap with cache if enabled
    if (cacheEnabled) {
      // TODO: add browser cache support for routing strategy
      routingStrategy = new SimpleCacheRoutingStrategy({
        routingStrategy,
        ttlSeconds: cacheTTLSeconds,
      });
    }
  }

  // Set up verification strategy
  let verificationStrategy: VerificationStrategy | undefined;
  let verificationEnabled = true;

  if (customVerificationStrategy) {
    verificationStrategy = customVerificationStrategy;
  } else {
    switch (verification) {
      case 'hash':
        verificationStrategy = new HashVerificationStrategy({
          trustedGateways: trustedGateways.map((url) => new URL(url)),
        });
        break;
      case 'data-root':
        verificationStrategy = new DataRootVerificationStrategy({
          trustedGateways: trustedGateways.map((url) => new URL(url)),
        });
        break;
      case 'remote':
        verificationStrategy = new RemoteVerificationStrategy();
        break;
      case 'disabled':
        verificationEnabled = false;
        verificationStrategy = undefined;
        break;
      default:
        throw new Error(`Unknown verification strategy: ${verification}`);
    }
  }

  // Create Wayfinder options
  const wayfinderOptions: WayfinderOptions = {
    logger,
    gatewaysProvider,
    routingSettings: {
      strategy: routingStrategy,
    },
  };

  // Only add verification settings if not disabled
  if (verificationEnabled && verificationStrategy) {
    wayfinderOptions.verificationSettings = {
      enabled: true,
      strategy: verificationStrategy,
    };
  } else {
    wayfinderOptions.verificationSettings = {
      enabled: false,
    };
  }

  return new Wayfinder(wayfinderOptions);
}

// Re-export as an alias
export const createWayfinder = createWayfinderClient;
