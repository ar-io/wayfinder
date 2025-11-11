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

import { LocalStorageGatewaysProvider } from './gateways/local-storage-cache.js';
import { SimpleCacheGatewaysProvider } from './gateways/simple-cache.js';
import { TrustedPeersGatewaysProvider } from './gateways/trusted-peers.js';
import { defaultLogger } from './logger.js';
import { FastestPingRoutingStrategy } from './routing/ping.js';
import { PreferredWithFallbackRoutingStrategy } from './routing/preferred-with-fallback.js';
import { RandomRoutingStrategy } from './routing/random.js';
import { RoundRobinRoutingStrategy } from './routing/round-robin.js';
import type {
  GatewaysProvider,
  Logger,
  RoutingOption,
  RoutingStrategy,
  VerificationOption,
  VerificationStrategy,
  WayfinderFetchOptions,
  WayfinderOptions,
} from './types.js';
import { isBrowser } from './utils/browser.js';
import {
  convertFetchOptionsToSettings,
  isWayfinderFetchOptions,
} from './utils/config.js';
import { DataRootVerificationStrategy } from './verification/data-root-verification.js';
import { HashVerificationStrategy } from './verification/hash-verification.js';
import { RemoteVerificationStrategy } from './verification/remote-verification.js';
import { Wayfinder } from './wayfinder.js';

const DEFAULT_TRUSTED_GATEWAY = 'https://permagate.io';

/**
 * Helper function to construct a routing strategy
 */
export const createRoutingStrategy = ({
  strategy,
  gatewaysProvider,
  logger,
}: {
  strategy: RoutingOption;
  gatewaysProvider?: GatewaysProvider;
  logger?: Logger;
}): RoutingStrategy => {
  const baseConfig = { gatewaysProvider, logger };

  switch (strategy) {
    case 'random':
      return new RandomRoutingStrategy(baseConfig);

    case 'fastest':
      return new FastestPingRoutingStrategy(baseConfig);

    case 'balanced':
      return new RoundRobinRoutingStrategy(baseConfig);

    case 'preferred':
      return new PreferredWithFallbackRoutingStrategy({
        preferredGateway: 'https://arweave.net',
        fallbackStrategy: createRoutingStrategy({
          strategy: 'fastest',
          gatewaysProvider,
          logger,
        }),
      });
  }
};

/**
 * Helper function to construct a verification strategy
 */
export const createVerificationStrategy = ({
  strategy,
  logger,
  trustedGateways = [new URL('https://permagate.io')],
}: {
  strategy: VerificationOption;
  logger?: Logger;
  trustedGateways?: URL[];
}): VerificationStrategy => {
  const verificationMap: Record<VerificationOption, VerificationStrategy> = {
    hash: new HashVerificationStrategy({ logger, trustedGateways }),
    'data-root': new DataRootVerificationStrategy({ logger, trustedGateways }),
    remote: new RemoteVerificationStrategy(),
    disabled: undefined as unknown as VerificationStrategy,
  };
  return verificationMap[strategy];
};

/**
 * Helper function to create a cached gateways provider
 */
const createCachedGatewaysProvider = ({
  logger,
  ttlSeconds = 300,
  gatewaysProvider,
}: {
  logger: Logger;
  ttlSeconds?: number;
  gatewaysProvider?: GatewaysProvider;
}): GatewaysProvider => {
  const baseProvider =
    gatewaysProvider ??
    new TrustedPeersGatewaysProvider({
      trustedGateway: DEFAULT_TRUSTED_GATEWAY,
      logger,
    });

  // Use localStorage cache in browser, simple cache in Node.js
  if (isBrowser()) {
    return new LocalStorageGatewaysProvider({
      gatewaysProvider: baseProvider,
      ttlSeconds,
      logger,
    });
  } else {
    return new SimpleCacheGatewaysProvider({
      gatewaysProvider: baseProvider,
      ttlSeconds,
      logger,
    });
  }
};

/**
 * Creates a Wayfinder client with the specified configuration.
 * Uses the trusted peers gateways provider with caching and random routing by default.
 *
 * @param options - Either WayfinderOptions or WayfinderFetchOptions configuration
 * @returns A configured Wayfinder instance
 */
export function createWayfinderClient(
  options: WayfinderOptions | WayfinderFetchOptions = {},
): Wayfinder {
  // Convert WayfinderFetchOptions to WayfinderOptions if needed
  const wayfinderOptions = isWayfinderFetchOptions(options)
    ? convertFetchOptionsToSettings(options)
    : options;

  const {
    logger,
    fetch,
    routingSettings,
    verificationSettings,
    telemetrySettings,
  } = wayfinderOptions;

  const resolvedLogger = logger ?? defaultLogger;

  // If no routing settings provided, create default ones with cached gateways provider
  const finalRoutingSettings = routingSettings ?? {
    strategy: new RandomRoutingStrategy({
      gatewaysProvider: createCachedGatewaysProvider({
        logger: resolvedLogger,
      }),
      logger: resolvedLogger,
    }),
  };

  // Create final options
  const finalOptions: WayfinderOptions = {
    logger: resolvedLogger,
    fetch,
    routingSettings: finalRoutingSettings,
    verificationSettings,
    telemetrySettings,
    dataRetrievalStrategy: wayfinderOptions.dataRetrievalStrategy,
  };

  return new Wayfinder(finalOptions);
}

export const createWayfinder = createWayfinderClient;
