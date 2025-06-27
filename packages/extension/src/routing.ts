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
  FastestPingRoutingStrategy,
  HashVerificationStrategy,
  Logger,
  RandomRoutingStrategy,
  RoundRobinRoutingStrategy,
  SignatureVerificationStrategy,
  SimpleCacheGatewaysProvider,
  StaticRoutingStrategy,
  Wayfinder,
} from '@ar.io/wayfinder-core';
import { ChromeStorageGatewayProvider } from './adapters/chrome-storage-gateway-provider';
import {
  ROUTING_STRATEGY_DEFAULTS,
  VERIFICATION_STRATEGY_DEFAULTS,
  WAYFINDER_DEFAULTS,
} from './config/defaults';
import {
  DNS_LOOKUP_API,
  FALLBACK_GATEWAY,
  GASLESS_ARNS_DNS_EXPIRATION_TIME,
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
    console.info(`[INFO] [Wayfinder]`, message, ...args);
  }

  warn(message: string, ...args: any[]): void {
    console.warn(`[WARNING] [Wayfinder]`, message, ...args);
  }

  error(message: string, ...args: any[]): void {
    console.error(`[ERROR] [Wayfinder]`, message, ...args);
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
  // Get routing and verification configuration from storage
  const {
    routingMethod = WAYFINDER_DEFAULTS.routingMethod,
    staticGateway = WAYFINDER_DEFAULTS.staticGateway,
    verificationStrategy = WAYFINDER_DEFAULTS.verificationStrategy,
    verificationEnabled = WAYFINDER_DEFAULTS.verificationEnabled,
    gatewayCacheTTL = WAYFINDER_DEFAULTS.gatewayCacheTTL,
    gatewaySortBy = WAYFINDER_DEFAULTS.gatewaySortBy,
    gatewaySortOrder = WAYFINDER_DEFAULTS.gatewaySortOrder,
    telemetryEnabled = WAYFINDER_DEFAULTS.telemetryEnabled,
    telemetrySampleRate = WAYFINDER_DEFAULTS.telemetrySampleRate,
  } = await chrome.storage.local.get([
    'routingMethod',
    'staticGateway',
    'verificationStrategy',
    'verificationEnabled',
    'gatewayCacheTTL',
    'gatewaySortBy',
    'gatewaySortOrder',
    'telemetryEnabled',
    'telemetrySampleRate',
  ]);

  // Create the base gateway provider with configurable sorting
  const baseGatewayProvider = new ChromeStorageGatewayProvider({
    sortBy: gatewaySortBy,
    sortOrder: gatewaySortOrder,
  });

  // Wrap with cache provider for better performance
  const gatewayProvider = new SimpleCacheGatewaysProvider({
    ttlSeconds: gatewayCacheTTL,
    gatewaysProvider: baseGatewayProvider,
  });

  logger.info(
    `[ROUTING] Creating Wayfinder with routing method: ${routingMethod}`,
  );

  let routingStrategy;

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
    logger.info(`Using static routing to ${staticUrl.toString()}`);
  } else {
    // Use dynamic routing based on method
    switch (routingMethod) {
      case 'fastestPing':
        routingStrategy = new FastestPingRoutingStrategy({
          timeoutMs: ROUTING_STRATEGY_DEFAULTS.fastestPing.timeoutMs,
          maxConcurrency: ROUTING_STRATEGY_DEFAULTS.fastestPing.maxConcurrency,
          logger,
        });
        break;

      case 'random':
        routingStrategy = new RandomRoutingStrategy();
        logger.info('[ROUTING] Using random routing strategy');
        break;

      case 'roundRobin': {
        // Get gateways first for round robin - it needs them for tracking
        const gateways = await gatewayProvider.getGateways();
        logger.info(
          `[ROUTING] Initializing round robin with ${gateways.length} gateways`,
        );

        // Convert gateway objects to URL array if needed
        const gatewayUrls = gateways.map((gateway) => {
          if (gateway instanceof URL) {
            return gateway;
          } else if (typeof gateway === 'string') {
            return new URL(gateway);
          } else if (gateway.url) {
            return new URL(gateway.url);
          } else {
            // Construct URL from gateway object
            const protocol = gateway.settings?.protocol || 'https';
            const fqdn = gateway.settings?.fqdn || gateway.fqdn;
            const port = gateway.settings?.port;
            const portSuffix =
              port && port !== (protocol === 'https' ? 443 : 80)
                ? `:${port}`
                : '';
            return new URL(`${protocol}://${fqdn}${portSuffix}`);
          }
        });

        routingStrategy = new RoundRobinRoutingStrategy({
          gateways: gatewayUrls,
        });
        logger.info('[ROUTING] Using round robin routing strategy');
        break;
      }

      case 'static':
        // If we get here, either no static gateway is configured or method mismatch
        logger.warn(
          'Static routing selected but no static gateway configured, falling back to fastest ping',
        );
        // Intentionally fall through to default
        routingStrategy = new FastestPingRoutingStrategy({
          timeoutMs: ROUTING_STRATEGY_DEFAULTS.fastestPing.timeoutMs,
          maxConcurrency: ROUTING_STRATEGY_DEFAULTS.fastestPing.maxConcurrency,
          logger,
        });
        break;
      default:
        // Default to fastest ping for unknown methods
        routingStrategy = new FastestPingRoutingStrategy({
          timeoutMs: ROUTING_STRATEGY_DEFAULTS.fastestPing.timeoutMs,
          maxConcurrency: ROUTING_STRATEGY_DEFAULTS.fastestPing.maxConcurrency,
          logger,
        });
        break;
    }

    logger.info(
      `Using ${routingStrategy.constructor.name} for method: ${routingMethod}`,
    );
  }

  // Create verification strategy based on user configuration
  let verificationStrategyInstance: any | undefined;

  logger.info(
    `[INIT] Verification configuration - enabled: ${verificationEnabled}, strategy: ${verificationStrategy}`,
  );

  if (verificationEnabled) {
    try {
      // Get trusted gateways configuration
      const {
        verificationGatewayMode = WAYFINDER_DEFAULTS.verificationGatewayMode,
        verificationGatewayCount = WAYFINDER_DEFAULTS.verificationGatewayCount,
        verificationTrustedGateways = WAYFINDER_DEFAULTS.verificationTrustedGateways,
        localGatewayAddressRegistry = {},
      } = await chrome.storage.local.get([
        'verificationGatewayMode',
        'verificationGatewayCount',
        'verificationTrustedGateways',
        'localGatewayAddressRegistry',
      ]);

      let trustedGateways: URL[] = [];

      if (verificationGatewayMode === 'automatic') {
        // Get top N gateways by stake from the registry
        const gateways = Object.entries(localGatewayAddressRegistry)
          .map(([address, gateway]: [string, any]) => ({
            address,
            fqdn: gateway.settings?.fqdn,
            protocol: gateway.settings?.protocol || 'https',
            port: gateway.settings?.port,
            operatorStake: gateway.operatorStake || 0,
            totalDelegatedStake: gateway.totalDelegatedStake || 0,
            status: gateway.status,
          }))
          .filter((gateway) => gateway.status === 'joined' && gateway.fqdn)
          .sort((a, b) => {
            const stakeA = a.operatorStake + a.totalDelegatedStake;
            const stakeB = b.operatorStake + b.totalDelegatedStake;
            return stakeB - stakeA;
          })
          .slice(0, verificationGatewayCount)
          .map((gateway) => {
            const port =
              gateway.port &&
              gateway.port !== (gateway.protocol === 'https' ? 443 : 80)
                ? `:${gateway.port}`
                : '';
            return new URL(`${gateway.protocol}://${gateway.fqdn}${port}`);
          });

        if (gateways.length === 0) {
          // Fallback to arweave.net when no gateways in registry
          trustedGateways = [new URL('https://arweave.net')];
          logger.warn(
            '[VERIFY] No gateways in registry, using arweave.net for verification',
          );
        } else {
          trustedGateways = gateways;
        }

        logger.info(
          `[VERIFY] Using top ${verificationGatewayCount} gateways by stake for verification:`,
          trustedGateways.map((url: any) => url.hostname),
        );
      } else {
        // Manual mode - use user-selected gateways
        trustedGateways = verificationTrustedGateways
          .filter((url: any) => url && url.length > 0)
          .map((url: any) => new URL(url));

        if (trustedGateways.length === 0) {
          // Fallback to arweave.net when no manual gateways selected
          trustedGateways = [new URL('https://arweave.net')];
          logger.warn(
            '[VERIFY] No manual gateways selected, using arweave.net for verification',
          );
        } else {
          logger.info(
            `[VERIFY] Using manually selected gateways for verification:`,
            trustedGateways.map((url: any) => url.hostname),
          );
        }
      }

      // Use the new API pattern from Roam - pass trustedGateways directly
      switch (verificationStrategy) {
        case 'hash':
          verificationStrategyInstance = new HashVerificationStrategy({
            trustedGateways,
            logger,
            maxConcurrency: VERIFICATION_STRATEGY_DEFAULTS.maxConcurrency,
            timeoutMs: VERIFICATION_STRATEGY_DEFAULTS.timeoutMs,
          });
          break;

        case 'dataRoot':
          verificationStrategyInstance = new DataRootVerificationStrategy({
            trustedGateways,
            logger,
            maxConcurrency: VERIFICATION_STRATEGY_DEFAULTS.maxConcurrency,
            timeoutMs: VERIFICATION_STRATEGY_DEFAULTS.timeoutMs,
          });
          break;

        case 'signature':
          verificationStrategyInstance = new SignatureVerificationStrategy({
            trustedGateways,
            logger,
            maxConcurrency: VERIFICATION_STRATEGY_DEFAULTS.maxConcurrency,
            timeoutMs: VERIFICATION_STRATEGY_DEFAULTS.timeoutMs,
          });
          break;

        default:
          // Default to hash verification
          verificationStrategyInstance = new HashVerificationStrategy({
            trustedGateways,
            logger,
            maxConcurrency: VERIFICATION_STRATEGY_DEFAULTS.maxConcurrency,
            timeoutMs: VERIFICATION_STRATEGY_DEFAULTS.timeoutMs,
          });
          break;
      }

      logger.info(`Verification enabled with ${verificationStrategy} strategy`);
    } catch (error) {
      logger.error('[ERROR] Failed to create verification strategy:', error);
      // Disable verification if we can't create the strategy
      verificationStrategyInstance = undefined;
      logger.warn(
        '[FALLBACK] Verification disabled due to initialization error',
      );
    }
  } else {
    // No verification when disabled
    verificationStrategyInstance = undefined;
    logger.info('Verification is disabled');
  }

  // Log the verification strategy instance before creating Wayfinder
  logger.info(
    `[INIT] Creating Wayfinder with verification strategy: ${
      verificationStrategyInstance
        ? verificationStrategyInstance.constructor.name
        : 'NONE'
    }`,
  );

  // Create Wayfinder instance
  const instance = new Wayfinder({
    logger,
    gatewaysProvider: gatewayProvider,
    routingStrategy,
    verificationStrategy: verificationStrategyInstance,
    telemetrySettings: {
      enabled: telemetryEnabled,
      sampleRate: telemetrySampleRate,
      service: 'wayfinder-extension',
    },
    events: {
      onRoutingSucceeded: (event: any) => {
        logger.info('[ROUTING] Routing succeeded:', event);
      },
      onVerificationSucceeded: (event: any) => {
        logger.info('[SUCCESS] Verification succeeded:', event);
      },
      onVerificationFailed: (error: any) => {
        logger.error('[ERROR] Verification failed:', error);
      },
      onVerificationProgress: (_event: any) => {
        // Progress calculation removed - was only used for logging
      },
    },
  });

  logger.info(
    `[INIT] Wayfinder instance initialized with verification: ${
      verificationStrategyInstance ? 'ENABLED' : 'DISABLED'
    }, telemetry: ${telemetryEnabled ? 'ENABLED' : 'DISABLED'}`,
  );

  return instance;
}

/**
 * Resets the Wayfinder instance (for configuration changes)
 * Thread-safe reset that clears both instance and promise
 */
export function resetWayfinderInstance(): void {
  wayfinderInstance = null;
  wayfinderPromise = null;
  logger.info(
    '[RESET] Wayfinder instance reset - will use new configuration on next request',
  );
}

/**
 * Convert an ar:// URL to a routable gateway URL using Wayfinder core library
 * When verification is enabled, this will make a HEAD request to verify the gateway
 * supports the content before returning the URL for navigation.
 */
export async function getRoutableGatewayUrl(arUrl: string): Promise<{
  url: string;
  gatewayFQDN: string;
  gatewayProtocol: string;
  gatewayPort: number | null;
  gatewayAddress: string;
  selectedGateway: any;
  verification?: {
    enabled: boolean;
    expectedDigest?: string;
    txId?: string;
    strategy?: string;
  };
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
          `[ERROR] ENS name ${baseName} does not have an Arweave TX ID.`,
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
          `[WARNING] No transaction ID found for domain: ${baseName}. Using as ArNS name.`,
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

    logger.info(`[RESOLVED] Resolved ${arUrl} to ${resolvedUrl.toString()}`);
    // Get the current routing method for logging
    const { routingMethod } = await chrome.storage.local.get('routingMethod');
    logger.info(
      `[GATEWAY] Selected gateway: ${gatewayFQDN} using ${
        routingMethod || 'default'
      } strategy`,
    );

    // Log more details in debug mode
    logger.debug(`[GATEWAY] Full resolved URL: ${resolvedUrl.toString()}`);
    logger.debug(`[GATEWAY] Gateway details:`, {
      fqdn: gatewayFQDN,
      protocol: gatewayProtocol,
      port: gatewayPort,
      strategy: routingMethod,
    });

    // Check if verified browsing is enabled
    const { verifiedBrowsing } = await chrome.storage.local.get([
      'verifiedBrowsing',
    ]);

    if (!verifiedBrowsing) {
      // Normal browsing mode - return gateway URL directly
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
        mode: 'normal',
      };
    }

    // Verified browsing mode - use viewer.html
    logger.info(
      `[VERIFY] Verified browsing enabled - using viewer for ${arUrl}`,
    );

    // Pass the gateway URL as a query parameter to viewer.html
    const viewerUrl = chrome.runtime.getURL(
      `viewer.html?url=${encodeURIComponent(
        arUrl,
      )}&gateway=${encodeURIComponent(resolvedUrl.toString())}`,
    );

    return {
      url: viewerUrl,
      gatewayFQDN: 'wayfinder-viewer',
      gatewayProtocol: 'chrome-extension',
      gatewayPort: null,
      gatewayAddress: 'VERIFIED',
      selectedGateway: {
        settings: {
          fqdn: 'wayfinder-viewer',
          protocol: 'chrome-extension',
          port: null,
        },
      },
      mode: 'verified',
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
        logger.error(
          '[ROUTING] No gateways available. Gateway registry may be empty.',
        );
      } else if (
        errorMessage.includes('Failed to fetch') ||
        errorMessage.includes('NetworkError')
      ) {
        userFriendlyMessage =
          'Network connection issue. Please check your internet connection.';
        logger.error('[ROUTING] Network connectivity issue:', errorMessage);
      } else if (errorMessage.includes('Invalid ar://')) {
        userFriendlyMessage = `Invalid ar:// URL format: ${arUrl}`;
        logger.error('[ROUTING] Invalid ar:// URL:', arUrl);
      } else if (errorMessage.includes('timeout')) {
        userFriendlyMessage =
          'Request timed out. All gateways may be slow or unreachable.';
        logger.error('[ROUTING] Gateway selection timeout:', errorMessage);
      } else if (errorMessage.includes('ENS name')) {
        userFriendlyMessage = errorMessage; // ENS errors are already user-friendly
        logger.error('[ROUTING] ENS resolution error:', errorMessage);
      } else {
        logger.error('[ROUTING] Unexpected error:', error);
      }
    } else {
      logger.error('[ROUTING] Non-Error thrown:', error);
    }

    // Try fallback gateway as last resort
    try {
      const fallbackGateway = FALLBACK_GATEWAY;
      const { protocol, fqdn, port } = fallbackGateway.settings;

      // Extract the transaction ID or ArNS name from the original ar:// URL
      const arPath = arUrl.slice(5); // Remove 'ar://' prefix
      const fallbackUrl = `${protocol}://${fqdn}${
        port ? `:${port}` : ''
      }/${arPath}`;

      logger.warn(
        `🔄 Using fallback URL: ${fallbackUrl} (${userFriendlyMessage})`,
      );

      return {
        url: fallbackUrl,
        gatewayFQDN: fqdn,
        gatewayProtocol: protocol,
        gatewayPort: port,
        gatewayAddress: fallbackGateway.gatewayAddress || 'FALLBACK',
        selectedGateway: fallbackGateway,
        // error: userFriendlyMessage, // Include error message for UI display
      };
    } catch (fallbackError) {
      logger.error('[CRITICAL] Fallback gateway also failed:', fallbackError);
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

/**
 * Make a verified request using the Wayfinder core library
 */
export async function makeVerifiedRequest(
  arUrl: string,
  init?: RequestInit,
): Promise<Response> {
  const wayfinder = await getWayfinderInstance();

  logger.info(`[REQUEST] Making verified request to ${arUrl}`);

  return wayfinder.request(arUrl, init);
}
