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
import { RoundRobinRoutingStrategy } from './routing/round-robin.js';
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

export type GatewaySelection =
  | 'best-performance'
  | 'most-tenured'
  | 'highest-staked'
  | 'top-ranked'
  | 'longest-streak';

export type SortBy =
  | 'totalDelegatedStake'
  | 'operatorStake'
  | 'startTimestamp'
  | 'weights.gatewayPerformanceRatio'
  | 'weights.tenureWeight'
  | 'weights.stakeWeight'
  | 'weights.compositeWeight'
  | 'stats.passedConsecutiveEpochs'
  | 'weights.normalizedCompositeWeight';

export type SortOrder = 'asc' | 'desc';

const selectionSortMap: Record<
  GatewaySelection,
  { sortBy: SortBy; sortOrder: SortOrder }
> = {
  'best-performance': {
    sortBy: 'weights.gatewayPerformanceRatio',
    sortOrder: 'desc',
  },
  'most-tenured': { sortBy: 'weights.tenureWeight', sortOrder: 'desc' },
  'highest-staked': { sortBy: 'weights.stakeWeight', sortOrder: 'desc' },
  'top-ranked': {
    sortBy: 'weights.normalizedCompositeWeight',
    sortOrder: 'desc',
  },
  'longest-streak': {
    sortBy: 'stats.passedConsecutiveEpochs',
    sortOrder: 'desc',
  },
};

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
   * The gateway selection when using NetworkGatewaysProvider (requires ario instance)
   * Only applies when using AR.IO network - ignored for static gateways
   * @default 'highest-performing'
   */
  gatewaySelection?: GatewaySelection;

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

  /**
   * The preferred gateway to use when routing is 'preferred'
   * Defaults to the first trusted gateway if not specified
   */
  preferredGateway?: string;

  /**
   * The fallback routing strategy to use when routing is 'preferred'
   * @default 'random'
   */
  fallbackStrategy?: RoutingOption;
}

/**
 * Helper function to construct a routing strategy
 * @param strategy - The routing strategy to use
 * @param config
 * @returns
 */
export const useRoutingStrategy = (
  strategy: RoutingOption,
  config?: any,
): RoutingStrategy => {
  const routingMap: Record<RoutingOption, RoutingStrategy> = {
    random: new RandomRoutingStrategy(config),
    fastest: new FastestPingRoutingStrategy(config),
    preferred: new PreferredWithFallbackRoutingStrategy(config),
    'round-robin': new RoundRobinRoutingStrategy(config),
  };
  return routingMap[strategy];
};

/**
 * Helper function to construct a verification strategy
 * @param strategy - The verification strategy to use
 * @param config - The configuration to use
 * @returns
 */
export const useVerificationStrategy = (
  strategy: VerificationOption,
  config?: any,
): VerificationStrategy => {
  const verificationMap: Record<VerificationOption, VerificationStrategy> = {
    hash: new HashVerificationStrategy(config),
    'data-root': new DataRootVerificationStrategy(config),
    remote: new RemoteVerificationStrategy(),
    disabled: undefined as unknown as VerificationStrategy,
  };
  return verificationMap[strategy];
};

/**
 * Creates a Wayfinder client with the specified configuration
 * Uses static gateways by default. Provide an `ario` instance to use NetworkGatewaysProvider
 */
export function createWayfinderClient(
  options: CreateWayfinderClientOptions = {},
): Wayfinder {
  const {
    routing = 'random',
    verification = 'disabled',
    trustedGateways = ['https://permagate.io'],
    cache = false,
    gatewaySelection = 'top-ranked',
    logger,
    ario,
    gatewaysProvider: customGatewaysProvider,
    routingStrategy: customRoutingStrategy,
    verificationStrategy: customVerificationStrategy,
    preferredGateway = 'arweave.net',
    fallbackStrategy = 'random',
  } = options;

  // Parse cache configuration
  const cacheEnabled = !!cache;
  const cacheTTLSeconds = typeof cache === 'object' ? cache.ttlSeconds : 300; // 5 minutes default

  // Set up gateways provider
  let gatewaysProvider: GatewaysProvider;
  if (customGatewaysProvider) {
    gatewaysProvider = customGatewaysProvider;
  } else if (ario) {
    const { sortBy, sortOrder } = selectionSortMap[gatewaySelection];
    gatewaysProvider = new NetworkGatewaysProvider({
      ario,
      sortBy,
      sortOrder,
      limit: 10,
    });
  } else {
    // Fall back to static gateways when no ARIO instance is provided
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

  // Set up routing strategy
  let routingStrategy: RoutingStrategy;
  if (customRoutingStrategy) {
    routingStrategy = customRoutingStrategy;
  } else {
    routingStrategy = useRoutingStrategy(routing, {
      preferredGateway,
      fallbackStrategy,
    });

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
  const verificationEnabled = true;

  if (customVerificationStrategy) {
    verificationStrategy = customVerificationStrategy;
  } else {
    verificationStrategy = useVerificationStrategy(verification, {
      trustedGateways: trustedGateways.map((url) => new URL(url)),
    });
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

export const createWayfinder = createWayfinderClient;
