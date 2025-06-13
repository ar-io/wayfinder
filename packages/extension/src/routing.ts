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

import {
  DataRootVerificationStrategy,
  DataVerificationStrategy,
  FastestPingRoutingStrategy,
  GatewaysProvider,
  HashVerificationStrategy,
  Logger,
  RandomRoutingStrategy,
  RoundRobinRoutingStrategy,
  RoutingStrategy,
  StaticRoutingStrategy,
  TrustedGatewaysProvider,
  Wayfinder,
} from '@ar.io/wayfinder-core';
import { ChromeStorageGatewayProvider } from './adapters/chrome-storage-gateway-provider';
import {
  DEFAULT_GATEWAY,
  DNS_LOOKUP_API,
  GASLESS_ARNS_DNS_EXPIRATION_TIME,
  HIGHEST_STAKE_ROUTE_METHOD,
  OPTIMAL_GATEWAY_ROUTE_METHOD,
  RANDOM_ROUTE_METHOD,
  WEIGHTED_ONCHAIN_PERFORMANCE_ROUTE_METHOD,
} from './constants';
import { fetchEnsArweaveTxId } from './ens';

/**
 * Extension-specific logger that writes to console with proper prefixes
 */
class ExtensionLogger implements Logger {
  debug(message: string, ...args: any[]): void {
    console.debug(`🔍 [Wayfinder]`, message, ...args);
  }

  info(message: string, ...args: any[]): void {
    console.info(`ℹ️ [Wayfinder]`, message, ...args);
  }

  warn(message: string, ...args: any[]): void {
    console.warn(`⚠️ [Wayfinder]`, message, ...args);
  }

  error(message: string, ...args: any[]): void {
    console.error(`❌ [Wayfinder]`, message, ...args);
  }
}

/**
 * Global Wayfinder instance for the extension with thread-safe initialization
 */
let wayfinderInstance: Wayfinder | null = null;
let wayfinderPromise: Promise<Wayfinder> | null = null;
const logger = new ExtensionLogger();

/**
 * Gets or creates the Wayfinder instance with the configured routing strategy
 * Thread-safe implementation to prevent multiple instances
 */
export async function getWayfinderInstance(): Promise<Wayfinder> {
  // Return existing instance immediately
  if (wayfinderInstance) {
    return wayfinderInstance;
  }

  // Return existing initialization promise to prevent race conditions
  if (wayfinderPromise) {
    return wayfinderPromise;
  }

  // Create new initialization promise
  wayfinderPromise = createWayfinderInstance();

  try {
    wayfinderInstance = await wayfinderPromise;
    return wayfinderInstance;
  } catch (error) {
    // Reset promise on failure to allow retry
    wayfinderPromise = null;
    throw error;
  }
}

/**
 * Internal function to create a new Wayfinder instance
 */
async function createWayfinderInstance(): Promise<Wayfinder> {
  const gatewayProvider = new ChromeStorageGatewayProvider();

  // Get routing and verification configuration from storage
  const {
    routingMethod = OPTIMAL_GATEWAY_ROUTE_METHOD,
    staticGateway,
    verificationStrategy = 'hash',
    verificationStrict = false,
    verificationEnabled = true,
  } = await chrome.storage.local.get([
    'routingMethod',
    'staticGateway',
    'verificationStrategy',
    'verificationStrict',
    'verificationEnabled',
  ]);

  let routingStrategy;

  // Select routing strategy based on configuration
  if (staticGateway) {
    // Use static routing if a static gateway is configured
    const { protocol, fqdn, port } = staticGateway.settings;
    const portSuffix =
      port && port !== (protocol === 'https' ? 443 : 80) ? `:${port}` : '';
    const staticUrl = new URL(`${protocol}://${fqdn}${portSuffix}`);

    routingStrategy = new StaticRoutingStrategy({ gateway: staticUrl });
    logger.info(`Using static routing to ${staticUrl.toString()}`);
  } else {
    // Use dynamic routing based on method
    switch (routingMethod) {
      case 'fastestPing':
        routingStrategy = new FastestPingRoutingStrategy({
          timeoutMs: 2000,
          maxConcurrency: 5,
          logger,
        });
        break;

      case 'random':
        routingStrategy = new RandomRoutingStrategy();
        break;

      case 'roundRobin': {
        // Get gateways first for round robin
        const gateways = await gatewayProvider.getGateways();
        routingStrategy = new RoundRobinRoutingStrategy({
          gateways,
        });
        break;
      }

      case OPTIMAL_GATEWAY_ROUTE_METHOD:
      case WEIGHTED_ONCHAIN_PERFORMANCE_ROUTE_METHOD:
      case RANDOM_ROUTE_METHOD:
      case HIGHEST_STAKE_ROUTE_METHOD:
      default:
        // Default to fastest ping for legacy and unknown methods
        routingStrategy = new FastestPingRoutingStrategy({
          timeoutMs: 2000,
          maxConcurrency: 5,
          logger,
        });
        break;
    }

    logger.info(
      `Using ${routingStrategy.constructor.name} for method: ${routingMethod}`,
    );
  }

  // Create verification strategy based on user configuration
  let verificationStrategyInstance: DataVerificationStrategy | undefined;

  if (verificationEnabled) {
    const trustedGateways = [
      new URL('https://arweave.net'),
      new URL('https://permagate.io'),
    ];

    switch (verificationStrategy) {
      case 'hash':
        verificationStrategyInstance = new HashVerificationStrategy({
          trustedHashProvider: new TrustedGatewaysProvider({
            trustedGateways,
          }),
        });
        break;

      case 'dataRoot':
        verificationStrategyInstance = new DataRootVerificationStrategy({
          trustedDataRootProvider: new TrustedGatewaysProvider({
            trustedGateways,
          }),
        });
        break;

      default:
        // Default to hash verification
        verificationStrategyInstance = new HashVerificationStrategy({
          trustedHashProvider: new TrustedGatewaysProvider({
            trustedGateways,
          }),
        });
        break;
    }
    logger.info(
      `Verification enabled with ${verificationStrategy} strategy${verificationStrict ? ' (strict mode)' : ''}`,
    );
  } else {
    // No verification when disabled
    verificationStrategyInstance = undefined;
    logger.info('Verification is disabled');
  }

  // Create Wayfinder instance
  const instance = new Wayfinder({
    logger,
    gatewaysProvider: gatewayProvider,
    routingStrategy,
    verificationStrategy: verificationStrategyInstance,
    events: {
      onVerificationSucceeded: (event: any) => {
        logger.info('✅ Verification succeeded for', event.txId);
      },
      onVerificationFailed: (error: any) => {
        logger.error('❌ Verification failed:', error);
      },
      onVerificationProgress: (event: any) => {
        const progress = (
          (event.processedBytes / event.totalBytes) *
          100
        ).toFixed(1);
        logger.debug(
          `🔄 Verification progress for ${event.txId}: ${progress}%`,
        );
      },
    },
    strict: verificationStrict, // Use user preference for blocking/non-blocking
  });

  logger.info('🚀 Wayfinder instance initialized');
  return instance;
}

/**
 * Resets the Wayfinder instance (for configuration changes)
 * Thread-safe reset that clears both instance and promise
 */
export function resetWayfinderInstance(): void {
  wayfinderInstance = null;
  wayfinderPromise = null;
  logger.info('🔄 Wayfinder instance reset');
}

/**
 * Convert an ar:// URL to a routable gateway URL using Wayfinder core library
 */
export async function getRoutableGatewayUrl(arUrl: string): Promise<{
  url: string;
  gatewayFQDN: string;
  gatewayProtocol: string;
  gatewayPort: number | null;
  gatewayAddress: string;
  selectedGateway: any;
}> {
  try {
    if (!arUrl.startsWith('ar://')) {
      throw new Error(`Invalid ar:// URL format: ${arUrl}`);
    }

    const wayfinder = await getWayfinderInstance();

    // Handle ENS resolution if enabled
    const arUrlParts = arUrl.slice(5).split('/');
    const baseName = arUrlParts[0];
    const path =
      arUrlParts.length > 1 ? '/' + arUrlParts.slice(1).join('/') : '';

    let processedUrl = arUrl;

    // Check if ENS resolution is enabled
    const { ensResolutionEnabled } = await chrome.storage.local.get([
      'ensResolutionEnabled',
    ]);

    if (baseName.endsWith('.eth') && ensResolutionEnabled) {
      logger.info(`🔍 Resolving ENS name: ${baseName}`);
      const txId = await fetchEnsArweaveTxId(baseName);
      if (txId) {
        processedUrl = `ar://${txId}${path}`;
      } else {
        throw new Error(
          `❌ ENS name ${baseName} does not have an Arweave TX ID.`,
        );
      }
    } else if (baseName.includes('.')) {
      // Handle gasless ArNS domains
      logger.info(`🔍 Resolving Gasless ArNS domain: ${baseName}`);
      const txId = await lookupArweaveTxIdForDomain(baseName);
      if (txId) {
        processedUrl = `ar://${txId}${path}`;
      } else {
        logger.warn(
          `⚠️ No transaction ID found for domain: ${baseName}. Using as ArNS name.`,
        );
      }
    }

    // Use Wayfinder to resolve the URL
    const resolvedUrl = await wayfinder.resolveUrl({
      originalUrl: processedUrl,
      logger,
    });

    // Extract gateway information from the resolved URL
    const gatewayUrl = new URL(resolvedUrl.toString());
    const gatewayFQDN = gatewayUrl.hostname;
    const gatewayProtocol = gatewayUrl.protocol.slice(0, -1); // Remove trailing ':'
    const gatewayPort = gatewayUrl.port ? parseInt(gatewayUrl.port) : null;

    logger.info(`🎯 Resolved ${arUrl} to ${resolvedUrl.toString()}`);

    return {
      url: resolvedUrl.toString(),
      gatewayFQDN,
      gatewayProtocol,
      gatewayPort,
      gatewayAddress: 'CORE_LIBRARY', // Core library manages gateway selection
      selectedGateway: {
        settings: {
          fqdn: gatewayFQDN,
          protocol: gatewayProtocol,
          port: gatewayPort,
        },
      },
    };
  } catch (error) {
    logger.error('🚨 Error in getRoutableGatewayUrl:', error);

    // Fallback to default gateway with proper URL construction
    const fallbackGateway = DEFAULT_GATEWAY;
    const { protocol, fqdn, port } = fallbackGateway.settings;

    // Extract the transaction ID or ArNS name from the original ar:// URL
    const arPath = arUrl.slice(5); // Remove 'ar://' prefix
    const fallbackUrl = `${protocol}://${fqdn}${port ? `:${port}` : ''}/${arPath}`;

    logger.warn(`🔄 Using fallback URL: ${fallbackUrl}`);

    return {
      url: fallbackUrl,
      gatewayFQDN: fqdn,
      gatewayProtocol: protocol,
      gatewayPort: port,
      gatewayAddress: fallbackGateway.gatewayAddress || 'FALLBACK',
      selectedGateway: fallbackGateway,
    };
  }
}

/**
 * Lookup the Arweave transaction ID for a given domain using DNS TXT records.
 * (Kept from legacy implementation for gasless ArNS support)
 */
async function lookupArweaveTxIdForDomain(
  domain: string,
): Promise<string | null> {
  const cacheKey = `dnsCache_${domain}`;

  try {
    // Check cache first
    const cachedResult = await chrome.storage.local.get([cacheKey]);

    if (cachedResult && cachedResult[cacheKey]) {
      const { txId, timestamp } = cachedResult[cacheKey];

      if (Date.now() - timestamp < GASLESS_ARNS_DNS_EXPIRATION_TIME) {
        logger.debug(`Cache hit for ${domain}: ${txId}`);
        return txId;
      } else {
        logger.debug(`Cache expired for ${domain}, removing entry.`);
        await chrome.storage.local.remove(cacheKey);
      }
    }

    // Perform DNS lookup
    logger.debug('Checking DNS TXT record for:', domain);
    const response = await fetch(`${DNS_LOOKUP_API}?name=${domain}&type=TXT`);

    if (!response.ok) {
      logger.error(`DNS lookup failed: ${response.statusText}`);
      return null;
    }

    const data = await response.json();

    // Extract Arweave transaction ID from TXT record
    const match = data.Answer?.map((record: any) => {
      const result = record.data.match(/ARTX ([a-zA-Z0-9_-]{43})/);
      return result ? result[1] : null;
    }).find((txId: string) => txId !== null);

    if (match) {
      // Cache result with timestamp
      await chrome.storage.local.set({
        [cacheKey]: { txId: match, timestamp: Date.now() },
      });

      logger.debug(`Cached result for ${domain}: ${match}`);
      return match;
    }

    return null;
  } catch (error) {
    logger.error('❌ Failed to lookup DNS TXT records:', error);
    return null;
  }
}

/**
 * Make a verified request using the Wayfinder core library
 */
export async function makeVerifiedRequest(
  arUrl: string,
  init?: RequestInit,
): Promise<Response> {
  const wayfinder = await getWayfinderInstance();

  logger.info(`🌐 Making verified request to ${arUrl}`);

  return wayfinder.request(arUrl, init);
}

/**
 * Configure verification strictness
 */
export async function setVerificationStrict(strict: boolean): Promise<void> {
  // Reset instance to apply new settings
  resetWayfinderInstance();

  // Store setting for future instances
  await chrome.storage.local.set({ verificationStrict: strict });

  logger.info(`🔒 Verification strictness set to: ${strict}`);
}
