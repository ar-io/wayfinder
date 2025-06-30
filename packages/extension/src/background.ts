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

import { AOProcess, ARIO, AoGateway, WalletAddress } from '@ar.io/sdk/web';
import { connect } from '@permaweb/aoconnect';
import { ChromeStorageGatewayProvider } from './adapters/chrome-storage-gateway-provider';
import {
  clearVerificationCache,
  getCacheStats,
  setupCacheCleanup,
} from './cache-management';
import { EXTENSION_DEFAULTS, WAYFINDER_DEFAULTS } from './config/defaults';
import { ARIO_MAINNET_PROCESS_ID, DEFAULT_AO_CU_URL } from './constants';
import {
  showVerificationToast,
  verifyContentDigest,
} from './digest-verification';
import {
  isKnownGateway,
  normalizeGatewayFQDN,
  updateGatewayPerformance,
} from './helpers';
import {
  getRoutableGatewayUrl,
  getWayfinderInstance,
  resetWayfinderInstance,
} from './routing';
import { RedirectedTabInfo } from './types';
import { circuitBreaker } from './utils/circuit-breaker';
import {
  createErrorResponse,
  createSuccessResponse,
  handleAsyncOperation,
} from './utils/error-handler';
import { logger } from './utils/logger';

// Enhanced tab state management
class TabStateManager {
  private states = new Map<number, RedirectedTabInfo & { timestamp: number }>();
  private cleanupInterval: ReturnType<typeof setInterval>;

  constructor() {
    // Clean up stale states every 30 seconds
    this.cleanupInterval = setInterval(() => this.cleanup(), 30000);
  }

  set(tabId: number, info: RedirectedTabInfo): void {
    this.states.set(tabId, { ...info, timestamp: Date.now() });
  }

  get(tabId: number): RedirectedTabInfo | undefined {
    const state = this.states.get(tabId);
    return state ? { ...state } : undefined;
  }

  delete(tabId: number): boolean {
    return this.states.delete(tabId);
  }

  private cleanup(): void {
    const now = Date.now();
    const timeout = 60000; // 1 minute timeout for stale states

    for (const [tabId, state] of this.states) {
      if (now - state.timestamp > timeout) {
        this.states.delete(tabId);
        logger.debug(`Cleaned up stale tab state for tab ${tabId}`);
      }
    }
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.states.clear();
  }
}

// Global variables
const tabStateManager = new TabStateManager();
const requestTimings = new Map<string, number>();

// Bypass storage keys
const BYPASS_STORAGE_KEY = 'verificationBypasses';
const BYPASS_SESSION_KEY = 'verificationBypassSession';

logger.info('Initializing Wayfinder Extension with Core Library');

// Removed checkBypass function - unused

/**
 * Update daily statistics
 */
async function updateDailyStats(
  type: 'request' | 'verified' | 'failed' | 'totalRequest' = 'request',
) {
  const today = new Date().toDateString();
  const { dailyStats } = await chrome.storage.local.get(['dailyStats']);

  // Reset stats if it's a new day
  const stats =
    dailyStats && dailyStats.date === today
      ? dailyStats
      : {
          date: today,
          requestCount: 0,
          totalRequestCount: 0,
          verifiedCount: 0,
          failedCount: 0,
        };

  // Increment the appropriate counter
  switch (type) {
    case 'request':
      stats.requestCount++;
      break;
    case 'totalRequest':
      stats.totalRequestCount++;
      break;
    case 'verified':
      stats.verifiedCount++;
      break;
    case 'failed':
      stats.failedCount++;
      break;
  }

  await chrome.storage.local.set({ dailyStats: stats });
  logger.debug(
    `Updated daily stats: ${type} - Total requests today: ${stats.requestCount}`,
  );
}

// Initialize AR.IO SDK
let arIO = ARIO.init({
  process: new AOProcess({
    processId: ARIO_MAINNET_PROCESS_ID,
    ao: connect({
      CU_URL: DEFAULT_AO_CU_URL,
      MODE: 'legacy',
    }),
  }),
});

// Initialize Chrome storage with defaults
(async () => {
  const { dailyStats, processId, aoCuUrl, localGatewayAddressRegistry } =
    await chrome.storage.local.get([
      'dailyStats',
      'processId',
      'aoCuUrl',
      'localGatewayAddressRegistry',
    ]);

  const today = new Date().toDateString();

  // Preserve existing stats for today if they exist
  const existingStats =
    dailyStats && dailyStats.date === today
      ? dailyStats
      : {
          date: today,
          requestCount: 0,
          verifiedCount: 0,
          failedCount: 0,
        };

  // Only set defaults if they don't already exist
  const updates: any = {
    dailyStats: existingStats,
  };

  // Set defaults only if not already present
  if (!processId) updates.processId = EXTENSION_DEFAULTS.processId;
  if (!aoCuUrl) updates.aoCuUrl = EXTENSION_DEFAULTS.aoCuUrl;
  if (!localGatewayAddressRegistry)
    updates.localGatewayAddressRegistry =
      EXTENSION_DEFAULTS.localGatewayAddressRegistry;

  // Only set these if they don't exist in storage
  const {
    routingMethod,
    blacklistedGateways,
    ensResolutionEnabled,
    verificationStrict: existingVerificationStrict,
  } = await chrome.storage.local.get([
    'routingMethod',
    'blacklistedGateways',
    'ensResolutionEnabled',
    'verificationStrict',
  ]);

  if (routingMethod === undefined)
    updates.routingMethod = EXTENSION_DEFAULTS.routingMethod;
  if (blacklistedGateways === undefined)
    updates.blacklistedGateways = EXTENSION_DEFAULTS.blacklistedGateways;
  if (ensResolutionEnabled === undefined)
    updates.ensResolutionEnabled = EXTENSION_DEFAULTS.ensResolutionEnabled;
  if (existingVerificationStrict === undefined)
    updates.verificationStrict = WAYFINDER_DEFAULTS.verificationStrict;

  await chrome.storage.local.set(updates);
  logger.info('Initialized storage with defaults', updates);
})();

// Initialize performance data structure if needed
chrome.storage.local
  .get(['gatewayPerformance'])
  .then(({ gatewayPerformance }) => {
    if (!gatewayPerformance) {
      chrome.storage.local.set({ gatewayPerformance: {} });
      logger.debug('Initialized empty gateway performance storage');
    }
  })
  .catch((error) => {
    logger.error('Failed to initialize gateway performance storage:', error);
  });

// Create gateway provider instance
const gatewayProvider = new ChromeStorageGatewayProvider();

/**
 * Initialize Wayfinder with gateway sync and core library setup
 */
async function initializeWayfinder() {
  logger.debug('Initializing Wayfinder with Core Library');

  try {
    // Sync gateway registry first
    await syncGatewayAddressRegistry();

    // Verify we have gateways
    const { localGatewayAddressRegistry = {} } = await chrome.storage.local.get(
      ['localGatewayAddressRegistry'],
    );
    const gatewayCount = Object.keys(localGatewayAddressRegistry).length;

    if (gatewayCount === 0) {
      logger.warn(
        'No gateways found after sync. Users will need to manually sync or fallback gateways will be used.',
      );
    } else {
      logger.info(`Successfully synced ${gatewayCount} gateways`);
    }

    // Initialize Wayfinder instance - this will be created lazily on first use
    logger.info('Wayfinder initialization completed');
  } catch (error) {
    logger.error('Error during Wayfinder initialization:', error);
    logger.warn(
      'Users can manually sync gateways in Settings > Network Configuration',
    );
  }
}

/**
 * Handles browser navigation for `ar://` links using Wayfinder core library
 * FIXED: Back to direct gateway routing with verification tracking
 */
chrome.webNavigation.onBeforeNavigate.addListener(
  async (details) => {
    let arUrl: string | null = null;
    try {
      // Only process main frame to avoid iframe noise
      if (details.frameId !== 0) return;

      const url = new URL(details.url);

      // Check if this is a direct gateway URL that should use Verified Browsing
      const { verifiedBrowsing = false, verifiedBrowsingExceptions = [] } =
        await chrome.storage.local.get([
          'verifiedBrowsing',
          'verifiedBrowsingExceptions',
        ]);

      if (verifiedBrowsing && !url.href.includes('viewer.html')) {
        // Check if this is a known gateway URL
        const isGateway = await isKnownGateway(url.hostname);

        if (isGateway) {
          let arUrl: string | null = null;

          // Check for transaction ID in path
          const txIdMatch = url.pathname.match(/^\/([a-zA-Z0-9_-]{43})/);
          if (txIdMatch) {
            const txId = txIdMatch[1];
            const path = url.pathname.substring(txId.length + 1);
            arUrl = `ar://${txId}${path}`;
          }
          // Check for ArNS subdomain (e.g., ardrive.arweave.net)
          else if (url.hostname.includes('.')) {
            const parts = url.hostname.split('.');
            if (parts.length >= 2) {
              // Check if this looks like an ArNS subdomain
              const possibleArns = parts[0];
              // Skip if it's www or other common subdomains
              if (
                possibleArns &&
                !['www', 'api', 'gateway'].includes(possibleArns)
              ) {
                arUrl = `ar://${possibleArns}${url.pathname}`;
              }
            }
          }

          if (arUrl) {
            // Check if this is an API endpoint that we shouldn't intercept
            const apiPaths = [
              '/info',
              '/gateway',
              '/graphql',
              '/ar-io',
              '/api-docs',
              '/openapi.json',
              '/block',
              '/tx',
              '/chunk',
              '/data_sync',
              '/peers',
              '/price',
              '/wallet',
              '/mine',
              '/metrics',
              '/health',
            ];

            // Check if the path starts with any API endpoint
            const isApiEndpoint = apiPaths.some(
              (apiPath) =>
                url.pathname === apiPath ||
                url.pathname.startsWith(apiPath + '/'),
            );

            if (isApiEndpoint) {
              logger.info(
                `[VERIFIED-BROWSING] Skipping API endpoint: ${url.href}`,
              );
              return;
            }

            // Check if this URL is in exceptions
            const isException = verifiedBrowsingExceptions.some((exception) => {
              if (exception.startsWith('ar://')) {
                return arUrl === exception || arUrl.startsWith(exception + '/');
              } else {
                // Domain exception
                return (
                  url.hostname === exception ||
                  url.hostname.endsWith(`.${exception}`)
                );
              }
            });

            if (isException) {
              logger.info(
                `[VERIFIED-BROWSING] URL is in exceptions, skipping verification: ${arUrl}`,
              );
              return;
            }

            logger.info(
              `[VERIFIED-BROWSING] Intercepting gateway URL: ${url.href} -> ${arUrl}`,
            );

            // Redirect to viewer.html with both ar:// URL and gateway URL
            const viewerUrl = chrome.runtime.getURL(
              `viewer.html?url=${encodeURIComponent(arUrl)}&gateway=${encodeURIComponent(url.href)}`,
            );
            chrome.tabs.update(details.tabId, { url: viewerUrl });
            return;
          }
        }
      }

      // Original ar:// URL handling
      arUrl = url.searchParams.get('q');

      if (!arUrl || !arUrl.startsWith('ar://')) return;

      // Validate ar:// URL format
      if (arUrl.length < 6) {
        logger.error(`Invalid ar:// URL format: ${arUrl}`);
        return;
      }

      logger.debug(`Processing ar:// navigation: ${arUrl}`);

      // Process immediately without setTimeout to prevent race conditions
      const startTime = performance.now();

      // Get the routable gateway URL using Wayfinder
      const result = await getRoutableGatewayUrl(arUrl);

      if (result?.url) {
        // Track redirect BEFORE navigation to prevent timing issues
        tabStateManager.set(details.tabId, {
          originalGateway: result.gatewayFQDN || 'unknown',
          expectedSandboxRedirect: /^[a-z0-9_-]{43}$/i.test(arUrl.slice(5)),
          startTime,
          arUrl,
          verification: result.verification, // Add verification info
        });

        // Navigate to the gateway URL directly
        chrome.tabs.update(details.tabId, { url: result.url });
        logger.debug(
          `Redirected ${arUrl} to ${result.url} via ${result.gatewayFQDN}`,
        );

        // Track the request
        updateDailyStats('request');

        // NOTE: Verification happens on the browser's navigation request itself
        // We'll capture the verification status from response headers
      } else {
        const errorMessage =
          (result as any)?.error ||
          'No available gateways could handle this request.';
        logger.error(`Failed to route ${arUrl}: ${errorMessage}`);
        // Show error to user with styling
        chrome.tabs.update(details.tabId, {
          url: `data:text/html,
            <!DOCTYPE html>
            <html>
            <head>
              <title>Wayfinder Error</title>
              <style>
                body {
                  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                  background: #f5f5f5;
                  color: #333;
                  margin: 0;
                  padding: 40px;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  min-height: 100vh;
                }
                .error-container {
                  background: white;
                  border-radius: 8px;
                  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
                  padding: 40px;
                  max-width: 600px;
                  text-align: center;
                }
                h1 {
                  color: #e74c3c;
                  margin: 0 0 16px;
                  font-size: 24px;
                }
                .url {
                  background: #f8f8f8;
                  padding: 8px 16px;
                  border-radius: 4px;
                  font-family: monospace;
                  margin: 16px 0;
                  word-break: break-all;
                }
                .error-message {
                  color: #666;
                  margin: 16px 0;
                  line-height: 1.5;
                }
                .actions {
                  margin-top: 24px;
                }
                button {
                  background: #3498db;
                  color: white;
                  border: none;
                  padding: 12px 24px;
                  border-radius: 4px;
                  font-size: 16px;
                  cursor: pointer;
                  margin: 0 8px;
                }
                button:hover {
                  background: #2980b9;
                }
              </style>
            </head>
            <body>
              <div class="error-container">
                <h1>Failed to Route AR.IO Request</h1>
                <div class="url">${arUrl}</div>
                <div class="error-message">${errorMessage}</div>
                <div class="actions">
                  <button onclick="history.back()">Go Back</button>
                  <button onclick="chrome.runtime.sendMessage({type: 'openSettings'})">Open Settings</button>
                </div>
              </div>
            </body>
            </html>`,
        });
      }
    } catch (error) {
      logger.error('Error processing ar:// navigation:', error);
      // Show error page to user
      try {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error occurred';
        chrome.tabs.update(details.tabId, {
          url: `data:text/html,
            <!DOCTYPE html>
            <html>
            <head>
              <title>Wayfinder Error</title>
              <style>
                body {
                  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                  background: #f5f5f5;
                  color: #333;
                  margin: 0;
                  padding: 40px;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  min-height: 100vh;
                }
                .error-container {
                  background: white;
                  border-radius: 8px;
                  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
                  padding: 40px;
                  max-width: 600px;
                  text-align: center;
                }
                h1 {
                  color: #e74c3c;
                  margin: 0 0 16px;
                  font-size: 24px;
                }
                .error-message {
                  color: #666;
                  margin: 16px 0;
                  line-height: 1.5;
                }
                .actions {
                  margin-top: 24px;
                }
                button {
                  background: #3498db;
                  color: white;
                  border: none;
                  padding: 12px 24px;
                  border-radius: 4px;
                  font-size: 16px;
                  cursor: pointer;
                }
                button:hover {
                  background: #2980b9;
                }
              </style>
            </head>
            <body>
              <div class="error-container">
                <h1>Error Processing AR.IO URL</h1>
                <div class="error-message">${errorMessage}</div>
                <div class="actions">
                  <button onclick="history.back()">Go Back</button>
                </div>
              </div>
            </body>
            </html>`,
        });
      } catch (tabError) {
        logger.error('Failed to update tab with error page:', tabError);
      }
    }
  },
  { url: [{ schemes: ['http', 'https'] }] },
);

/**
 * Clean up tab state when tabs are closed
 */
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabStateManager.delete(tabId)) {
    logger.debug(`Cleaned up state for closed tab ${tabId}`);
  }
});

/**
 * Track request timing for performance metrics
 */
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    requestTimings.set(details.requestId, performance.now());
  },
  { urls: ['<all_urls>'] },
);

/**
 * Handle successful requests - update performance metrics and verify data
 */
chrome.webRequest.onCompleted.addListener(
  async (details) => {
    const gatewayFQDN = new URL(details.url).hostname;

    // Only track requests from ar:// redirections
    const tabInfo = tabStateManager.get(details.tabId);
    if (!tabInfo) return;

    const responseTime = performance.now() - tabInfo.startTime;

    // Update performance metrics via gateway provider
    await gatewayProvider.updateGatewayPerformance(
      gatewayFQDN,
      responseTime,
      true,
    );

    // Record success in circuit breaker
    circuitBreaker.onSuccess(gatewayFQDN);

    logger.debug(
      `Updated performance for ${gatewayFQDN}: ${responseTime.toFixed(2)}ms`,
    );

    // Clean up tracking
    tabStateManager.delete(details.tabId);
  },
  { urls: ['<all_urls>'] },
);

// Removed getHeaderValue function - unused

/**
 * Capture verification status from gateway response headers
 * Note: Cannot use blocking mode without enterprise deployment
 */
chrome.webRequest.onHeadersReceived.addListener(
  async (details) => {
    // Check if this request is from the viewer iframe
    if (
      details.initiator?.startsWith('chrome-extension://') &&
      details.url.includes('viewer.html')
    ) {
      // This is a request from within the viewer page itself, skip
      return;
    }

    // Check if request is initiated from viewer.html iframe
    if (details.tabId !== -1) {
      try {
        const tab = await chrome.tabs.get(details.tabId);
        if (tab.url?.includes('viewer.html')) {
          // This is a resource request from viewer iframe
          await handleViewerResourceRequest(details);
        }
      } catch (_error) {
        // Tab might not exist anymore
      }
    }
    const tabInfo = tabStateManager.get(details.tabId);

    if (tabInfo && tabInfo.arUrl) {
      // Parse response headers
      let arnsResolvedId: string | null = null;
      let dataId: string | null = null;
      let digest: string | null = null;

      for (const header of details.responseHeaders || []) {
        const headerName = header.name.toLowerCase();
        const headerValue = header.value || '';

        switch (headerName) {
          case 'x-ar-io-digest':
            digest = headerValue;
            break;
          case 'x-arns-resolved-id':
            arnsResolvedId = headerValue;
            logger.debug(`ArNS resolved: ${details.url} -> ${headerValue}`);
            break;
          case 'x-ar-io-data-id':
            dataId = headerValue;
            break;
        }
      }

      // Check if verification is enabled
      const { verifiedBrowsing, showVerificationToasts } =
        await chrome.storage.local.get([
          'verifiedBrowsing',
          'showVerificationToasts',
        ]);

      if (verifiedBrowsing && digest) {
        // Perform digest verification in the background
        logger.info(
          '[VERIFY] Starting digest verification for:',
          tabInfo.arUrl,
        );

        verifyContentDigest(tabInfo.arUrl, digest, dataId)
          .then((result) => {
            logger.info('[VERIFY] Digest verification completed:', {
              verified: result.verified,
              confidence: result.confidence,
              matchingGateways: result.matchingGateways,
              totalGateways: result.totalGateways,
            });

            // Update cache with verification result
            const { verificationCache } = require('./utils/verification-cache');
            verificationCache.set(tabInfo.arUrl, {
              verified: result.verified,
              actualDigest: digest || undefined,
              status: 'completed',
              strategy: 'digest-comparison',
              verificationResult: result,
              dataId: dataId || arnsResolvedId || undefined,
              timestamp: Date.now(),
            });

            // Show toast if enabled
            if (showVerificationToasts) {
              showVerificationToast(details.tabId, result);
            }

            // Update stats
            if (result.verified) {
              updateDailyStats('verified');
            } else if (result.confidence === 'none') {
              updateDailyStats('failed');
            }
          })
          .catch((error) => {
            logger.error('[VERIFY] Digest verification error:', error);
          });
      } else {
        // Only cache ArNS resolution data if it exists and verified browsing is enabled
        const { verifiedBrowsing = false } = await chrome.storage.local.get([
          'verifiedBrowsing',
        ]);

        if (verifiedBrowsing && (dataId || arnsResolvedId)) {
          const { verificationCache } = await import(
            './utils/verification-cache'
          );
          await verificationCache.set(tabInfo.arUrl, {
            verified: false,
            actualDigest: digest || undefined,
            status: 'completed',
            strategy: 'none',
            dataId: dataId || arnsResolvedId || undefined,
            timestamp: Date.now(),
          });
        }
      }

      // Clean up
      tabStateManager.delete(details.tabId);
    }
  },
  { urls: ['<all_urls>'] },
  ['responseHeaders'],
);

/**
 * Handle failed requests
 */
chrome.webRequest.onErrorOccurred.addListener(
  async (details) => {
    const gatewayFQDN = new URL(details.url).hostname;

    // Only track failures from ar:// redirections
    const tabInfo = tabStateManager.get(details.tabId);
    if (tabInfo) {
      await gatewayProvider.updateGatewayPerformance(
        gatewayFQDN,
        Infinity,
        false,
      );

      // Record failure in circuit breaker
      circuitBreaker.onFailure(gatewayFQDN);

      logger.warn(`Request failed to ${gatewayFQDN}: ${details.error}`);

      tabStateManager.delete(details.tabId);
    }
  },
  { urls: ['<all_urls>'] },
);

/**
 * Track web requests to known gateways for performance monitoring
 */
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    const url = new URL(details.url);

    // Check if this is a request to a known gateway
    isKnownGateway(url.hostname).then((isKnown) => {
      if (isKnown) {
        requestTimings.set(details.requestId.toString(), performance.now());
      }
    });
  },
  { urls: ['<all_urls>'] },
);

chrome.webRequest.onCompleted.addListener(
  async (details) => {
    const requestId = details.requestId.toString();
    const startTime = requestTimings.get(requestId);

    if (startTime) {
      const url = new URL(details.url);

      // Update performance metrics
      await updateGatewayPerformance(url.hostname, startTime);

      // Clean up
      requestTimings.delete(requestId);
    }
  },
  { urls: ['<all_urls>'] },
);

chrome.webRequest.onErrorOccurred.addListener(
  async (details) => {
    const requestId = details.requestId.toString();
    const startTime = requestTimings.get(requestId);

    if (startTime) {
      const url = new URL(details.url);

      // Track failure
      const isKnown = await isKnownGateway(url.hostname);
      if (isKnown) {
        const storage = await chrome.storage.local.get(['gatewayPerformance']);
        const gatewayPerformance = storage.gatewayPerformance || {};
        const gatewayFQDN = await normalizeGatewayFQDN(url.hostname);

        if (!gatewayPerformance[gatewayFQDN]) {
          gatewayPerformance[gatewayFQDN] = {
            avgResponseTime: 0,
            failures: 1,
            successCount: 0,
          };
        } else {
          gatewayPerformance[gatewayFQDN].failures += 1;
        }

        await chrome.storage.local.set({ gatewayPerformance });
      }

      // Clean up
      requestTimings.delete(requestId);
    }
  },
  { urls: ['<all_urls>'] },
);

/**
 * Track ALL web requests for permaweb vs regular web ratio calculation
 */
chrome.webRequest.onCompleted.addListener(
  async (details) => {
    // Only track main frame requests (not images, scripts, etc.) to avoid inflating counts
    if (details.type !== 'main_frame') return;

    // Skip chrome:// and extension:// URLs
    if (
      details.url.startsWith('chrome://') ||
      details.url.startsWith('extension://')
    )
      return;

    try {
      const url = new URL(details.url);

      // Update total request count
      updateDailyStats('totalRequest');

      // Check if this is a request to an AR.IO gateway
      const { localGatewayAddressRegistry = {} } =
        await chrome.storage.local.get(['localGatewayAddressRegistry']);
      const isArioGateway = Object.values(localGatewayAddressRegistry).some(
        (gateway: any) => {
          return gateway.settings?.fqdn === url.hostname;
        },
      );

      // If it's an AR.IO gateway request that's not already tracked by ar:// navigation, count it
      if (isArioGateway) {
        const tabInfo = tabStateManager.get(details.tabId);
        if (!tabInfo) {
          // This is a direct navigation to an AR.IO gateway (not via ar:// redirection)
          updateDailyStats('request');
        }
      }
    } catch {
      // Ignore malformed URLs
    }
  },
  { urls: ['http://*/*', 'https://*/*'] },
);

/**
 * Clean up request timings periodically
 */
setInterval(() => {
  const now = performance.now();
  for (const [requestId, timestamp] of requestTimings.entries()) {
    if (now - timestamp > 60000) {
      requestTimings.delete(requestId);
    }
  }
}, 30000);

/**
 * Handle messages from content scripts and popup
 */
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  // Validate message types
  const validMessages = [
    'syncGatewayAddressRegistry',
    'setArIOProcessId',
    'setAoCuUrl',
    'resetWayfinder',
    'updateRoutingStrategy',
    'updateVerificationMode',
    'updateAdvancedSettings',
    'resetAdvancedSettings',
    'getCacheStats',
    'clearVerificationCache',
    'testConnection',
  ];
  const validTypes = [
    'convertArUrlToHttpUrl',
    'openSettings',
    'checkVerificationCache',
    'proceedWithBypass',
    'VERIFY_GATEWAY_RESOURCE',
    'FETCH_VERIFIED_CONTENT',
    'FETCH_VERIFIED_RESOURCE',
  ];

  if (
    !validMessages.includes(request.message) &&
    !validTypes.includes(request.type)
  ) {
    logger.warn('Unauthorized message:', request);
    return;
  }

  // Handle openSettings from error pages
  if (request.type === 'openSettings') {
    chrome.runtime.openOptionsPage();
    return;
  }

  // Sync gateway registry
  if (request.message === 'syncGatewayAddressRegistry') {
    handleAsyncOperation(async () => {
      await syncGatewayAddressRegistry();
      resetWayfinderInstance();
      return createSuccessResponse();
    }, 'sync gateway address registry').then((result) => {
      sendResponse(
        result || createErrorResponse(new Error('Unknown error'), 'sync GAR'),
      );
    });
    return true;
  }

  // Set AO CU URL
  if (request.message === 'setAoCuUrl') {
    reinitializeArIO()
      .then(() => syncGatewayAddressRegistry())
      .then(() => {
        resetWayfinderInstance();
        sendResponse({ success: true });
      })
      .catch((error) => {
        logger.error('Failed to set new AO CU URL:', error);
        sendResponse({
          error: 'Failed to set new AO CU URL and reinitialize AR.IO.',
        });
      });
    return true;
  }

  // Reset Wayfinder instance (for configuration changes)
  if (request.message === 'resetWayfinder') {
    resetWayfinderInstance();
    sendResponse({ success: true });
    return;
  }

  // Check verification cache
  if (request.type === 'checkVerificationCache') {
    (async () => {
      try {
        const { verificationCache } = await import(
          './utils/verification-cache'
        );
        const cached = await verificationCache.get(request.url);

        if (cached) {
          sendResponse({
            cached: true,
            result: {
              verified: cached.verified,
              strategy: cached.strategy,
              error: cached.error,
            },
          });
        } else {
          sendResponse({ cached: false });
        }
      } catch (error: any) {
        logger.error('Error checking verification cache:', error);
        sendResponse({ error: error?.message || 'Unknown error' });
      }
    })();
    return true;
  }

  // Convert ar:// URL to HTTP URL
  if (request.type === 'convertArUrlToHttpUrl') {
    const arUrl = request.arUrl;
    getRoutableGatewayUrl(arUrl)
      .then((response) => {
        if (!response || !response.url) {
          throw new Error('URL resolution failed, response is invalid');
        }
        sendResponse({ url: response.url });
      })
      .catch((error) => {
        logger.error('Error converting ar:// URL:', error);
        sendResponse({ error: error.message });
      });
    return true;
  }

  // Handle proceed with bypass from warning page
  if (request.type === 'proceedWithBypass') {
    (async () => {
      try {
        const { url, permanent } = request;

        // Save bypass decision
        if (permanent) {
          const { [BYPASS_STORAGE_KEY]: bypasses = {} } =
            await chrome.storage.local.get(BYPASS_STORAGE_KEY);
          bypasses[url] = {
            timestamp: Date.now(),
            permanent: true,
          };
          await chrome.storage.local.set({ [BYPASS_STORAGE_KEY]: bypasses });
        } else {
          const { [BYPASS_SESSION_KEY]: sessionBypasses = {} } =
            await chrome.storage.session.get(BYPASS_SESSION_KEY);
          sessionBypasses[url] = {
            timestamp: Date.now(),
            permanent: false,
          };
          await chrome.storage.session.set({
            [BYPASS_SESSION_KEY]: sessionBypasses,
          });
        }

        // Get the routable URL
        const result = await getRoutableGatewayUrl(url);

        if (result?.url) {
          sendResponse({ success: true, redirectUrl: result.url });
        } else {
          sendResponse({ error: 'Failed to resolve URL' });
        }
      } catch (error: any) {
        logger.error('Error processing bypass:', error);
        sendResponse({ error: error?.message || 'Unknown error' });
      }
    })();
    return true;
  }

  // Handle routing strategy updates
  if (request.message === 'updateRoutingStrategy') {
    logger.info(`[SETTINGS] Updating routing strategy to: ${request.strategy}`);
    (async () => {
      try {
        await chrome.storage.local.set({ routingMethod: request.strategy });
        logger.info(
          `[SETTINGS] Routing strategy saved to storage: ${request.strategy}`,
        );

        // Reset Wayfinder instance to use new strategy
        resetWayfinderInstance();

        // Verify the setting was saved
        const { routingMethod } =
          await chrome.storage.local.get('routingMethod');
        logger.info(
          `[SETTINGS] Verified routing method in storage: ${routingMethod}`,
        );

        sendResponse({ success: true });
      } catch (error: any) {
        logger.error('Error updating routing strategy:', error);
        sendResponse({ error: error?.message || 'Unknown error' });
      }
    })();
    return true; // Keep message channel open for async response
  }

  // Handle verification mode updates
  if (request.message === 'updateVerificationMode') {
    (async () => {
      try {
        await chrome.storage.local.set({ verificationMode: request.mode });
        // Reset Wayfinder instance to use new verification mode
        resetWayfinderInstance();
        sendResponse({ success: true });
      } catch (error: any) {
        logger.error('Error updating verification mode:', error);
        sendResponse({ error: error?.message || 'Unknown error' });
      }
    })();
    return true;
  }

  // Handle advanced settings updates
  if (request.message === 'updateAdvancedSettings') {
    (async () => {
      try {
        await chrome.storage.local.set(request.settings);
        // Reset Wayfinder instance to use new settings
        resetWayfinderInstance();
        sendResponse({ success: true });
      } catch (error: any) {
        logger.error('Error updating advanced settings:', error);
        sendResponse({ error: error?.message || 'Unknown error' });
      }
    })();
    return true;
  }

  // Handle advanced settings reset
  if (request.message === 'resetAdvancedSettings') {
    (async () => {
      try {
        await chrome.storage.local.remove(['processId', 'aoCuUrl']);
        // Reset Wayfinder instance to use defaults
        resetWayfinderInstance();
        sendResponse({ success: true });
      } catch (error: any) {
        logger.error('Error resetting advanced settings:', error);
        sendResponse({ error: error?.message || 'Unknown error' });
      }
    })();
    return true;
  }

  // Handle get cache stats
  if (request.message === 'getCacheStats') {
    (async () => {
      try {
        const stats = await getCacheStats();
        sendResponse({ success: true, stats });
      } catch (error: any) {
        logger.error('Error getting cache stats:', error);
        sendResponse({ error: error?.message || 'Unknown error' });
      }
    })();
    return true;
  }

  // Handle fetch verified content
  if (request.type === 'FETCH_VERIFIED_CONTENT') {
    (async () => {
      try {
        const result = await handleVerifiedContentFetch(request.url);
        sendResponse(result);
      } catch (error: any) {
        logger.error('Error fetching verified content:', error);
        sendResponse({
          error: error?.message || 'Failed to fetch verified content',
        });
      }
    })();
    return true;
  }

  // Handle clear verification cache
  if (request.message === 'clearVerificationCache') {
    (async () => {
      try {
        await clearVerificationCache();
        sendResponse({ success: true });
      } catch (error: any) {
        logger.error('Error clearing verification cache:', error);
        sendResponse({ error: error?.message || 'Unknown error' });
      }
    })();
    return true;
  }

  // Handle verify gateway resource (from service worker)
  if (request.type === 'VERIFY_GATEWAY_RESOURCE') {
    (async () => {
      try {
        const result = await handleGatewayResourceVerification(request);
        sendResponse(result);
      } catch (error: any) {
        logger.error('Error verifying gateway resource:', error);
        sendResponse({
          verified: false,
          error: error?.message || 'Verification failed',
        });
      }
    })();
    return true;
  }

  // Handle connection test
  if (request.message === 'testConnection') {
    (async () => {
      try {
        // Try to get a gateway from local registry first
        const { localGatewayAddressRegistry = {} } =
          await chrome.storage.local.get(['localGatewayAddressRegistry']);
        const gateways = Object.values(localGatewayAddressRegistry)
          .filter((g: any) => g.status === 'joined' && g.settings?.fqdn)
          .sort(
            (a: any, b: any) => (b.operatorStake || 0) - (a.operatorStake || 0),
          );

        let isConnected = false;

        if (gateways.length > 0) {
          // Use the top gateway from registry
          const gateway = gateways[0] as any;
          const url = `${gateway.settings.protocol || 'https'}://${
            gateway.settings.fqdn
          }/info`;
          try {
            const response = await fetch(url, {
              method: 'GET',
              signal: AbortSignal.timeout(5000),
            });
            isConnected = response.ok;
          } catch {
            isConnected = false;
          }
        } else {
          // Fallback to arweave.net as last resort
          try {
            const response = await fetch('https://arweave.net/info', {
              method: 'GET',
              signal: AbortSignal.timeout(5000),
            });
            isConnected = response.ok;
          } catch {
            isConnected = false;
          }
        }

        sendResponse({ success: true, isConnected });
      } catch (error: any) {
        logger.error('Error testing connection:', error);
        sendResponse({ success: false, isConnected: false });
      }
    })();
    return true;
  }

  // Handle fetch verified resource (from proxy page)
  if (request.type === 'FETCH_VERIFIED_RESOURCE') {
    (async () => {
      try {
        const result = await handleVerifiedResourceFetch(request.url);
        sendResponse(result);
      } catch (error: any) {
        logger.error('Error fetching verified resource:', error);
        sendResponse({
          error: error?.message || 'Failed to fetch verified resource',
        });
      }
    })();
    return true;
  }
});

/**
 * Update sync status in storage
 */
async function updateSyncStatus(
  status: 'idle' | 'syncing' | 'completed' | 'error',
  error?: string,
): Promise<void> {
  const update: any = {
    syncStatus: status,
    lastSyncAttempt: Date.now(),
  };

  if (status === 'completed') {
    update.lastSyncSuccess = Date.now();
    update.syncError = null;
  } else if (status === 'error' && error) {
    update.syncError = error;
  }

  await chrome.storage.local.set(update);
  logger.info(`[SYNC] Status updated to: ${status}`);
}

/**
 * Sync gateway address registry from AR.IO network
 */
async function syncGatewayAddressRegistry(): Promise<void> {
  try {
    // Update status to syncing
    await updateSyncStatus('syncing');
    const { processId, aoCuUrl } = await chrome.storage.local.get([
      'processId',
      'aoCuUrl',
    ]);

    if (!processId || !aoCuUrl) {
      logger.warn('Process ID or AO CU URL not found, using defaults...');
      // Use defaults if not set
      const defaultProcessId = processId || ARIO_MAINNET_PROCESS_ID;
      const defaultAoCuUrl = aoCuUrl || DEFAULT_AO_CU_URL;

      // Save defaults
      await chrome.storage.local.set({
        processId: defaultProcessId,
        aoCuUrl: defaultAoCuUrl,
      });

      // Initialize AR.IO with defaults
      arIO = ARIO.init({
        process: new AOProcess({
          processId: defaultProcessId,
          ao: connect({
            CU_URL: defaultAoCuUrl,
            MODE: 'legacy',
          }),
        }),
      });
    }

    logger.info(
      `Syncing Gateway Address Registry from ${aoCuUrl || DEFAULT_AO_CU_URL}`,
    );

    const registry: Record<WalletAddress, AoGateway> = {};
    let cursor: string | undefined = undefined;
    let totalFetched = 0;

    do {
      const response = await arIO.getGateways({
        limit: 1000,
        cursor,
      });

      if (!response?.items || response.items.length === 0) {
        logger.warn('No gateways found in this batch.');
        break;
      }

      response.items.forEach(({ gatewayAddress, ...gatewayData }) => {
        registry[gatewayAddress] = gatewayData;
      });

      totalFetched += response.items.length;
      cursor = response.nextCursor;
    } while (cursor);

    if (totalFetched === 0) {
      logger.warn('No gateways found after full sync.');
      await updateSyncStatus('error', 'No gateways found');
    } else {
      // Save registry and update counts
      await chrome.storage.local.set({
        localGatewayAddressRegistry: registry,
        lastKnownGatewayCount: totalFetched,
        lastSyncTime: Date.now(),
      } as any);

      logger.info(`Synced ${totalFetched} gateways to registry.`);
      await updateSyncStatus('completed');
    }
  } catch (error) {
    logger.error('Error syncing Gateway Address Registry:', error);
    await updateSyncStatus(
      'error',
      error instanceof Error ? error.message : 'Unknown error',
    );
    throw error;
  }
}

/**
 * Reinitialize AR.IO with updated configuration
 */
async function reinitializeArIO(): Promise<void> {
  try {
    const { processId, aoCuUrl } = await chrome.storage.local.get([
      'processId',
      'aoCuUrl',
    ]);

    arIO = ARIO.init({
      process: new AOProcess({
        processId: processId,
        ao: connect({ MODE: 'legacy', CU_URL: aoCuUrl }),
      }),
    });

    logger.info('AR.IO reinitialized with Process ID:', processId);
  } catch (error) {
    logger.error('Failed to reinitialize AR.IO, using default:', error);
    arIO = ARIO.init();
  }
}

/**
 * Handle verification of individual gateway resources (from service worker)
 */
async function handleGatewayResourceVerification(request: {
  url: string;
  resourceType: string;
  strategy?: string;
}): Promise<{ verified: boolean; error?: string }> {
  try {
    const { url, resourceType } = request;

    logger.info(`[VERIFY-RESOURCE] Verifying ${resourceType} from ${url}`);

    // Check if this is actually a gateway URL
    const urlObj = new URL(url);
    const isGatewayUrl =
      urlObj.hostname.includes('arweave') ||
      urlObj.hostname.includes('ar.io') ||
      urlObj.hostname.includes('ar-io') ||
      urlObj.hostname.includes('g8way');

    if (!isGatewayUrl) {
      // Not a gateway URL, no need to verify
      return { verified: true };
    }

    // Extract transaction ID from URL if possible
    const pathMatch = urlObj.pathname.match(/^\/([a-zA-Z0-9_-]{43})/);
    if (!pathMatch) {
      // No transaction ID in path, can't verify
      logger.warn('[VERIFY-RESOURCE] No transaction ID found in URL');
      return { verified: false, error: 'No transaction ID in URL' };
    }

    const txId = pathMatch[1];
    const arUrl = `ar://${txId}${urlObj.pathname.substring(txId.length + 1)}`;

    // Get Wayfinder instance
    const wayfinder = await getWayfinderInstance();

    // Attempt to verify using HEAD request
    try {
      const response = await wayfinder.request(arUrl, {
        method: 'HEAD',
        signal: AbortSignal.timeout(5000),
      });

      // Check verification header
      const verifiedHeader = response.headers.get('x-wayfinder-verified');
      const verified = verifiedHeader === 'true';

      logger.info(
        `[VERIFY-RESOURCE] Resource ${verified ? 'verified' : 'not verified'}`,
      );

      return { verified };
    } catch (verifyError) {
      // HEAD request failed, try to at least check if resource exists
      logger.warn('[VERIFY-RESOURCE] Verification failed:', verifyError);
      return {
        verified: false,
        error:
          verifyError instanceof Error
            ? verifyError.message
            : 'Verification failed',
      };
    }
  } catch (error) {
    logger.error('[VERIFY-RESOURCE] Error:', error);
    return {
      verified: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Handle fetching and verifying content for viewer.html
 */
async function handleVerifiedContentFetch(arUrl: string): Promise<{
  verified: boolean;
  dataUrl?: string;
  cacheKey?: string;
  gatewayUrl?: string;
  error?: string;
  verificationInfo?: any;
}> {
  try {
    logger.info(`[VERIFY] Using Wayfinder to fetch and verify ${arUrl}`);

    const wayfinder = await getWayfinderInstance();

    // Track verification events
    let _verificationSucceeded = false;
    let verificationError: any = null;
    let routedGatewayUrl: string | undefined;

    // Set up one-time event listeners for this request with Promise
    const verificationPromise = new Promise<boolean>((resolve) => {
      let resolved = false;

      // Add routing success handler to capture gateway URL
      const handleRoutingSucceeded = (event: any) => {
        logger.info(`[VERIFY] Routing succeeded event:`, event);
        // Use redirectUrl from the event - this is what Wayfinder Core provides
        if (event.redirectUrl) {
          routedGatewayUrl = event.redirectUrl;
          logger.info(
            `[VERIFY] Captured gateway URL from routing event: ${routedGatewayUrl}`,
          );
        } else if (event.resolvedUrl) {
          // Fallback to resolvedUrl if it exists
          routedGatewayUrl = event.resolvedUrl;
          logger.info(
            `[VERIFY] Using resolvedUrl from event: ${routedGatewayUrl}`,
          );
        } else if (event.selectedGateway) {
          // Last fallback - just the gateway base URL
          logger.warn(
            `[VERIFY] No redirectUrl or resolvedUrl in event, using selectedGateway: ${event.selectedGateway}`,
          );
          routedGatewayUrl = event.selectedGateway;
        }
      };

      // Listen for routing event
      wayfinder.emitter.once('routing-succeeded', handleRoutingSucceeded);

      // Add progress handler
      const handleVerificationProgress = (event: any) => {
        const percentage = (event.processedBytes / event.totalBytes) * 100;
        const processedMB = (event.processedBytes / 1024 / 1024).toFixed(2);
        const totalMB = (event.totalBytes / 1024 / 1024).toFixed(2);
        //logger.info(
        //  `[VERIFY] Progress for ${event.txId}: ${percentage.toFixed(1)}% (${processedMB} MB / ${totalMB} MB)`,
        //);

        // Send progress update to viewer
        chrome.runtime
          .sendMessage({
            type: 'VERIFICATION_PROGRESS',
            percentage,
            processedMB,
            totalMB,
            txId: event.txId,
          })
          .catch(() => {
            // Ignore errors if no viewer is listening
          });
      };

      const handleVerificationSuccess = (event: any) => {
        if (!resolved) {
          logger.info(`[VERIFY] Verification succeeded for ${event.txId}`);
          _verificationSucceeded = true;
          resolved = true;
          resolve(true);
          // Clean up progress listener
          wayfinder.emitter.off(
            'verification-progress',
            handleVerificationProgress,
          );
        }
      };

      const handleVerificationFailed = (event: any) => {
        if (!resolved) {
          logger.error(`[VERIFY] Verification failed:`, event);
          verificationError = event;
          resolved = true;
          resolve(false);
          // Clean up progress listener
          wayfinder.emitter.off(
            'verification-progress',
            handleVerificationProgress,
          );
        }
      };

      wayfinder.emitter.once(
        'verification-succeeded',
        handleVerificationSuccess,
      );
      wayfinder.emitter.once('verification-failed', handleVerificationFailed);
      wayfinder.emitter.on('verification-progress', handleVerificationProgress);

      // Set a timeout in case verification events never fire
      setTimeout(() => {
        if (!resolved) {
          logger.warn(
            '[VERIFY] Verification timeout - no event received after 30 seconds',
          );
          resolved = true;
          resolve(false);
          // Clean up progress listener
          wayfinder.emitter.off(
            'verification-progress',
            handleVerificationProgress,
          );
        }
      }, 30000); // 30 seconds for large files
    });

    try {
      // Make the request - Wayfinder handles routing AND verification in one shot!
      logger.info(`[VERIFY] Making wayfinder request for: ${arUrl}`);

      // Add more detailed logging for debugging
      const originalConsoleLog = console.log;
      const _logs: string[] = [];
      console.log = (...args) => {
        const message = args
          .map((arg) =>
            typeof arg === 'object' ? JSON.stringify(arg) : String(arg),
          )
          .join(' ');
        if (
          message.includes('HEAD') ||
          message.includes('verification') ||
          message.includes('speedwagon')
        ) {
          logger.info(`[VERIFY-CORE] ${message}`);
        }
        originalConsoleLog.apply(console, args);
      };

      const response = await wayfinder.request(arUrl);

      // Restore console.log
      console.log = originalConsoleLog;

      // Check if response is ok
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // Get actual content size by reading the body
      const blob = await response.blob();
      const contentLength = blob.size;
      const contentType =
        blob.type || response.headers.get('content-type') || 'text/html';

      // Use the gateway URL captured from routing event
      const gatewayUrl = routedGatewayUrl;
      logger.info(
        `[VERIFY] Using gateway URL from routing event: ${gatewayUrl}`,
      );

      logger.info(
        `[VERIFY] Content received: ${contentLength} bytes (${(
          contentLength / 1024 / 1024
        ).toFixed(2)} MB), type: ${contentType}`,
      );

      // Check response headers for verification status
      const verifiedHeader = response.headers.get('x-wayfinder-verified');
      const verificationMethod = response.headers.get(
        'x-wayfinder-verification-method',
      );

      logger.info(
        `[VERIFY] Response headers - verified: ${verifiedHeader}, method: ${verificationMethod}`,
      );

      // Check if verification is enabled
      const { verifiedBrowsing = false } = await chrome.storage.local.get([
        'verifiedBrowsing',
      ]);

      // Wait for verification to complete if enabled
      let finalVerificationStatus = false;
      if (verifiedBrowsing) {
        logger.info('[VERIFY] Waiting for verification to complete...');
        const verificationResult = await verificationPromise;
        const sizeMB = (contentLength / 1024 / 1024).toFixed(2);
        logger.info(
          `[VERIFY] Verification ${
            verificationResult ? 'SUCCEEDED' : 'FAILED'
          } for ${arUrl}:`,
          {
            verified: verificationResult,
            contentType,
            size: `${contentLength} bytes (${sizeMB} MB)`,
            source: verificationError ? 'failed' : 'cryptographic',
          },
        );
        // Use the actual verification result from the promise
        finalVerificationStatus =
          verificationResult || verifiedHeader === 'true';
      } else {
        // If verification is disabled, treat content as "unverified but allowed"
        finalVerificationStatus = false;
      }

      // Update verification cache
      const { verificationCache } = await import('./utils/verification-cache');
      await verificationCache.set(arUrl, {
        verified: finalVerificationStatus,
        status: 'completed',
        strategy: verifiedBrowsing ? 'wayfinder-request' : 'none',
        timestamp: Date.now(),
        error:
          verificationError?.message ||
          (!verifiedBrowsing ? 'Verification disabled' : undefined),
      });

      // Update stats
      updateDailyStats(finalVerificationStatus ? 'verified' : 'failed');

      // For HTML content, always use cache to avoid CSP restrictions
      if (contentType.includes('text/html')) {
        // Always cache HTML to allow scripts to run
        const cache = await caches.open('wayfinder-verified');
        const cacheKey = `https://wayfinder-cache.local/verified/${Date.now()}/${arUrl.replace(
          'ar://',
          '',
        )}`;

        // Rewrite URLs first
        const htmlContent = await blob.text();
        const rewrittenHtml = await rewriteHtmlUrls(htmlContent, arUrl);

        // Create new response with rewritten HTML
        const rewrittenBlob = new Blob([rewrittenHtml], { type: contentType });
        const newResponse = new Response(rewrittenBlob, {
          headers: {
            'content-type': contentType,
          },
        });
        await cache.put(cacheKey, newResponse);

        logger.info(
          `[VERIFY] Cached HTML content for ${arUrl} with key ${cacheKey} (CSP-safe)`,
        );

        // Schedule cache cleanup after 1 hour
        setTimeout(
          async () => {
            try {
              await cache.delete(cacheKey);
              logger.info(`[VERIFY] Cleaned up cached content for ${cacheKey}`);
            } catch (error) {
              logger.error(
                `[VERIFY] Failed to cleanup cache for ${cacheKey}:`,
                error,
              );
            }
          },
          60 * 60 * 1000,
        ); // 1 hour

        return {
          verified: finalVerificationStatus,
          cacheKey,
          gatewayUrl,
          verificationInfo: {
            size: contentLength,
            type: contentType,
            error: verificationError?.message,
          },
        };
      } else if (contentLength < 2_000_000) {
        // Non-HTML small content can still use data URLs
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            if (typeof reader.result === 'string') {
              resolve(reader.result);
            } else {
              reject(new Error('Failed to read blob as data URL'));
            }
          };
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });

        logger.info(`[VERIFY] Converted to data URL for ${arUrl}`);

        return {
          verified: finalVerificationStatus,
          dataUrl,
          gatewayUrl,
          verificationInfo: {
            size: contentLength,
            type: contentType,
            error: verificationError?.message,
          },
        };
      } else {
        // Large content - cache it
        const cache = await caches.open('wayfinder-verified');
        // Create a valid HTTP URL for the cache key
        const cacheKey = `https://wayfinder-cache.local/verified/${Date.now()}/${arUrl.replace(
          'ar://',
          '',
        )}`;

        // Create new response from blob since we already consumed the original
        const newResponse = new Response(blob, {
          headers: {
            'content-type': contentType,
          },
        });
        await cache.put(cacheKey, newResponse);

        logger.info(
          `[VERIFY] Cached large content for ${arUrl} with key ${cacheKey}`,
        );

        // Schedule cache cleanup after 1 hour
        setTimeout(
          async () => {
            try {
              await cache.delete(cacheKey);
              logger.info(`[VERIFY] Cleaned up cached content for ${cacheKey}`);
            } catch (error) {
              logger.error(
                `[VERIFY] Failed to cleanup cache for ${cacheKey}:`,
                error,
              );
            }
          },
          60 * 60 * 1000,
        ); // 1 hour

        return {
          verified: finalVerificationStatus,
          cacheKey,
          gatewayUrl,
          verificationInfo: {
            size: contentLength,
            type: contentType,
            error: verificationError?.message,
          },
        };
      }
    } finally {
      // No need to clean up - we used 'once' listeners
    }
  } catch (error) {
    logger.error(
      `[VERIFY] Failed to fetch verified content for ${arUrl}:`,
      error,
    );
    throw error;
  }
}

/**
 * Extract transaction ID from ar:// URL
 */
// Note: Transaction ID extraction is no longer needed
// wayfinder-core handles ar:// URLs directly including ArNS names

// ArNS change detection functions moved to verification-cache.ts
/**
 * Handle resource requests from viewer iframe
 */
async function handleViewerResourceRequest(
  details: chrome.webRequest.WebResponseHeadersDetails,
): Promise<void> {
  try {
    const url = new URL(details.url);

    // Check if this is a gateway request
    const isGateway = await isKnownGateway(url.hostname);
    if (!isGateway) return;

    // Determine resource type
    const resourceType = getResourceType(details);

    // Check if resource was verified (look for x-wayfinder-verified header)
    const headers = details.responseHeaders || [];
    const verifiedHeader = headers.find(
      (h) => h.name.toLowerCase() === 'x-wayfinder-verified',
    );
    const verified = verifiedHeader?.value === 'true';

    logger.info(
      `[VIEWER-RESOURCE] ${resourceType} from ${url.hostname}: ${
        verified ? 'verified' : 'not verified'
      }`,
    );

    // Send update to viewer - need to send to all extension pages since we can't target iframe
    chrome.runtime.sendMessage({
      type: 'RESOURCE_VERIFICATION_UPDATE',
      resourceType,
      verified,
      url: details.url,
    });
  } catch (error) {
    logger.error('[VIEWER-RESOURCE] Error handling resource request:', error);
  }
}

/**
 * Determine resource type from request details
 */
function getResourceType(
  details: chrome.webRequest.WebResponseHeadersDetails,
): string {
  const contentType =
    details.responseHeaders?.find(
      (h) => h.name.toLowerCase() === 'content-type',
    )?.value || '';

  if (contentType.includes('javascript') || details.url.endsWith('.js')) {
    return 'scripts';
  } else if (contentType.includes('css') || details.url.endsWith('.css')) {
    return 'styles';
  } else if (
    contentType.startsWith('image/') ||
    /\.(jpg|jpeg|png|gif|svg|webp)$/i.test(details.url)
  ) {
    return 'media';
  } else if (contentType.includes('json') || details.url.includes('/api/')) {
    return 'api';
  }

  return 'other';
}

/**
 * Handle fetching and verifying a resource for the proxy
 */
async function handleVerifiedResourceFetch(arUrl: string): Promise<{
  dataUrl?: string;
  content?: string;
  contentType?: string;
  error?: string;
  verified?: boolean;
}> {
  try {
    logger.info(`[PROXY] Fetching verified resource: ${arUrl}`);

    const wayfinder = await getWayfinderInstance();

    // Track verification events
    let verificationSucceeded = false;

    const handleVerificationSuccess = (event: any) => {
      logger.info(`[PROXY] Resource verification succeeded for ${event.txId}`);
      verificationSucceeded = true;
    };

    const handleVerificationFailed = (event: any) => {
      logger.error(`[PROXY] Resource verification failed:`, event);
      // Error details logged above
    };

    wayfinder.emitter.once('verification-succeeded', handleVerificationSuccess);
    wayfinder.emitter.once('verification-failed', handleVerificationFailed);

    try {
      // Fetch the resource using Wayfinder
      const response = await wayfinder.request(arUrl);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // Get content as blob
      const blob = await response.blob();
      const contentType =
        blob.type ||
        response.headers.get('content-type') ||
        'application/octet-stream';

      // Convert to data URL for transfer
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          if (typeof reader.result === 'string') {
            resolve(reader.result);
          } else {
            reject(new Error('Failed to read blob as data URL'));
          }
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });

      // Update stats for resource verification
      updateDailyStats(verificationSucceeded ? 'verified' : 'failed');

      // Send verification update to viewer
      chrome.runtime.sendMessage({
        type: 'RESOURCE_VERIFICATION_UPDATE',
        resourceType: getResourceTypeFromUrl(arUrl),
        verified: verificationSucceeded,
        url: arUrl,
      });

      logger.info(
        `[PROXY] Successfully fetched and ${
          verificationSucceeded ? 'verified' : 'failed to verify'
        } resource: ${arUrl}`,
      );

      return {
        dataUrl,
        contentType,
        verified: verificationSucceeded,
      };
    } finally {
      // Clean up event listeners
      wayfinder.emitter.off(
        'verification-succeeded',
        handleVerificationSuccess,
      );
      wayfinder.emitter.off('verification-failed', handleVerificationFailed);
    }
  } catch (error: any) {
    logger.error(`[PROXY] Error fetching resource ${arUrl}:`, error);

    // Update failed stats
    updateDailyStats('failed');

    // Send verification update
    chrome.runtime.sendMessage({
      type: 'RESOURCE_VERIFICATION_UPDATE',
      resourceType: getResourceTypeFromUrl(arUrl),
      verified: false,
      url: arUrl,
    });

    return {
      error: error?.message || 'Failed to fetch resource',
      verified: false,
    };
  }
}

/**
 * Get resource type from URL
 */
function getResourceTypeFromUrl(url: string): string {
  const urlLower = url.toLowerCase();

  if (urlLower.endsWith('.js') || urlLower.endsWith('.mjs')) {
    return 'scripts';
  } else if (urlLower.endsWith('.css')) {
    return 'styles';
  } else if (/\.(jpg|jpeg|png|gif|svg|webp|ico)$/i.test(url)) {
    return 'media';
  } else if (urlLower.includes('/api/') || urlLower.endsWith('.json')) {
    return 'api';
  }

  return 'other';
}

/**
 * Rewrite HTML URLs to proxy through our extension
 */
async function rewriteHtmlUrls(
  html: string,
  baseArUrl: string,
): Promise<string> {
  logger.info(`[REWRITE] Rewriting URLs in HTML for ${baseArUrl}`);

  // Parse the base URL to understand the context
  const baseParts = baseArUrl.match(/^ar:\/\/([^\/]+)(\/.*)?$/);
  if (!baseParts) return html;

  const baseId = baseParts[1];
  const basePath = baseParts[2] || '';

  // Get extension ID for building proxy URLs
  const extensionId = chrome.runtime.id;

  // Function to determine if URL should be rewritten
  const shouldRewriteUrl = (url: string): boolean => {
    // Skip data: URLs, blob: URLs, and external URLs
    if (
      url.startsWith('data:') ||
      url.startsWith('blob:') ||
      url.startsWith('http://') ||
      url.startsWith('https://')
    ) {
      // Check if it's a gateway URL
      const gatewayPatterns = [
        /^https?:\/\/[^\/]*arweave\.[^\/]+\//,
        /^https?:\/\/[^\/]*ar\.io[^\/]*\//,
        /^https?:\/\/[^\/]*ar-io[^\/]*\//,
        /^https?:\/\/[^\/]*g8way[^\/]*\//,
      ];
      return gatewayPatterns.some((pattern) => pattern.test(url));
    }
    // Rewrite relative URLs and ar:// URLs
    return true;
  };

  // Function to convert URL to ar:// format
  const toArUrl = (url: string): string => {
    // Already ar:// URL
    if (url.startsWith('ar://')) return url;

    // Absolute gateway URL
    if (url.startsWith('http://') || url.startsWith('https://')) {
      const match = url.match(/^https?:\/\/[^\/]+\/([a-zA-Z0-9_-]{43})(.*)$/);
      if (match) {
        return `ar://${match[1]}${match[2]}`;
      }
      return url; // Can't convert, return as-is
    }

    // Relative URL - resolve against base
    if (url.startsWith('/')) {
      // Root-relative URL
      if (url.match(/^\/[a-zA-Z0-9_-]{43}/)) {
        // TX ID at root
        return `ar:/${url}`;
      } else {
        // Path under current base
        return `ar://${baseId}${url}`;
      }
    } else {
      // Document-relative URL
      const baseDir = basePath.substring(0, basePath.lastIndexOf('/') + 1);
      return `ar://${baseId}${baseDir}${url}`;
    }
  };

  // Create proxy URL
  const createProxyUrl = (
    originalUrl: string,
    _isResource: boolean = false,
  ): string => {
    if (!shouldRewriteUrl(originalUrl)) {
      return originalUrl;
    }

    const arUrl = toArUrl(originalUrl);
    if (arUrl.startsWith('ar://')) {
      // Always use proxy for verification, but we'll handle resources specially
      return `chrome-extension://${extensionId}/wayfinder-proxy.html?url=${encodeURIComponent(
        arUrl,
      )}`;
    }

    return originalUrl;
  };

  // Rewrite various URL patterns in HTML
  let rewrittenHtml = html;

  // Rewrite src attributes
  rewrittenHtml = rewrittenHtml.replace(
    /(<(?:img|script|iframe|embed|source|audio|video)[^>]+\s+src\s*=\s*)["']([^"']+)["']/gi,
    (_match, prefix, url) => `${prefix}"${createProxyUrl(url)}"`,
  );

  // Rewrite href attributes for stylesheets
  rewrittenHtml = rewrittenHtml.replace(
    /(<link[^>]+\s+href\s*=\s*)["']([^"']+)["']/gi,
    (match, prefix, url, offset, string) => {
      // Only rewrite stylesheet links
      if (
        string
          .substring(Math.max(0, offset - 100), offset + match.length + 100)
          .includes('stylesheet')
      ) {
        return `${prefix}"${createProxyUrl(url)}"`;
      }
      return match;
    },
  );

  // Rewrite url() in inline styles
  rewrittenHtml = rewrittenHtml.replace(
    /url\s*\(\s*["']?([^"')]+)["']?\s*\)/gi,
    (_match, url) => `url("${createProxyUrl(url)}")`,
  );

  // Rewrite srcset attributes
  rewrittenHtml = rewrittenHtml.replace(
    /(<img[^>]+\s+srcset\s*=\s*)["']([^"']+)["']/gi,
    (_match, prefix, srcset) => {
      const rewrittenSrcset = srcset
        .split(',')
        .map((src) => {
          const [url, descriptor] = src.trim().split(/\s+/);
          return `${createProxyUrl(url)}${descriptor ? ' ' + descriptor : ''}`;
        })
        .join(', ');
      return `${prefix}"${rewrittenSrcset}"`;
    },
  );

  logger.info(`[REWRITE] Completed URL rewriting for ${baseArUrl}`);
  return rewrittenHtml;
}

// REMOVED: Old verifyInBackground function - use verifyInBackgroundWithCache instead
// REMOVED: updateArNSCache and showVerificationToast functions (moved to background-verification-cached.ts)

// Set up periodic cache cleanup
setupCacheCleanup();

// Start initialization after storage is ready
chrome.storage.local
  .get(['processId', 'aoCuUrl'])
  .then(({ processId, aoCuUrl }) => {
    // Wait a bit to ensure storage initialization is complete
    setTimeout(() => {
      if (!processId || !aoCuUrl) {
        logger.warn(
          'Process ID or AO CU URL not yet initialized, delaying gateway sync...',
        );
        // Try again after storage should be initialized
        setTimeout(() => {
          initializeWayfinder().catch((err) =>
            logger.error('Error during Wayfinder initialization:', err),
          );
        }, 2000);
      } else {
        initializeWayfinder().catch((err) =>
          logger.error('Error during Wayfinder initialization:', err),
        );
      }
    }, 1000);
  });
