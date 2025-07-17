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
  FastestPingRoutingStrategy,
  RandomRoutingStrategy,
  SimpleCacheRoutingStrategy,
  StaticRoutingStrategy,
  Wayfinder,
} from '@ar.io/wayfinder-core';
import { ChromeStorageGatewayProvider } from './adapters/chrome-storage-gateway-provider';
import {
  ROUTING_STRATEGY_DEFAULTS,
  WAYFINDER_DEFAULTS,
} from './config/defaults';
import {
  DNS_LOOKUP_API,
  FALLBACK_GATEWAY,
  GASLESS_ARNS_DNS_EXPIRATION_TIME,
} from './constants';
import { fetchEnsArweaveTxId } from './ens';
import { logger } from './utils/logger';
import { getExtensionVersion } from './utils/version';

/**
 * Global Wayfinder instance for the extension with thread-safe initialization
 */
let wayfinderInstance: Wayfinder | null = null;
let wayfinderPromise: Promise<Wayfinder> | null = null;

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
  // Get routing configuration from storage
  const {
    routingMethod = WAYFINDER_DEFAULTS.routingMethod,
    staticGateway = WAYFINDER_DEFAULTS.staticGateway,
    gatewaySortBy = WAYFINDER_DEFAULTS.gatewaySortBy,
    gatewaySortOrder = WAYFINDER_DEFAULTS.gatewaySortOrder,
    telemetryEnabled = WAYFINDER_DEFAULTS.telemetryEnabled,
  } = await chrome.storage.local.get([
    'routingMethod',
    'staticGateway',
    'gatewayCacheTTL',
    'gatewaySortBy',
    'gatewaySortOrder',
    'telemetryEnabled',
    'verificationEnabled',
  ]);

  // Create the base gateway provider with configurable sorting
  const gatewaysProvider = new ChromeStorageGatewayProvider({
    sortBy: gatewaySortBy,
    sortOrder: gatewaySortOrder,
  });

  // Single consolidated log for routing strategy
  let routingStrategy;

  // Helper function to create a cached FastestPing strategy
  const createCachedFastestPingStrategy = () => {
    const fastestPing = new FastestPingRoutingStrategy({
      timeoutMs: ROUTING_STRATEGY_DEFAULTS.fastestPing.timeoutMs,
      maxConcurrency: ROUTING_STRATEGY_DEFAULTS.fastestPing.maxConcurrency,
      logger,
    });

    // Wrap with cache strategy (15 minutes TTL)
    return new SimpleCacheRoutingStrategy({
      routingStrategy: fastestPing,
      ttlSeconds: 15 * 60, // 15 minutes
      logger,
    });
  };

  // Select routing strategy based on configuration
  if (routingMethod === 'static' && staticGateway) {
    // Use static routing only if explicitly selected AND a static gateway is configured
    const { protocol, fqdn, port } = staticGateway.settings;
    const portSuffix =
      port && port !== (protocol === 'https' ? 443 : 80) ? `:${port}` : '';
    const staticUrl = new URL(`${protocol}://${fqdn}${portSuffix}`);

    routingStrategy = new StaticRoutingStrategy({
      gateway: staticUrl.toString(),
    });
    // Static routing details included in summary log
  } else {
    // Use dynamic routing based on method
    switch (routingMethod) {
      case 'fastestPing':
        routingStrategy = createCachedFastestPingStrategy();
        break;

      case 'random':
        routingStrategy = new RandomRoutingStrategy();
        // Log handled at end of function
        break;

      case 'roundRobin':
        // Round Robin removed - fallback to random (balanced) strategy
        routingStrategy = new RandomRoutingStrategy();
        logger.info(
          '[ROUTING] Round Robin deprecated, using Balanced strategy',
        );
        break;

      case 'static':
        // If we get here, either no static gateway is configured or method mismatch
        // Static routing fallback to fastest ping
        // Intentionally fall through to default
        routingStrategy = createCachedFastestPingStrategy();
        break;
      default:
        // default to random (balanced) strategy
        routingStrategy = new RandomRoutingStrategy();
        break;
    }

    // Log handled at end of function
  }

  // Create Wayfinder instance
  const wayfinderConfig = {
    logger,
    gatewaysProvider,
    routingSettings: {
      strategy: routingStrategy,
      events: {
        onRoutingSucceeded: () => {
          // Gateway selected
        },
      },
    },
    /**
     * NOTE: because we don't get access to the first bytes of the response, we can't verify the data directly here.
     *
     * Instead, we set up a chrome listener for response headers, and check the 'x-ar-io-verified' header using the RemoteVerificationStrategy provided by Wayfinder Core.
     */
    telemetrySettings: {
      enabled: telemetryEnabled,
      sampleRate: 1, // send all ar:// requests
      clientName: 'wayfinder-extension',
      clientVersion: await getExtensionVersion(),
    },
  };

  const instance = new Wayfinder(wayfinderConfig);

  return instance;
}

/**
 * Resets the Wayfinder instance (for configuration changes)
 * Thread-safe reset that clears both instance and promise
 */
export function resetWayfinderInstance(): void {
  wayfinderInstance = null;
  wayfinderPromise = null;
  // Instance reset
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
      const txId = await fetchEnsArweaveTxId(baseName);
      if (txId) {
        processedUrl = `ar://${txId}${path}`;
        // ENS resolved
      } else {
        throw new Error(`ENS name ${baseName} does not have an Arweave TX ID.`);
      }
    } else if (baseName.includes('.')) {
      // Handle gasless ArNS domains
      const txId = await lookupArweaveTxIdForDomain(baseName);
      if (txId) {
        processedUrl = `ar://${txId}${path}`;
        // ArNS resolved
      }
    }

    // Use Wayfinder to resolve the URL
    let resolvedUrl;
    try {
      // In Wayfinder Core 1.0.0, resolveUrl only accepts the URL parameters, not logger
      resolvedUrl = await wayfinder.resolveUrl({
        originalUrl: processedUrl,
      });
    } catch (resolveError) {
      logger.error('[ROUTING] resolveUrl failed:', resolveError);
      throw resolveError;
    }

    // Extract gateway information from the resolved URL
    const gatewayUrl = new URL(resolvedUrl.toString());
    const gatewayFQDN = gatewayUrl.hostname;
    const gatewayProtocol = gatewayUrl.protocol.slice(0, -1); // Remove trailing ':'
    const gatewayPort = gatewayUrl.port ? parseInt(gatewayUrl.port) : null;

    // Single concise log for routing result
    logger.info(`[ROUTE] ${arUrl} → ${gatewayFQDN}`);

    // Always return gateway URL directly
    return {
      url: resolvedUrl.toString(),
      gatewayFQDN,
      gatewayProtocol,
      gatewayPort,
      gatewayAddress: 'CORE_LIBRARY',
      selectedGateway: {
        settings: {
          fqdn: gatewayFQDN,
          protocol: gatewayProtocol,
          port: gatewayPort,
        },
      },
    };
  } catch (error) {
    // Provide more specific error messages
    let errorMessage = 'Unknown error occurred';
    let userFriendlyMessage = 'Failed to route request';

    if (error instanceof Error) {
      errorMessage = error.message;

      // Specific error handling based on error type
      if (errorMessage.includes('No gateways available')) {
        userFriendlyMessage =
          'No gateways available. Please sync gateway registry in settings.';
      } else if (
        errorMessage.includes('Failed to fetch') ||
        errorMessage.includes('NetworkError')
      ) {
        userFriendlyMessage =
          'Network connection issue. Please check your internet connection.';
      } else if (errorMessage.includes('Invalid ar://')) {
        userFriendlyMessage = `Invalid ar:// URL format: ${arUrl}`;
      } else if (errorMessage.includes('timeout')) {
        userFriendlyMessage =
          'Request timed out. All gateways may be slow or unreachable.';
      } else if (errorMessage.includes('ENS name')) {
        userFriendlyMessage = errorMessage; // ENS errors are already user-friendly
      }

      // Single error log with context
      logger.error('[ROUTING] Failed:', userFriendlyMessage);
    } else {
      logger.error('[ROUTING] Non-Error thrown:', error);
    }

    // Try fallback gateway as last resort
    try {
      const fallbackGateway = FALLBACK_GATEWAY;
      const { protocol, fqdn, port } = fallbackGateway.settings;

      // Extract the transaction ID or ArNS name from the original ar:// URL
      const arPath = arUrl.slice(5); // Remove 'ar://' prefix
      const [basePart, ...pathParts] = arPath.split('/');
      const remainingPath =
        pathParts.length > 0 ? '/' + pathParts.join('/') : '';

      let fallbackUrl;
      // Check if it's a transaction ID (43 chars of base64url) or an ArNS name
      const isTxId = /^[a-zA-Z0-9_-]{43}$/.test(basePart);

      if (isTxId) {
        // For transaction IDs, use path format: https://arweave.net/txid
        fallbackUrl = `${protocol}://${fqdn}${
          port ? `:${port}` : ''
        }/${basePart}${remainingPath}`;
      } else {
        // For ArNS names, use subdomain format: https://name.arweave.net
        fallbackUrl = `${protocol}://${basePart}.${fqdn}${
          port ? `:${port}` : ''
        }${remainingPath}`;
      }

      logger.warn(`[FALLBACK] Using ${fqdn} - ${userFriendlyMessage}`);

      return {
        url: fallbackUrl,
        gatewayFQDN: fqdn,
        gatewayProtocol: protocol,
        gatewayPort: port,
        gatewayAddress: fallbackGateway.gatewayAddress || 'FALLBACK',
        selectedGateway: fallbackGateway,
        // error: userFriendlyMessage, // Include error message for UI display
      };
    } catch (_fallbackError) {
      logger.error('[CRITICAL] Fallback failed: ', _fallbackError);
      throw new Error(userFriendlyMessage);
    }
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
    logger.error('[ERROR] Failed to lookup DNS TXT records:', error);
    return null;
  }
}
