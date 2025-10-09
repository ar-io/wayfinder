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
import { SimpleCacheGatewaysProvider } from './gateways/simple-cache.js';
import { TrustedPeersGatewaysProvider } from './gateways/trusted-peers.js';
import { defaultLogger } from './logger.js';
import { FastestPingRoutingStrategy } from './routing/ping.js';
import { PreferredWithFallbackRoutingStrategy } from './routing/preferred-with-fallback.js';
import { RandomRoutingStrategy } from './routing/random.js';
import { RoundRobinRoutingStrategy } from './routing/round-robin.js';
import { SimpleCacheRoutingStrategy } from './routing/simple-cache.js';
import type {
  GatewaySelection,
  GatewaysProvider,
  Logger,
  RoutingOption,
  RoutingStrategy,
  TelemetrySettings,
  VerificationOption,
  VerificationStrategy,
  WayfinderOptions,
} from './types.js';
import { isBrowser } from './utils/browser.js';
import { DataRootVerificationStrategy } from './verification/data-root-verification.js';
import { HashVerificationStrategy } from './verification/hash-verification.js';
import { RemoteVerificationStrategy } from './verification/remote-verification.js';
import { Wayfinder } from './wayfinder.js';

const DEFAULT_TRUSTED_GATEWAY = 'https://permagate.io';

const warnDeprecatedOption = (
  logger: Logger,
  option: string,
  guidance: string,
) => {
  logger.warn(
    `[wayfinder] The \`${option}\` option for createWayfinderClient() is deprecated. ${guidance}`,
  );
};

export interface CreateWayfinderClientOptions {
  /**
   * The ARIO instance to use for network gateways provider
   * If not provided, will fall back to static gateways
   * @deprecated Provide a custom `gatewaysProvider` instead.
   */
  ario?: AoARIORead;
  /**
   * The routing strategy to use
   * @default 'random'
   * @deprecated Provide a `routingStrategy` instance instead.
   */
  routing?: RoutingOption;

  /**
   * The verification strategy to use
   * @default 'disabled'
   * @deprecated Provide a `verificationStrategy` instance instead.
   */
  verification?: VerificationOption;

  /**
   * The gateway selection when using NetworkGatewaysProvider (requires ario instance)
   * Only applies when using AR.IO network - ignored for static gateways
   * @default 'top-ranked'
   * @deprecated Configure gateway selection via your custom `gatewaysProvider`.
   */
  gatewaySelection?: GatewaySelection;

  /**
   * The trusted gateways to use
   * @default ['https://permagate.io']
   * @deprecated Configure trusted gateways via your `verificationStrategy`.
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
   * @default undefined
   */
  logger?: Logger;

  /**
   * Custom gateways provider (overrides gatewaySelection)
   * @default undefined
   * @deprecated Instantiate `Wayfinder` directly when providing custom gateways providers.
   */
  gatewaysProvider?: GatewaysProvider;

  /**
   * Custom routing strategy (overrides routing option)
   * @default undefined
   */
  routingStrategy?: RoutingStrategy;

  /**
   * Custom verification strategy (overrides verification option)
   * @default undefined
   */
  verificationStrategy?: VerificationStrategy;

  /**
   * The preferred gateway to use when routing is 'preferred'
   * Defaults to the first trusted gateway if not specified
   * @default 'arweave.net'
   */
  preferredGateway?: string;

  /**
   * The fallback routing strategy to use when routing is 'preferred'
   * @default 'random'
   * @deprecated Compose fallback behavior directly in your `routingStrategy`.
   */
  fallbackStrategy?: RoutingOption | RoutingStrategy;

  /**
   * Telemetry configuration for OpenTelemetry tracing
   * @default { enabled: false }
   */
  telemetry?: TelemetrySettings;
}

/**
 * Helper function to construct a routing strategy
 * @param strategy - The routing strategy to use
 * @param config
 * @returns
 */
type UseRoutingStrategyConfig = {
  gatewaysProvider?: GatewaysProvider;
  logger?: Logger;
  preferredGateway?: string;
  fallbackStrategy?: RoutingStrategy;
};

export const useRoutingStrategy = (
  strategy: RoutingOption,
  config: UseRoutingStrategyConfig = {},
): RoutingStrategy => {
  const { fallbackStrategy, preferredGateway, ...baseConfig } = config;

  const resolvedFallbackStrategy =
    fallbackStrategy ?? new FastestPingRoutingStrategy(baseConfig);

  const routingMap: Record<RoutingOption, RoutingStrategy> = {
    random: new RandomRoutingStrategy(baseConfig),
    fastest: new FastestPingRoutingStrategy(baseConfig),
    preferred: new PreferredWithFallbackRoutingStrategy({
      preferredGateway: preferredGateway ?? 'https://arweave.net',
      fallbackStrategy: resolvedFallbackStrategy,
      logger: config.logger,
    }),
    'round-robin': new RoundRobinRoutingStrategy(baseConfig),
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
 * Creates a Wayfinder client with the specified configuration.
 * Uses the trusted peers gateways provider and random routing by default.
 */
export function createWayfinderClient(
  options: CreateWayfinderClientOptions = {},
): Wayfinder {
  const {
    cache = false,
    logger,
    routingStrategy: customRoutingStrategy,
    verificationStrategy: customVerificationStrategy,
    telemetry,
  } = options;

  const resolvedLogger = logger ?? defaultLogger;
  const deprecatedGuidance: Array<
    [keyof CreateWayfinderClientOptions, string]
  > = [
    ['routing', 'Provide a `routingStrategy` instance instead.'],
    ['verification', 'Provide a `verificationStrategy` instance instead.'],
    [
      'gatewaySelection',
      'Configure gateway selection via your custom `routingStrategy`.',
    ],
    [
      'gatewaysProvider',
      'Instantiate `Wayfinder` directly when providing custom gateways providers.',
    ],
    [
      'fallbackStrategy',
      'Compose fallback behavior directly in your `routingStrategy`.',
    ],
    [
      'preferredGateway',
      'Configure preferred gateways within your `routingStrategy`.',
    ],
    [
      'ario',
      'Instantiate `Wayfinder` directly and supply your own gateways provider.',
    ],
    [
      'trustedGateways',
      'Configure trusted gateways via your `verificationStrategy`.',
    ],
  ];

  for (const [option, guidance] of deprecatedGuidance) {
    if (Object.prototype.hasOwnProperty.call(options, option)) {
      warnDeprecatedOption(resolvedLogger, option, guidance);
    }
  }

  // Parse cache configuration
  const cacheEnabled = !!cache;
  const cacheTTLSeconds = typeof cache === 'object' ? cache.ttlSeconds : 300; // 5 minutes default

  // Set up gateways provider
  let gatewaysProvider: GatewaysProvider = new TrustedPeersGatewaysProvider({
    trustedGateway: DEFAULT_TRUSTED_GATEWAY,
    logger: resolvedLogger,
  });

  // Wrap with cache if enabled
  if (cacheEnabled) {
    if (isBrowser()) {
      gatewaysProvider = new LocalStorageGatewaysProvider({
        gatewaysProvider: gatewaysProvider,
        ttlSeconds: cacheTTLSeconds,
        logger: resolvedLogger,
      });
    } else {
      gatewaysProvider = new SimpleCacheGatewaysProvider({
        gatewaysProvider: gatewaysProvider,
        ttlSeconds: cacheTTLSeconds,
        logger: resolvedLogger,
      });
    }
  }

  // Set up routing strategy
  let routingStrategy: RoutingStrategy;
  if (customRoutingStrategy) {
    routingStrategy = customRoutingStrategy;
  } else {
    routingStrategy = useRoutingStrategy('random', {
      gatewaysProvider,
      logger: resolvedLogger,
    });

    // Wrap with cache if enabled
    if (cacheEnabled) {
      // TODO: add browser cache support for routing strategy
      routingStrategy = new SimpleCacheRoutingStrategy({
        routingStrategy,
        ttlSeconds: cacheTTLSeconds,
        logger: resolvedLogger,
      });
    }
  }

  // Set up verification strategy
  const verificationStrategy: VerificationStrategy | undefined =
    customVerificationStrategy;

  // Create Wayfinder options
  const wayfinderOptions: WayfinderOptions = {
    logger: resolvedLogger,
    gatewaysProvider,
    routingSettings: {
      strategy: routingStrategy,
    },
    telemetrySettings: telemetry,
  };

  // Only add verification settings if not disabled
  if (verificationStrategy) {
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
