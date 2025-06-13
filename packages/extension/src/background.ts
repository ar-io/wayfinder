/**
 * WayFinder
 * Copyright (C) 2022-2025 Permanent Data Solutions, Inc. All Rights Reserved.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

import { AOProcess, ARIO, AoGateway, WalletAddress } from '@ar.io/sdk/web';
import { connect } from '@permaweb/aoconnect';
import { ChromeStorageGatewayProvider } from './adapters/chrome-storage-gateway-provider';
import {
  ARIO_MAINNET_PROCESS_ID,
  DEFAULT_AO_CU_URL,
  OPTIMAL_GATEWAY_ROUTE_METHOD,
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
chrome.storage.local.get(['dailyStats']).then(({ dailyStats }) => {
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

  chrome.storage.local.set({
    routingMethod: OPTIMAL_GATEWAY_ROUTE_METHOD,
    localGatewayAddressRegistry: {},
    blacklistedGateways: [],
    processId: ARIO_MAINNET_PROCESS_ID,
    aoCuUrl: DEFAULT_AO_CU_URL,
    ensResolutionEnabled: true,
    verificationStrict: false,
    dailyStats: existingStats,
  });
});

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
    const { localGatewayAddressRegistry = {} } = await chrome.storage.local.get(['localGatewayAddressRegistry']);
    const gatewayCount = Object.keys(localGatewayAddressRegistry).length;
    
    if (gatewayCount === 0) {
      logger.warn('No gateways found after sync. Users will need to manually sync or fallback gateways will be used.');
    } else {
      logger.info(`Successfully synced ${gatewayCount} gateways`);
    }

    // Initialize Wayfinder instance - this will be created lazily on first use
    logger.info('Wayfinder initialization completed');
  } catch (error) {
    logger.error('Error during Wayfinder initialization:', error);
    logger.warn('Users can manually sync gateways in Settings > Network Configuration');
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
        
        // Start verification in background after navigation
        verifyInBackground(arUrl, details.tabId);
      }
    } catch (error) {
      logger.error('Error processing ar:// navigation:', error);
    }
  },
  { url: [{ schemes: ['http', 'https'] }] },
);

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
          logger.info('✅ Verification passed:', event);
          verificationResult.verified = true;
          verificationResult.strategy = event.strategy || 'unknown';
          updateDailyStats('verified');
        };

        const handleVerificationFailed = (event: any) => {
          logger.warn('❌ Verification failed:', event);
          verificationResult.verified = false;
          verificationResult.error =
            event.error || event.message || 'Verification failed';
          updateDailyStats('failed');
        };

        // Add listeners
        wayfinder.emitter.on('verification-succeeded', handleVerificationPassed);
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
    (async () => {
      try {
        await chrome.storage.local.set({ routingMethod: request.strategy });
        // Reset Wayfinder instance to use new strategy
        resetWayfinderInstance();
        sendResponse({ success: true });
      } catch (error: any) {
        logger.error('Error updating routing strategy:', error);
        sendResponse({ error: error?.message || 'Unknown error' });
      }
    })();
    return true;
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
      throw new Error('❌ Process ID or AO CU URL missing in local storage.');
    }

    logger.info(`Syncing Gateway Address Registry from ${aoCuUrl}`);

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
 * Verify ar:// content in the background after navigation
 */
async function verifyInBackground(arUrl: string, tabId: number): Promise<void> {
  try {
    logger.info(`🔍 [VERIFY] Starting background verification for: ${arUrl}`);
    
    const wayfinder = await getWayfinderInstance();
    
    // Get verification settings
    const { verificationEnabled = true, verificationStrict = false, showVerificationToasts = false } = 
      await chrome.storage.local.get(['verificationEnabled', 'verificationStrict', 'showVerificationToasts']);
    
    if (!verificationEnabled) {
      logger.info('⏭️ [VERIFY] Verification is disabled, skipping');
      return;
    }
    
    // Track verification status
    let verificationResult = {
      verified: false,
      strategy: null as string | null,
      error: null as string | null,
    };
    
    // Set up verification event listeners
    const handleVerificationPassed = (event: any) => {
      logger.info(`✅ [VERIFY] Background verification PASSED for ${arUrl}`);
      verificationResult.verified = true;
      verificationResult.strategy = event.strategy || 'unknown';
      updateDailyStats('verified');
    };
    
    const handleVerificationFailed = (event: any) => {
      logger.warn(`❌ [VERIFY] Background verification FAILED for ${arUrl}:`, event);
      verificationResult.verified = false;
      verificationResult.error = event.error || event.message || 'Verification failed';
      updateDailyStats('failed');
    };
    
    // Add listeners
    wayfinder.emitter.on('verification-succeeded', handleVerificationPassed);
    wayfinder.emitter.on('verification-failed', handleVerificationFailed);
    
    try {
      logger.info(`🌐 [VERIFY] Making background verification request...`);
      
      // Make the verification request
      const response = await wayfinder.request(arUrl, {
        method: 'GET',
        headers: {
          'Accept': '*/*'
        }
      });
      
      logger.info(`📦 [VERIFY] Response received, status: ${response.status}`);
      
      // Wait for verification to complete
      await new Promise((resolve) => setTimeout(resolve, 3000));
      
      logger.info(`🔒 [VERIFY] Final verification status: ${verificationResult.verified ? 'PASSED' : 'FAILED'}`);
      
      // If strict mode and verification failed, show an alert
      if (verificationStrict && !verificationResult.verified) {
        // Inject warning into the tab
        chrome.scripting.executeScript({
          target: { tabId: tabId },
          func: () => {
            const warning = document.createElement('div');
            warning.style.cssText = 'position: fixed; top: 20px; right: 20px; background: #ff4444; color: white; padding: 16px; border-radius: 8px; z-index: 10000; font-family: sans-serif; box-shadow: 0 4px 12px rgba(0,0,0,0.3);';
            warning.innerHTML = '<strong>⚠️ Verification Failed</strong><br>This content could not be verified through the AR.IO network.';
            document.body.appendChild(warning);
            setTimeout(() => warning.remove(), 10000);
          }
        });
      }
      
      // Show toast if enabled
      if (showVerificationToasts) {
        chrome.scripting.executeScript({
          target: { tabId: tabId },
          func: (verified) => {
            const toast = document.createElement('div');
            toast.style.cssText = `position: fixed; top: 20px; right: 20px; background: ${verified ? '#10b981' : '#ff4444'}; color: white; padding: 12px 16px; border-radius: 8px; z-index: 10000; font-family: sans-serif; box-shadow: 0 4px 12px rgba(0,0,0,0.3);`;
            toast.textContent = verified ? '✅ Content verified successfully' : '❌ Content verification failed';
            document.body.appendChild(toast);
            setTimeout(() => toast.remove(), 3000);
          },
          args: [verificationResult.verified]
        });
      }
      
    } finally {
      // Clean up listeners
      wayfinder.emitter.off('verification-succeeded', handleVerificationPassed);
      wayfinder.emitter.off('verification-failed', handleVerificationFailed);
    }
    
  } catch (error) {
    logger.error('💥 [VERIFY] Error in background verification:', error);
  }
}

// Start initialization
initializeWayfinder().catch((err) =>
  logger.error('Error during Wayfinder initialization:', err),
);
