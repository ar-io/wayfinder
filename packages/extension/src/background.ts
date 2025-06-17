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
import {
  ARIO_MAINNET_PROCESS_ID,
  DEFAULT_AO_CU_URL,
} from './constants';
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
import { verificationCache, detectArNSChanges, notifyArNSChange } from './utils/verification-cache';

// Enhanced tab state management
class TabStateManager {
  private states = new Map<number, RedirectedTabInfo & { timestamp: number }>();
  private cleanupInterval: number;

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

logger.info('Initializing Wayfinder Extension with Core Library');

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
  if (!processId) updates.processId = ARIO_MAINNET_PROCESS_ID;
  if (!aoCuUrl) updates.aoCuUrl = DEFAULT_AO_CU_URL;
  if (!localGatewayAddressRegistry) updates.localGatewayAddressRegistry = {};

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
    updates.routingMethod = 'fastestPing'; // Default routing method
  if (blacklistedGateways === undefined) updates.blacklistedGateways = [];
  if (ensResolutionEnabled === undefined) updates.ensResolutionEnabled = true;
  if (existingVerificationStrict === undefined)
    updates.verificationStrict = false;

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
    try {
      // Only process main frame to avoid iframe noise
      if (details.frameId !== 0) return;

      const url = new URL(details.url);
      const arUrl = url.searchParams.get('q');

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

        // Note: Verification will happen automatically through Wayfinder when the actual content is requested
      } else {
        logger.error(`Failed to route ${arUrl} - no valid gateway found`);
        // Show error to user
        chrome.tabs.update(details.tabId, { 
          url: `data:text/html,<h1>Failed to resolve ${arUrl}</h1><p>No available gateways could handle this request.</p>` 
        });
      }
    } catch (error) {
      logger.error('Error processing ar:// navigation:', error);
      // Show error page to user
      try {
        chrome.tabs.update(details.tabId, { 
          url: `data:text/html,<h1>Error processing ${arUrl}</h1><p>${error instanceof Error ? error.message : 'Unknown error occurred'}</p>` 
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
 * Track ArNS resolution for debugging (no history logging)
 */
chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    const tabInfo = tabStateManager.get(details.tabId);

    if (tabInfo) {
      // Check for ArNS resolution headers (for debugging only)
      for (const header of details.responseHeaders || []) {
        if (header.name.toLowerCase() === 'x-arns-resolved-id') {
          logger.debug(`ArNS resolved: ${details.url} -> ${header.value}`);
          break;
        }
      }

      // Note: Verification is now handled by the Wayfinder core library automatically
      // when using makeVerifiedRequest() or the Wayfinder.request() method

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
    } catch (_error) {
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
  const validTypes = ['convertArUrlToHttpUrl', 'makeVerifiedRequest'];

  if (
    !validMessages.includes(request.message) &&
    !validTypes.includes(request.type)
  ) {
    logger.warn('Unauthorized message:', request);
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

  // Make verified request using Wayfinder with proper verification tracking
  if (request.type === 'makeVerifiedRequest') {
    (async () => {
      try {
        const wayfinder = await getWayfinderInstance();

        // Track verification status for this request
        const verificationResult = {
          verified: false,
          strategy: null,
          error: null,
        };

        // Set up temporary event listeners for this specific request
        const handleVerificationPassed = (event: any) => {
          logger.info('[SUCCESS] Verification passed:', event);
          verificationResult.verified = true;
          verificationResult.strategy = event.strategy || 'unknown';
          updateDailyStats('verified');
        };

        const handleVerificationFailed = (event: any) => {
          logger.warn('[FAILED] Verification failed:', event);
          verificationResult.verified = false;
          verificationResult.error =
            event.error || event.message || 'Verification failed';
          updateDailyStats('failed');
        };

        // Add listeners
        wayfinder.emitter.on(
          'verification-succeeded',
          handleVerificationPassed,
        );
        wayfinder.emitter.on('verification-failed', handleVerificationFailed);

        try {
          // Make actual GET request to download and verify data
          const requestOptions = {
            ...request.options,
            method: 'GET', // Must be GET to download data for verification
          };

          const response = await wayfinder.request(request.url, requestOptions);

          // Give verification a moment to complete
          await new Promise((resolve) => setTimeout(resolve, 2000));

          // Convert response to serializable format
          const responseData = {
            ok: response.ok,
            status: response.status,
            statusText: response.statusText,
            headers: Object.fromEntries(response.headers.entries()),
            url: response.url,
            verification: verificationResult,
          };

          sendResponse({ success: true, response: responseData });
        } finally {
          // Clean up listeners
          wayfinder.emitter.off(
            'verification-succeeded',
            handleVerificationPassed,
          );
          wayfinder.emitter.off(
            'verification-failed',
            handleVerificationFailed,
          );
        }
      } catch (error: any) {
        logger.error('Error making verified request:', error);
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
 * Sync gateway address registry from AR.IO network
 */
async function syncGatewayAddressRegistry(): Promise<void> {
  try {
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
    } else {
      await chrome.storage.local.set({ localGatewayAddressRegistry: registry });
      logger.info(`Synced ${totalFetched} gateways to registry.`);

      // Update last sync timestamp
      await chrome.storage.local.set({ lastSyncTime: Date.now() });
    }
  } catch (error) {
    logger.error('Error syncing Gateway Address Registry:', error);
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

/**
 * Update ArNS cache with new values and change history
 */
async function updateArNSCache(
  cacheKey: string,
  cachedResult: any,
  changes: any[],
  newTxId: string,
  newProcessId: string | null,
  newDataId: string | null
): Promise<void> {
  try {
    // Update the cache entry with new values
    const updatedCache = {
      ...cachedResult,
      txId: newTxId,
      processId: newProcessId || cachedResult.processId,
      dataId: newDataId || cachedResult.dataId,
      timestamp: Date.now(),
      changeHistory: [
        ...(cachedResult.changeHistory || []),
        ...changes
      ].slice(-10) // Keep last 10 changes
    };
    
    await verificationCache.set(cacheKey, updatedCache);
    logger.info(`[ARNS] [VERIFY] Updated cache for ${cacheKey} with ${changes.length} changes`);
    
  } catch (error) {
    logger.error('[ARNS] [VERIFY] Error updating ArNS cache:', error);
  }
}

/**
 * Verify ar:// content in the background after navigation
 */
async function verifyInBackground(arUrl: string, tabId: number): Promise<void> {
  try {
    logger.info(`🔍 [VERIFY] Starting background verification for: ${arUrl}`);

    const wayfinder = await getWayfinderInstance();

    // Get verification settings
    const {
      verificationEnabled = true,
      verificationStrict = false,
      showVerificationToasts = false,
    } = await chrome.storage.local.get([
      'verificationEnabled',
      'verificationStrict',
      'showVerificationToasts',
    ]);

    if (!verificationEnabled) {
      logger.info('[SKIP] [VERIFY] Verification is disabled, skipping');
      return;
    }

    // Extract transaction ID for cache key (wayfinder-core will handle ArNS resolution)
    let txId: string | null = null;
    const directTxMatch = arUrl.match(/^ar:\/\/([a-zA-Z0-9_-]{43})/);
    const isArNSName = !directTxMatch && arUrl.startsWith('ar://');
    
    if (directTxMatch) {
      txId = directTxMatch[1];
    }

    // Check cache first if we have a direct transaction ID
    // For ArNS names, we can't check cache until we get the resolved txId from verification
    if (txId) {
      logger.info(`🔍 [VERIFY] Direct transaction ID detected: ${txId}`);
      try {
        const cachedResult = await verificationCache.get(txId);
        if (cachedResult && cachedResult.verified) {
          logger.info(`✅ [CACHE] [VERIFY] Using cached hash for direct transaction ${txId} - skipping new verification`);
          logger.info(`🔑 [CACHE] [HASH] Using cached hash: ${cachedResult.hash?.substring(0, 12)}... (generated ${((Date.now() - cachedResult.timestamp) / (1000 * 60 * 60)).toFixed(1)}h ago)`);
          
          // Update stats
          await updateDailyStats('verified');
          
          // Show success toast if enabled
          if (showVerificationToasts) {
            await showVerificationToast(tabId, true, 'Verified (cached hash)');
          }
          
          return; // Skip verification, use cached result
        } else {
          logger.info(`❌ [CACHE] [VERIFY] No valid cached hash found for ${txId} - will generate new hash`);
        }
      } catch (error) {
        logger.warn('[CACHE] [VERIFY] Error checking cache:', error);
      }
    } else if (isArNSName) {
      logger.info(`🔍 [VERIFY] ArNS name detected: ${arUrl}. Will resolve and check cache after resolution.`);
    }

    // Track verification status with promise for completion
    const verificationResult = {
      verified: false,
      strategy: null as string | null,
      error: null as string | null,
      hash: null as string | null,
      txId: null as string | null, // x-arns-resolved-id or direct transaction ID
      dataId: null as string | null, // x-ar-io-data-id (actual content being served)
      processId: null as string | null, // x-arns-process-id
    };

    // Create a promise that resolves when verification completes
    let verificationComplete: (value: void) => void;
    const verificationPromise = new Promise<void>((resolve) => {
      verificationComplete = resolve;
    });

    // Set up verification event listeners
    const handleVerificationPassed = (event: any) => {
      logger.info(
        `[SUCCESS] [VERIFY] Background verification PASSED for ${arUrl}`,
      );
      verificationResult.verified = true;
      verificationResult.strategy = event.strategy || 'unknown';
      verificationResult.hash = event.hash || null;
      verificationResult.txId = event.txId || txId; // Use event txId or fallback to extracted txId
      updateDailyStats('verified');
      verificationComplete();
    };

    const handleVerificationFailed = (event: any) => {
      logger.warn(
        `[FAILED] [VERIFY] Background verification FAILED for ${arUrl}:`,
        event,
      );
      verificationResult.verified = false;
      verificationResult.error =
        event.error || event.message || 'Verification failed';
      updateDailyStats('failed');
      verificationComplete();
    };

    // Add listeners
    wayfinder.emitter.on('verification-succeeded', handleVerificationPassed);
    wayfinder.emitter.on('verification-failed', handleVerificationFailed);

    try {
      logger.info(`🔄 [VERIFY] [NEW] Starting new verification process for ${arUrl}`);
      logger.info(`⚙️ [VERIFY] [PROCESS] Will generate fresh hash and verify against trusted gateways`);

      // Make the verification request
      const response = await wayfinder.request(arUrl, {
        method: 'GET',
        headers: {
          Accept: '*/*',
        },
      });

      logger.info(
        `[RESPONSE] [VERIFY] Response received, status: ${response.status}`,
      );

      // Extract AR.IO gateway headers for caching and change detection
      const arnsResolvedId = response.headers.get('x-arns-resolved-id');
      const arIoDataId = response.headers.get('x-ar-io-data-id');
      const arnsProcessId = response.headers.get('x-arns-process-id');
      
      logger.info(`[HEADERS] [VERIFY] x-arns-resolved-id: ${arnsResolvedId}, x-ar-io-data-id: ${arIoDataId}, x-arns-process-id: ${arnsProcessId}`);

      // Store resolved transaction IDs for caching
      if (arnsResolvedId) {
        verificationResult.txId = arnsResolvedId;
        logger.info(`[RESOLVE] [VERIFY] ArNS ${arUrl} resolved to ${arnsResolvedId}`);
      }
      if (arIoDataId) {
        verificationResult.dataId = arIoDataId;
        logger.info(`[DATA] [VERIFY] Content data ID: ${arIoDataId}`);
      }
      if (arnsProcessId) {
        verificationResult.processId = arnsProcessId;
        logger.info(`[PROCESS] [VERIFY] ArNS process ID: ${arnsProcessId}`);
      }

      // Check cache using resolved transaction ID and detect changes
      if (arnsResolvedId && !txId && isArNSName) {
        logger.info(`🔍 [ARNS] [VERIFY] ArNS ${arUrl} resolved to transaction ID: ${arnsResolvedId}`);
        try {
          const cachedResult = await verificationCache.get(arnsResolvedId);
          if (cachedResult && cachedResult.verified) {
            logger.info(`✅ [CACHE] [ARNS] Found cached hash for resolved ArNS transaction ${arnsResolvedId}`);
            logger.info(`🔑 [CACHE] [HASH] Using cached hash: ${cachedResult.hash?.substring(0, 12)}... (generated ${((Date.now() - cachedResult.timestamp) / (1000 * 60 * 60)).toFixed(1)}h ago)`);
            
            // Check for ArNS changes since last visit
            const changes = detectArNSChanges(cachedResult, arnsResolvedId, arnsProcessId, arIoDataId);
            
            if (changes.length > 0) {
              logger.info(`🔄 [ARNS] [VERIFY] Changes detected for ${arUrl} since last visit:`, changes);
              await notifyArNSChanges(tabId, arUrl, changes);
              
              // Update cache with new values and change history
              await updateArNSCache(arnsResolvedId, cachedResult, changes, arnsResolvedId, arnsProcessId, arIoDataId);
            } else {
              logger.info(`✅ [CACHE] [ARNS] No changes detected for ${arUrl} - using cached verification`);
            }
            
            // Update last visit time
            cachedResult.lastVisit = Date.now();
            await verificationCache.set(arnsResolvedId, cachedResult);
            
            // Update stats
            await updateDailyStats('verified');
            
            // Show success toast if enabled
            if (showVerificationToasts) {
              await showVerificationToast(tabId, true, changes.length > 0 ? 'Verified (changes detected)' : 'Verified (cached hash)');
            }
            
            return; // Skip verification, use cached result
          } else {
            logger.info(`❌ [CACHE] [ARNS] No cached hash found for resolved transaction ${arnsResolvedId} - will generate new hash`);
          }
        } catch (error) {
          logger.warn('[CACHE] [VERIFY] Error checking resolved ID cache:', error);
        }
      }

      // IMPORTANT: Do NOT consume the response body here
      // The wayfinder-core library needs to process the stream for verification
      // Verification happens automatically when the response is returned

      // Wait for verification to complete (with timeout)
      await Promise.race([
        verificationPromise,
        new Promise((resolve) => setTimeout(resolve, 5000)), // 5 second timeout
      ]);

      logger.info(
        `[FINAL] [VERIFY] Final verification status: ${verificationResult.verified ? 'PASSED' : 'FAILED'}`,
      );

      // Cache the result if verification succeeded
      // Use x-arns-resolved-id as cache key for ArNS names, or original txId for direct transaction URLs
      const cacheKey = verificationResult.txId || txId;
      if (verificationResult.verified && verificationResult.hash && cacheKey) {
        logger.info(`🔄 [HASH] [NEW] Generated new verification hash for ${cacheKey}: ${verificationResult.hash.substring(0, 12)}...`);
        logger.info(`💾 [CACHE] [NEW] Caching new verification result for future use`);
        
        try {
          await verificationCache.set(cacheKey, {
            txId: cacheKey,
            hash: verificationResult.hash,
            algorithm: 'sha256',
            timestamp: Date.now(),
            verified: true,
            dataId: verificationResult.dataId, // Store the actual content ID that was verified
            arnsName: isArNSName ? arUrl : undefined, // Store original ArNS name if applicable
            processId: isArNSName ? arnsProcessId || undefined : undefined, // Store process ID for ArNS names
            lastVisit: Date.now(), // Track when this ArNS name was first cached
            changeHistory: [], // Initialize empty change history
          });
          
          if (isArNSName) {
            logger.info(`✅ [CACHE] [ARNS] Successfully cached new hash for ArNS ${arUrl} → ${cacheKey} (processId: ${arnsProcessId?.substring(0, 8) || 'none'})`);
          } else {
            logger.info(`✅ [CACHE] [DIRECT] Successfully cached new hash for direct transaction ${cacheKey}`);
          }
        } catch (error) {
          logger.warn('❌ [CACHE] [ERROR] Failed to cache verification result:', error);
        }
      } else if (verificationResult.verified) {
        logger.warn(`⚠️ [CACHE] [SKIP] Cannot cache verification - missing hash or cache key (verified: ${verificationResult.verified}, hash: ${!!verificationResult.hash}, cacheKey: ${cacheKey})`);
      } else {
        logger.info(`❌ [HASH] [FAILED] Verification failed - not caching result for ${cacheKey || arUrl}`);
      }

      // If strict mode and verification failed, show an alert
      if (verificationStrict && !verificationResult.verified) {
        // Inject warning into the tab
        chrome.scripting.executeScript({
          target: { tabId: tabId },
          func: () => {
            const warning = document.createElement('div');
            warning.style.cssText =
              'position: fixed; bottom: 20px; right: 20px; background: #ff4444; color: white; padding: 16px; border-radius: 8px; z-index: 10000; font-family: sans-serif; box-shadow: 0 4px 12px rgba(0,0,0,0.3); animation: slideUp 0.3s ease-out;';
            warning.innerHTML =
              '<strong><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display: inline-block; vertical-align: middle; margin-right: 4px;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> Verification Failed</strong><br>This content could not be verified through the AR.IO network.';

            // Add slide up animation
            const style = document.createElement('style');
            style.textContent = `
              @keyframes slideUp {
                from {
                  transform: translateY(100%);
                  opacity: 0;
                }
                to {
                  transform: translateY(0);
                  opacity: 1;
                }
              }
            `;
            document.head.appendChild(style);

            document.body.appendChild(warning);
            setTimeout(() => {
              warning.style.animation = 'slideUp 0.3s ease-out reverse';
              setTimeout(() => {
                warning.remove();
                style.remove();
              }, 300);
            }, 10000);
          },
        });
      }

      // Show toast if enabled
      if (showVerificationToasts) {
        await showVerificationToast(tabId, verificationResult.verified);
      }
    } finally {
      // Clean up listeners
      wayfinder.emitter.off('verification-succeeded', handleVerificationPassed);
      wayfinder.emitter.off('verification-failed', handleVerificationFailed);
    }
  } catch (error) {
    logger.error(
      '[CRITICAL] [VERIFY] Error in background verification:',
      error,
    );
  }
}


/**
 * Show verification toast
 */
async function showVerificationToast(
  tabId: number,
  verified: boolean,
  customMessage?: string,
): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (verified, message) => {
        const toast = document.createElement('div');
        toast.style.cssText = `position: fixed; bottom: 20px; right: 20px; background: ${verified ? '#10b981' : '#ff4444'}; color: white; padding: 12px 16px; border-radius: 8px; z-index: 10000; font-family: sans-serif; box-shadow: 0 4px 12px rgba(0,0,0,0.3); animation: slideUp 0.3s ease-out;`;

        const iconSvg = verified
          ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display: inline-block; vertical-align: middle; margin-right: 4px;"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>'
          : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display: inline-block; vertical-align: middle; margin-right: 4px;"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';

        toast.innerHTML =
          iconSvg +
          (message ||
            (verified
              ? ' Content verified successfully'
              : ' Content verification failed'));

        // Add slide up animation
        const style = document.createElement('style');
        style.textContent = `
          @keyframes slideUp {
            from {
              transform: translateY(100%);
              opacity: 0;
            }
            to {
              transform: translateY(0);
              opacity: 1;
            }
          }
        `;
        document.head.appendChild(style);

        document.body.appendChild(toast);
        setTimeout(() => {
          toast.style.animation = 'slideUp 0.3s ease-out reverse';
          setTimeout(() => {
            toast.remove();
            style.remove();
          }, 300);
        }, 3000);
      },
      args: [Boolean(verified), customMessage || null], // Ensure serializable args
    });
  } catch (error) {
    logger.error('[ERROR] [VERIFY] Could not show verification toast:', error);
  }
}

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
