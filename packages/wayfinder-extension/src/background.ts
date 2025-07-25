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
import { LRUCache } from 'lru-cache';
import pDebounce from 'p-debounce';
import { ChromeStorageGatewayProvider } from './adapters/chrome-storage-gateway-provider';
import { EXTENSION_DEFAULTS } from './config/defaults';
import { ARIO_MAINNET_PROCESS_ID, DEFAULT_AO_CU_URL } from './constants';
import { getCachedGatewayRegistry } from './helpers';
import {
  getRoutableGatewayUrl,
  getWayfinderInstance,
  resetWayfinderInstance,
} from './routing';
import { RedirectedTabInfo, VerificationCacheEntry } from './types';
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
        // Cleaned up stale tab state
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
const requestTimings = new LRUCache<string, number>({
  max: 10_000,
  ttl: 60 * 60 * 1000 * 24, // 1 day in milliseconds
});
const verificationCache = new LRUCache<string, VerificationCacheEntry>({
  max: 10_000,
  ttl: 60 * 60 * 1000 * 24, // 1 day in milliseconds
});

// manage webRequest listeners
const webRequestListeners: {
  onCompleted?: any;
  onHeadersReceived?: any;
  onErrorOccurred?: any;
  onBeforeRequest?: any;
} = {};

/**
 * Get URL patterns for known gateways from cache
 */
async function getGatewayUrlPatterns(): Promise<string[]> {
  try {
    const registry = await getCachedGatewayRegistry();
    if (!registry) return ['*://arweave.net/*']; // fallback

    const patterns = Object.values(registry).flatMap((gw: any) => {
      const fqdn = gw.settings?.fqdn;
      if (!fqdn) return [];
      return [`*://${fqdn}/*`, `*://*.${fqdn}/*`];
    });

    return patterns.length > 0 ? patterns : ['*://arweave.net/*'];
  } catch {
    return ['*://arweave.net/*'];
  }
}

/**
 * Update webRequest listeners with current gateway URLs
 */
async function updateWebRequestListeners() {
  const newPatterns = await getGatewayUrlPatterns();

  // Remove old listeners
  if (webRequestListeners.onCompleted) {
    chrome.webRequest.onCompleted.removeListener(
      webRequestListeners.onCompleted,
    );
  }
  if (webRequestListeners.onHeadersReceived) {
    chrome.webRequest.onHeadersReceived.removeListener(
      webRequestListeners.onHeadersReceived,
    );
  }
  if (webRequestListeners.onErrorOccurred) {
    chrome.webRequest.onErrorOccurred.removeListener(
      webRequestListeners.onErrorOccurred,
    );
  }
  if (webRequestListeners.onBeforeRequest) {
    chrome.webRequest.onBeforeRequest.removeListener(
      webRequestListeners.onBeforeRequest,
    );
  }

  // Add new listeners with updated patterns
  setupWebRequestListeners({ urls: newPatterns });
}

// Helper function to generate cache key
function getVerificationCacheKey(
  hostname: string,
  resolvedId?: string,
): string {
  return `${hostname}:${resolvedId || 'direct'}`;
}

// Helper function to check if we should show verification toast
async function shouldShowVerificationToast(
  hostname: string,
  resolvedId: string | undefined,
  verified: boolean,
  gatewayFQDN: string,
): Promise<boolean> {
  // Check if user has disabled verification toasts
  const { showVerificationToasts = true } = await chrome.storage.local.get([
    'showVerificationToasts',
  ]);

  if (!showVerificationToasts) {
    return false;
  }

  const cacheKey = getVerificationCacheKey(hostname, resolvedId);
  const cachedEntry = verificationCache.get(cacheKey);

  // If no cache entry, always show
  if (!cachedEntry) {
    // Add to cache
    verificationCache.set(cacheKey, {
      verified,
      timestamp: Date.now(),
      gatewayFQDN,
    });

    return true;
  }

  // Check if verification status changed
  if (cachedEntry.verified !== verified) {
    // Update cache
    cachedEntry.verified = verified;
    cachedEntry.timestamp = Date.now();
    cachedEntry.gatewayFQDN = gatewayFQDN;
    return true;
  }

  // Same verification status - don't show
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
  // Daily stats updated
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
    showVerificationToasts,
  } = await chrome.storage.local.get([
    'routingMethod',
    'blacklistedGateways',
    'ensResolutionEnabled',
    'showVerificationToasts',
  ]);

  if (routingMethod === undefined)
    updates.routingMethod = EXTENSION_DEFAULTS.routingMethod;
  if (blacklistedGateways === undefined)
    updates.blacklistedGateways = EXTENSION_DEFAULTS.blacklistedGateways;
  if (ensResolutionEnabled === undefined)
    updates.ensResolutionEnabled = EXTENSION_DEFAULTS.ensResolutionEnabled;
  if (showVerificationToasts === undefined)
    updates.showVerificationToasts = EXTENSION_DEFAULTS.showVerificationToasts;
  // Removed verificationStrict - no longer used

  await chrome.storage.local.set(updates);
  // Storage initialized
})();

// Initialize performance data structure if needed
chrome.storage.local
  .get(['gatewayPerformance'])
  .then(({ gatewayPerformance }) => {
    if (!gatewayPerformance) {
      chrome.storage.local.set({ gatewayPerformance: {} });
      // Initialized empty gateway performance storage
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
  // Initializing Wayfinder

  try {
    // Sync gateway registry first
    await syncGatewayAddressRegistry();

    // Check if we have gateways
    const { localGatewayAddressRegistry = {} } = await chrome.storage.local.get(
      ['localGatewayAddressRegistry'],
    );
    const gatewayCount = Object.keys(localGatewayAddressRegistry).length;

    if (gatewayCount === 0) {
      logger.warn(
        'No gateways found after sync. Users will need to manually sync or fallback gateways will be used.',
      );
    } else {
      logger.info(`[SYNC] ${gatewayCount} gateways loaded`);
    }

    await getWayfinderInstance();
  } catch (error) {
    logger.error('Error during Wayfinder initialization:', error);
    logger.warn(
      'Users can manually sync gateways in Settings > Network Configuration',
    );
  }
}

// before navigate
chrome.webNavigation.onBeforeNavigate.addListener(handleBeforeNavigate, {
  url: [{ schemes: ['http', 'https'] }],
});
/**
 * Handles browser navigation for `ar://` links using Wayfinder core library
 * FIXED: Back to direct gateway routing with verification tracking
 */
async function handleBeforeNavigate(details: any) {
  let arUrl: string | null = null;
  try {
    // Only process main frame to avoid iframe noise
    if (details.frameId !== 0) return;

    const url = new URL(details.url);

    // Original ar:// URL handling
    arUrl = url.searchParams.get('q');

    if (!arUrl || !arUrl.startsWith('ar://')) return;

    // Validate ar:// URL format
    if (arUrl.length < 6) {
      logger.error(`Invalid ar:// URL format: ${arUrl}`);
      return;
    }

    // Process immediately without setTimeout to prevent race conditions
    const startTime = performance.now();

    // Get the routable gateway URL using Wayfinder
    const result = await getRoutableGatewayUrl(arUrl);

    // Track redirect BEFORE navigation to prevent timing issues
    tabStateManager.set(details.tabId, {
      originalGateway: result.gatewayFQDN || 'unknown',
      expectedSandboxRedirect: /^[a-z0-9_-]{43}$/i.test(arUrl.slice(5)),
      startTime,
      arUrl,
    });

    // Navigate to the gateway URL directly
    chrome.tabs.update(details.tabId, { url: result.url });

    // Track the request
    updateDailyStats('request');
  } catch (error) {
    logger.error('Error processing ar:// navigation:', error);
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
              <h1>Error Failed to Route AR.IO URL</h1>
              <div class="error-message">${errorMessage}</div>
              <div class="actions">
                <button onclick="history.back()">Go Back</button>
              </div>
            </div>
          </body>
          </html>`,
    });
  }
}

/**
 * Clean up tab state when tabs are closed
 */
async function handleTabRemoved(tabId: number) {
  tabStateManager.delete(tabId);

  // Also clean up verification cache entries for this tab
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab?.url) {
      const url = new URL(tab.url);
      const hostname = url.hostname;

      // Remove all cache entries for this hostname
      for (const key of verificationCache.keys()) {
        if (key.startsWith(`${hostname}:`)) {
          verificationCache.delete(key);
        }
      }
    }
  } catch {
    // Tab already closed, ignore
  }
}

// Setup tab removed listener
chrome.tabs.onRemoved.addListener(handleTabRemoved);

/**
 * Setup webRequest listeners with dynamic URL patterns
 */
function setupWebRequestListeners({
  urls,
}: {
  urls: string[];
}) {
  // Store references for cleanup
  webRequestListeners.onHeadersReceived = handleHeadersReceived;

  chrome.webRequest.onHeadersReceived.addListener(
    webRequestListeners.onHeadersReceived,
    { urls },
    ['responseHeaders'],
  );

  // Store references for cleanup
  webRequestListeners.onErrorOccurred = handleRequestError;

  chrome.webRequest.onErrorOccurred.addListener(
    webRequestListeners.onErrorOccurred,
    { urls },
  );

  // before request
  webRequestListeners.onBeforeRequest = handleBeforeRequest;

  chrome.webRequest.onBeforeRequest.addListener(
    webRequestListeners.onBeforeRequest,
    { urls },
  );

  // completed
  webRequestListeners.onCompleted = handleRequestCompleted;

  chrome.webRequest.onCompleted.addListener(webRequestListeners.onCompleted, {
    urls,
  });
}

/**
 * Handle successful requests - update performance metrics and verify data
 */
async function handleRequestCompleted(details: any) {
  const fullGatewayFqdn = new URL(details.url).hostname;

  let responseTime: number | undefined;

  // only track requests from ar:// redirections (not other requests)
  const tabInfo = tabStateManager.get(details.tabId);
  if (tabInfo) {
    responseTime = performance.now() - tabInfo.startTime;
    tabStateManager.delete(details.tabId);
  }

  const requestId = details.requestId.toString();
  const startTime = requestTimings.get(requestId);
  if (startTime) {
    // update performance metrics
    responseTime = performance.now() - startTime;
    requestTimings.delete(requestId);
  }

  if (!responseTime) {
    return;
  }

  // get the local gateway registry to increment the stats of the gateway that served the request
  const gatewayRegistry = await getCachedGatewayRegistry();

  const matchingGateway: any = Object.values(gatewayRegistry).find(
    (gateway: any) => {
      if (!gateway.settings?.fqdn) {
        return false;
      }
      return fullGatewayFqdn.includes(gateway.settings.fqdn);
    },
  );

  if (!matchingGateway) {
    return;
  }

  // get the recorded gateway url based on the urls filter of the listener
  const gatewayBaseFqdn = matchingGateway.settings.fqdn;

  if (!gatewayBaseFqdn) {
    return;
  }

  // Update performance metrics via gateway provider
  await gatewayProvider.updateGatewayPerformance(
    gatewayBaseFqdn,
    responseTime,
    true,
  );
}

/**
 * Handle verification headers - only for known gateways
 */
function handleHeadersReceived(details: any) {
  // Check for verification header on gateway requests - handle async without blocking
  (async () => {
    try {
      const url = new URL(details.url);
      const hostname = url.hostname;

      // Since we're already filtering by gateway URLs, skip the isKnownGateway check
      if (details.tabId !== -1) {
        // Parse headers for verification
        let verified = false;
        let arnsResolvedId: string | null = null;
        let dataId: string | null = null;

        for (const header of details.responseHeaders || []) {
          const headerName = header.name.toLowerCase();
          const headerValue = header.value || '';

          switch (headerName) {
            case 'x-ar-io-verified':
              verified = headerValue.toLowerCase() === 'true';
              break;
            case 'x-arns-resolved-id':
              arnsResolvedId = headerValue;
              break;
            case 'x-ar-io-data-id':
              dataId = headerValue;
              break;
          }
        }

        // Use resolved ID if available, otherwise data ID
        const resolvedId = arnsResolvedId || dataId || undefined;

        // Only show toast if content is verified
        if (verified) {
          // Check if we should show verification toast
          const shouldShow = await shouldShowVerificationToast(
            hostname,
            resolvedId,
            verified,
            hostname,
          );

          if (shouldShow) {
            // Send message to content script
            try {
              await chrome.tabs.sendMessage(details.tabId, {
                type: 'showVerificationToast',
                verified,
                gatewayFQDN: hostname,
                resolvedId,
              });
            } catch (error) {
              // Content script might not be injected yet or tab might be closing
              logger.debug('Could not send verification toast message:', error);
            }
          }
        }
      }
    } catch (error) {
      logger.error('Error checking verification header:', error);
    }
  })(); // Execute the async IIFE
}

/**
 * Handle failed requests
 */
async function handleRequestError(details: any) {
  const gatewayFQDN = new URL(details.url).hostname;

  // Only track failures from ar:// redirections
  const tabInfo = tabStateManager.get(details.tabId);
  if (tabInfo) {
    await gatewayProvider.updateGatewayPerformance(
      gatewayFQDN,
      Infinity,
      false,
    );

    logger.warn(`Request failed to ${gatewayFQDN}: ${details.error}`);

    tabStateManager.delete(details.tabId);
  }

  // mark the request as failed
  const requestId = details.requestId.toString();
  const startTime = requestTimings.get(requestId);
  if (startTime) {
    const storage = await chrome.storage.local.get(['gatewayPerformance']);
    const gatewayPerformance = storage.gatewayPerformance || {};
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

    // Clean up
    requestTimings.delete(requestId);
  }
}
/**
 * Track web requests to known gateways for performance monitoring
 */
function handleBeforeRequest(details: any) {
  // Since we're already filtering by gateway URLs, all requests are to known gateways
  requestTimings.set(details.requestId.toString(), performance.now());
}

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
  ];
  const validTypes = ['convertArUrlToHttpUrl', 'openSettings'];

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

        // Confirm the setting was saved
        const { routingMethod } =
          await chrome.storage.local.get('routingMethod');
        logger.info(
          `[SETTINGS] Wayfinder will reinitialize with routing: ${routingMethod}`,
        );

        sendResponse({ success: true });
      } catch (error: any) {
        logger.error('Error updating routing strategy:', error);
        sendResponse({ error: error?.message || 'Unknown error' });
      }
    })();
    return true; // Keep message channel open for async response
  }

  // Handle advanced settings updates
  if (request.message === 'updateAdvancedSettings') {
    (async () => {
      try {
        await chrome.storage.local.set(request.settings);
        // Reset Wayfinder instance to use new settings
        resetWayfinderInstance();

        // Log what changed
        const changedSettings = Object.keys(request.settings).join(', ');
        logger.info(
          `[SETTINGS] Wayfinder will reinitialize with updated: ${changedSettings}`,
        );

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

  // Removed: getCacheStats handler - verification cache removed
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

    // Syncing Gateway Address Registry
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

      logger.info(`[SYNC] ${totalFetched} gateways synced`);
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

    // AR.IO reinitialized
  } catch (error) {
    logger.error('Failed to reinitialize AR.IO, using default:', error);
    arIO = ARIO.init();
  }
}

// Initialize webRequest listeners with fallback patterns
updateWebRequestListeners()
  .then(() => {
    logger.info('WebRequest listeners updated');
  })
  .catch((error) => {
    logger.error('Error updating WebRequest listeners:', error);
  });

// Update listeners when gateway registry changes
chrome.storage.onChanged.addListener(async (changes, namespace) => {
  if (namespace === 'local' && changes.localGatewayAddressRegistry) {
    await updateWebRequestListeners();
  }
});

// on chrome storage ready, initialize wayfinder with debounce
const debouncedInitializeWayfinder = pDebounce(initializeWayfinder, 1000, {
  before: true,
});
chrome.storage.local
  .get(['processId', 'aoCuUrl'])
  .then(async () => {
    debouncedInitializeWayfinder();
  })
  .catch((error) => {
    logger.error('Error initializing Wayfinder:', error);
  });
