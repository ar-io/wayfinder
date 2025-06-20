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

/**
 * Check if a URL is bypassed for verification
 */
async function checkBypass(url: string): Promise<boolean> {
  // Check permanent bypasses
  const { [BYPASS_STORAGE_KEY]: bypasses = {} } = await chrome.storage.local.get(BYPASS_STORAGE_KEY);
  if (bypasses[url]) {
    logger.info(`[BYPASS] URL has permanent bypass: ${url}`);
    return true;
  }
  
  // Check session bypasses
  try {
    const { [BYPASS_SESSION_KEY]: sessionBypasses = {} } = await chrome.storage.session.get(BYPASS_SESSION_KEY);
    if (sessionBypasses[url]) {
      logger.info(`[BYPASS] URL has session bypass: ${url}`);
      return true;
    }
  } catch (e) {
    // Session storage might not be available in some contexts
    logger.debug('[BYPASS] Session storage not available');
  }
  
  return false;
}

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

/**
 * Capture verification status from gateway response headers
 * Note: Cannot use blocking mode without enterprise deployment
 */
chrome.webRequest.onHeadersReceived.addListener(
  async (details) => {
    const tabInfo = tabStateManager.get(details.tabId);

    if (tabInfo) {
      let verificationStatus = {
        verified: false,
        strategy: null as string | null,
        error: null as string | null,
        arnsResolvedId: null as string | null,
        dataId: null as string | null,
      };

      // Parse verification headers from the gateway response
      for (const header of details.responseHeaders || []) {
        const headerName = header.name.toLowerCase();
        const headerValue = header.value || '';

        switch (headerName) {
          case 'x-ar-io-verified':
            verificationStatus.verified = headerValue.toLowerCase() === 'true';
            break;
          case 'x-ar-io-verification-strategy':
            verificationStatus.strategy = headerValue;
            break;
          case 'x-ar-io-verification-error':
            verificationStatus.error = headerValue;
            break;
          case 'x-arns-resolved-id':
            verificationStatus.arnsResolvedId = headerValue;
            logger.debug(`ArNS resolved: ${details.url} -> ${headerValue}`);
            break;
          case 'x-ar-io-data-id':
            verificationStatus.dataId = headerValue;
            break;
        }
      }

      // Cache the verification result
      if (tabInfo.arUrl) {
        const { verificationCache } = await import('./utils/verification-cache');
        await verificationCache.set(tabInfo.arUrl, {
          verified: verificationStatus.verified,
          strategy: verificationStatus.strategy || 'unknown',
          error: verificationStatus.error,
          timestamp: Date.now(),
        });
        
        // Update daily stats
        updateDailyStats(verificationStatus.verified ? 'verified' : 'failed');
        
        logger.info(
          `[VERIFY] Captured verification status for ${tabInfo.arUrl}: ${verificationStatus.verified ? 'PASSED' : 'FAILED'}`,
        );
      }

      // Handle strict mode - we can't block, but we can redirect after load
      const { verificationStrict = false } = await chrome.storage.local.get([
        'verificationStrict',
      ]);

      if (verificationStrict && !verificationStatus.verified && tabInfo.arUrl) {
        // Check if this URL is bypassed
        const isBypassed = await checkBypass(tabInfo.arUrl);
        
        if (!isBypassed) {
          // In strict mode, redirect to warning page after content starts loading
          logger.warn('[VERIFY] Unverified content in strict mode - redirecting to warning');
          
          // Clean up first
          tabStateManager.delete(details.tabId);
          
          // Redirect to warning page (use extension URL, not data URL)
          const warningUrl = chrome.runtime.getURL('warning.html') + 
            '?url=' + encodeURIComponent(tabInfo.arUrl) +
            '&strategy=' + encodeURIComponent(verificationStatus.strategy || 'unknown') +
            '&error=' + encodeURIComponent(verificationStatus.error || 'Verification failed') +
            '&gateway=' + encodeURIComponent(new URL(details.url).hostname) +
            '&txId=' + encodeURIComponent(verificationStatus.dataId || '');
          
          // Redirect the tab to warning page
          chrome.tabs.update(details.tabId, { url: warningUrl });
          
          // Return early to prevent further processing
          return;
        }
      }

      // Clean up
      tabStateManager.delete(details.tabId);
    }
  },
  { urls: ['<all_urls>'] },
  ['responseHeaders'], // Removed 'blocking' - not available for regular extensions
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
  ];
  const validTypes = [
    'convertArUrlToHttpUrl',
    'openSettings',
    'checkVerificationCache',
    'proceedWithBypass',
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
        const { verificationCache } = await import('./utils/verification-cache');
        const cached = await verificationCache.get(request.url);
        
        if (cached) {
          sendResponse({ 
            cached: true, 
            result: {
              verified: cached.verified,
              strategy: cached.strategy,
              error: cached.error,
            }
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
          const { [BYPASS_STORAGE_KEY]: bypasses = {} } = await chrome.storage.local.get(BYPASS_STORAGE_KEY);
          bypasses[url] = {
            timestamp: Date.now(),
            permanent: true
          };
          await chrome.storage.local.set({ [BYPASS_STORAGE_KEY]: bypasses });
        } else {
          const { [BYPASS_SESSION_KEY]: sessionBypasses = {} } = await chrome.storage.session.get(BYPASS_SESSION_KEY);
          sessionBypasses[url] = {
            timestamp: Date.now(),
            permanent: false
          };
          await chrome.storage.session.set({ [BYPASS_SESSION_KEY]: sessionBypasses });
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
    await updateSyncStatus('error', error instanceof Error ? error.message : 'Unknown error');
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
 * Extract transaction ID from ar:// URL
 */
// Note: Transaction ID extraction is no longer needed
// wayfinder-core handles ar:// URLs directly including ArNS names

// ArNS change detection functions moved to verification-cache.ts
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
