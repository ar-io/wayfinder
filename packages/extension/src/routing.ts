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
} from "@ar.io/wayfinder-core";
import { ChromeStorageGatewayProvider } from "./adapters/chrome-storage-gateway-provider";
import {
  ROUTING_STRATEGY_DEFAULTS,
  VERIFICATION_STRATEGY_DEFAULTS,
  WAYFINDER_DEFAULTS,
} from "./config/defaults";
import {
  DNS_LOOKUP_API,
  FALLBACK_GATEWAY,
  GASLESS_ARNS_DNS_EXPIRATION_TIME,
} from "./constants";
import { fetchEnsArweaveTxId } from "./ens";

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
    verifiedBrowsing = WAYFINDER_DEFAULTS.verifiedBrowsing,
    gatewayCacheTTL = WAYFINDER_DEFAULTS.gatewayCacheTTL,
    gatewaySortBy = WAYFINDER_DEFAULTS.gatewaySortBy,
    gatewaySortOrder = WAYFINDER_DEFAULTS.gatewaySortOrder,
    telemetryEnabled = WAYFINDER_DEFAULTS.telemetryEnabled,
  } = await chrome.storage.local.get([
    "routingMethod",
    "staticGateway",
    "verificationStrategy",
    "verifiedBrowsing",
    "gatewayCacheTTL",
    "gatewaySortBy",
    "gatewaySortOrder",
    "telemetryEnabled",
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

  // Single consolidated log for routing strategy
  const routingMethodName =
    routingMethod === "static" && staticGateway
      ? `static (${staticGateway.settings.fqdn})`
      : routingMethod;

  let routingStrategy;

  // Select routing strategy based on configuration
  if (routingMethod === "static" && staticGateway) {
    // Use static routing only if explicitly selected AND a static gateway is configured
    const { protocol, fqdn, port } = staticGateway.settings;
    const portSuffix =
      port && port !== (protocol === "https" ? 443 : 80) ? `:${port}` : "";
    const staticUrl = new URL(`${protocol}://${fqdn}${portSuffix}`);

    routingStrategy = new StaticRoutingStrategy({
      gateway: staticUrl.toString(),
    });
    // Static routing details included in summary log
  } else {
    // Use dynamic routing based on method
    switch (routingMethod) {
      case "fastestPing":
        routingStrategy = new FastestPingRoutingStrategy({
          timeoutMs: ROUTING_STRATEGY_DEFAULTS.fastestPing.timeoutMs,
          maxConcurrency: ROUTING_STRATEGY_DEFAULTS.fastestPing.maxConcurrency,
          logger,
        });
        break;

      case "random":
        routingStrategy = new RandomRoutingStrategy();
        // Log handled at end of function
        break;

      case "roundRobin": {
        // Get gateways first for round robin - it needs them for tracking
        const gateways = await gatewayProvider.getGateways();
        // Gateway count included in summary log

        // Convert gateway objects to URL array if needed
        const gatewayUrls = gateways.map((gateway) => {
          if (gateway instanceof URL) {
            return gateway;
          } else if (typeof gateway === "string") {
            return new URL(gateway);
          } else if (gateway.url) {
            return new URL(gateway.url);
          } else {
            // Construct URL from gateway object
            const protocol = gateway.settings?.protocol || "https";
            const fqdn = gateway.settings?.fqdn || gateway.fqdn;
            const port = gateway.settings?.port;
            const portSuffix =
              port && port !== (protocol === "https" ? 443 : 80)
                ? `:${port}`
                : "";
            return new URL(`${protocol}://${fqdn}${portSuffix}`);
          }
        });

        routingStrategy = new RoundRobinRoutingStrategy({
          gateways: gatewayUrls,
        });
        // Log handled at end of function
        break;
      }

      case "static":
        // If we get here, either no static gateway is configured or method mismatch
        // Static routing fallback to fastest ping
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

    // Log handled at end of function
  }

  // Create verification strategy based on user configuration
  let verificationStrategyInstance: any | undefined;

  // Verification configuration included in summary log

  if (verifiedBrowsing) {
    try {
      // Get trusted gateways configuration
      const {
        verificationGatewayMode = WAYFINDER_DEFAULTS.verificationGatewayMode,
        verificationGatewayCount = WAYFINDER_DEFAULTS.verificationGatewayCount,
        verificationTrustedGateways = WAYFINDER_DEFAULTS.verificationTrustedGateways,
        localGatewayAddressRegistry = {},
      } = await chrome.storage.local.get([
        "verificationGatewayMode",
        "verificationGatewayCount",
        "verificationTrustedGateways",
        "localGatewayAddressRegistry",
      ]);

      let trustedGateways: URL[] = [];

      if (verificationGatewayMode === "automatic") {
        // Get top N gateways by stake from the registry
        const gateways = Object.entries(localGatewayAddressRegistry)
          .map(([address, gateway]: [string, any]) => ({
            address,
            fqdn: gateway.settings?.fqdn,
            protocol: gateway.settings?.protocol || "https",
            port: gateway.settings?.port,
            operatorStake: gateway.operatorStake || 0,
            totalDelegatedStake: gateway.totalDelegatedStake || 0,
            status: gateway.status,
          }))
          .filter((gateway) => gateway.status === "joined" && gateway.fqdn)
          .sort((a, b) => {
            const stakeA = a.operatorStake + a.totalDelegatedStake;
            const stakeB = b.operatorStake + b.totalDelegatedStake;
            return stakeB - stakeA;
          })
          .slice(0, verificationGatewayCount)
          .map((gateway) => {
            const port =
              gateway.port &&
              gateway.port !== (gateway.protocol === "https" ? 443 : 80)
                ? `:${gateway.port}`
                : "";
            return new URL(`${gateway.protocol}://${gateway.fqdn}${port}`);
          });

        if (gateways.length === 0) {
          // Fallback to arweave.net when no gateways in registry
          trustedGateways = [new URL("https://arweave.net")];
          // Fallback to arweave.net for verification
        } else {
          trustedGateways = gateways;
        }

        // Using top gateways by stake for verification
      } else {
        // Manual mode - use user-selected gateways
        trustedGateways = verificationTrustedGateways
          .filter((url: any) => url && url.length > 0)
          .map((url: any) => new URL(url));

        if (trustedGateways.length === 0) {
          // Fallback to arweave.net when no manual gateways selected
          trustedGateways = [new URL("https://arweave.net")];
          // Fallback to arweave.net for verification
        } else {
          // Using manually selected gateways for verification
        }
      }

      // Use the new API pattern from Roam - pass trustedGateways directly
      switch (verificationStrategy) {
        case "hash":
          verificationStrategyInstance = new HashVerificationStrategy({
            trustedGateways,
            logger,
            maxConcurrency: VERIFICATION_STRATEGY_DEFAULTS.maxConcurrency,
          });
          break;

        case "dataRoot":
          verificationStrategyInstance = new DataRootVerificationStrategy({
            trustedGateways,
            logger,
            maxConcurrency: VERIFICATION_STRATEGY_DEFAULTS.maxConcurrency,
          });
          break;

        case "signature":
          verificationStrategyInstance = new SignatureVerificationStrategy({
            trustedGateways,
            logger,
            maxConcurrency: VERIFICATION_STRATEGY_DEFAULTS.maxConcurrency,
          });
          break;

        default:
          // Default to hash verification
          verificationStrategyInstance = new HashVerificationStrategy({
            trustedGateways,
            logger,
            maxConcurrency: VERIFICATION_STRATEGY_DEFAULTS.maxConcurrency,
          });
          break;
      }

      // Verification details included in summary log
    } catch (error) {
      logger.error(
        "[ERROR] Failed to create verification strategy:",
        error instanceof Error ? error.message : "Unknown error"
      );
      // Disable verification if we can't create the strategy
      verificationStrategyInstance = undefined;
      // Verification disabled due to error
    }
  } else {
    // No verification when disabled
    verificationStrategyInstance = undefined;
  }

  // Creating Wayfinder instance

  // Verification strategy configured

  // Create Wayfinder instance
  const wayfinderConfig = {
    logger,
    gatewaysProvider: gatewayProvider,
    routingSettings: {
      strategy: routingStrategy,
      events: {
        onRoutingSucceeded: (_event: any) => {
          // Gateway selected
        },
      },
    },
    verificationSettings: verificationStrategyInstance
      ? {
          enabled: true,
          strategy: verificationStrategyInstance,
          events: {
            onVerificationSucceeded: (_event: any) => {
              // Verification succeeded
            },
            onVerificationFailed: (error: any) => {
              logger.error("[VERIFY] Failed:", error.message || error);
            },
            onVerificationProgress: (event: any) => {
              const percentage =
                (event.processedBytes / event.totalBytes) * 100;
              // Only log at 25%, 50%, 75%, 100%
              if ([25, 50, 75, 100].includes(Math.round(percentage))) {
                logger.debug(`[VERIFY] Progress: ${percentage.toFixed(0)}%`);
              }
            },
          },
        }
      : undefined,
    telemetrySettings: telemetryEnabled
      ? {
          enabled: true,
          sampleRate: 0.1, // Hardcoded to 10%
        }
      : undefined,
  };

  // Log telemetry configuration
  logger.info("[WAYFINDER] Creating instance with config:", {
    telemetryEnabled,
    telemetrySettings: wayfinderConfig.telemetrySettings,
  });

  let instance;
  try {
    instance = new Wayfinder(wayfinderConfig);
  } catch (error) {
    logger.error("[WAYFINDER] Failed to create instance:", error);

    // Check if it's the async_hooks error
    if (error instanceof Error && error.message.includes("AsyncLocalStorage")) {
      logger.warn(
        "[WAYFINDER] Telemetry initialization failed due to browser incompatibility"
      );
      logger.warn("[WAYFINDER] Retrying without telemetry...");

      // Remove telemetry and retry
      delete wayfinderConfig.telemetrySettings;
      instance = new Wayfinder(wayfinderConfig);

      logger.info(
        "[WAYFINDER] Successfully created instance without telemetry"
      );
    } else {
      throw error;
    }
  }

  // Create a concise summary of Wayfinder configuration
  const configSummary = {
    routing: routingMethodName,
    verification: verifiedBrowsing ? verificationStrategy : "disabled",
    telemetry: telemetryEnabled ? "10%" : "disabled",
    gateways: {
      cache: `${gatewayCacheTTL}s`,
      sort: `${gatewaySortBy} ${gatewaySortOrder}`,
    },
  };

  logger.info("[WAYFINDER] Initialized:", configSummary);

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
    if (!arUrl.startsWith("ar://")) {
      throw new Error(`Invalid ar:// URL format: ${arUrl}`);
    }

    const wayfinder = await getWayfinderInstance();

    // Handle ENS resolution if enabled
    const arUrlParts = arUrl.slice(5).split("/");
    const baseName = arUrlParts[0];
    const path =
      arUrlParts.length > 1 ? "/" + arUrlParts.slice(1).join("/") : "";

    let processedUrl = arUrl;

    // Check if ENS resolution is enabled
    const { ensResolutionEnabled } = await chrome.storage.local.get([
      "ensResolutionEnabled",
    ]);

    if (baseName.endsWith(".eth") && ensResolutionEnabled) {
      const txId = await fetchEnsArweaveTxId(baseName);
      if (txId) {
        processedUrl = `ar://${txId}${path}`;
        // ENS resolved
      } else {
        throw new Error(`ENS name ${baseName} does not have an Arweave TX ID.`);
      }
    } else if (baseName.includes(".")) {
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
      logger.error("[ROUTING] resolveUrl failed:", resolveError);
      throw resolveError;
    }

    // Extract gateway information from the resolved URL
    const gatewayUrl = new URL(resolvedUrl.toString());
    const gatewayFQDN = gatewayUrl.hostname;
    const gatewayProtocol = gatewayUrl.protocol.slice(0, -1); // Remove trailing ':'
    const gatewayPort = gatewayUrl.port ? parseInt(gatewayUrl.port) : null;

    // Single concise log for routing result
    logger.info(`[ROUTE] ${arUrl} → ${gatewayFQDN}`);

    // Check if verified browsing is enabled
    const { verifiedBrowsing } = await chrome.storage.local.get([
      "verifiedBrowsing",
    ]);

    if (!verifiedBrowsing) {
      // Normal browsing mode - return gateway URL directly
      return {
        url: resolvedUrl.toString(),
        gatewayFQDN,
        gatewayProtocol,
        gatewayPort,
        gatewayAddress: "CORE_LIBRARY",
        selectedGateway: {
          settings: {
            fqdn: gatewayFQDN,
            protocol: gatewayProtocol,
            port: gatewayPort,
          },
        },
        mode: "normal",
      };
    }

    // Verified browsing mode - use viewer.html
    // Loading in verified viewer

    // Pass the gateway URL as a query parameter to viewer.html
    const viewerUrl = chrome.runtime.getURL(
      `viewer.html?url=${encodeURIComponent(
        arUrl
      )}&gateway=${encodeURIComponent(resolvedUrl.toString())}`
    );

    return {
      url: viewerUrl,
      gatewayFQDN: "wayfinder-viewer",
      gatewayProtocol: "chrome-extension",
      gatewayPort: null,
      gatewayAddress: "VERIFIED",
      selectedGateway: {
        settings: {
          fqdn: "wayfinder-viewer",
          protocol: "chrome-extension",
          port: null,
        },
      },
      mode: "verified",
    };
  } catch (error) {
    // Provide more specific error messages
    let errorMessage = "Unknown error occurred";
    let userFriendlyMessage = "Failed to route request";

    if (error instanceof Error) {
      errorMessage = error.message;

      // Specific error handling based on error type
      if (errorMessage.includes("No gateways available")) {
        userFriendlyMessage =
          "No gateways available. Please sync gateway registry in settings.";
      } else if (
        errorMessage.includes("Failed to fetch") ||
        errorMessage.includes("NetworkError")
      ) {
        userFriendlyMessage =
          "Network connection issue. Please check your internet connection.";
      } else if (errorMessage.includes("Invalid ar://")) {
        userFriendlyMessage = `Invalid ar:// URL format: ${arUrl}`;
      } else if (errorMessage.includes("timeout")) {
        userFriendlyMessage =
          "Request timed out. All gateways may be slow or unreachable.";
      } else if (errorMessage.includes("ENS name")) {
        userFriendlyMessage = errorMessage; // ENS errors are already user-friendly
      }

      // Single error log with context
      logger.error("[ROUTING] Failed:", userFriendlyMessage);
    } else {
      logger.error("[ROUTING] Non-Error thrown:", error);
    }

    // Try fallback gateway as last resort
    try {
      const fallbackGateway = FALLBACK_GATEWAY;
      const { protocol, fqdn, port } = fallbackGateway.settings;

      // Extract the transaction ID or ArNS name from the original ar:// URL
      const arPath = arUrl.slice(5); // Remove 'ar://' prefix
      const [basePart, ...pathParts] = arPath.split("/");
      const remainingPath =
        pathParts.length > 0 ? "/" + pathParts.join("/") : "";

      let fallbackUrl;
      // Check if it's a transaction ID (43 chars of base64url) or an ArNS name
      const isTxId = /^[a-zA-Z0-9_-]{43}$/.test(basePart);

      if (isTxId) {
        // For transaction IDs, use path format: https://arweave.net/txid
        fallbackUrl = `${protocol}://${fqdn}${
          port ? `:${port}` : ""
        }/${basePart}${remainingPath}`;
      } else {
        // For ArNS names, use subdomain format: https://name.arweave.net
        fallbackUrl = `${protocol}://${basePart}.${fqdn}${
          port ? `:${port}` : ""
        }${remainingPath}`;
      }

      logger.warn(`[FALLBACK] Using ${fqdn} - ${userFriendlyMessage}`);

      return {
        url: fallbackUrl,
        gatewayFQDN: fqdn,
        gatewayProtocol: protocol,
        gatewayPort: port,
        gatewayAddress: fallbackGateway.gatewayAddress || "FALLBACK",
        selectedGateway: fallbackGateway,
        // error: userFriendlyMessage, // Include error message for UI display
      };
    } catch (_fallbackError) {
      logger.error("[CRITICAL] Fallback failed");
      throw new Error(userFriendlyMessage);
    }
  }
}

/**
 * Lookup the Arweave transaction ID for a given domain using DNS TXT records.
 * (Kept from legacy implementation for gasless ArNS support)
 */
async function lookupArweaveTxIdForDomain(
  domain: string
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
    logger.debug("Checking DNS TXT record for:", domain);
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
    logger.error("[ERROR] Failed to lookup DNS TXT records:", error);
    return null;
  }
}

/**
 * Make a verified request using the Wayfinder core library
 */
export async function makeVerifiedRequest(
  arUrl: string,
  init?: RequestInit
): Promise<Response> {
  const wayfinder = await getWayfinderInstance();

  logger.info(`[REQUEST] Making verified request to ${arUrl}`);

  return wayfinder.request(arUrl, init);
}
