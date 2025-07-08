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
const requestTimings = new Map<string, number>();

// Initializing Wayfinder Extension

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
  const { routingMethod, blacklistedGateways, ensResolutionEnabled } =
    await chrome.storage.local.get([
      'routingMethod',
      'blacklistedGateways',
      'ensResolutionEnabled',
    ]);

  if (routingMethod === undefined)
    updates.routingMethod = EXTENSION_DEFAULTS.routingMethod;
  if (blacklistedGateways === undefined)
    updates.blacklistedGateways = EXTENSION_DEFAULTS.blacklistedGateways;
  if (ensResolutionEnabled === undefined)
    updates.ensResolutionEnabled = EXTENSION_DEFAULTS.ensResolutionEnabled;
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

    // Initialize Wayfinder instance - this will be created lazily on first use
    // Wayfinder initialization completed
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

      // Original ar:// URL handling
      arUrl = url.searchParams.get('q');

      if (!arUrl || !arUrl.startsWith('ar://')) return;

      // Validate ar:// URL format
      if (arUrl.length < 6) {
        logger.error(`Invalid ar:// URL format: ${arUrl}`);
        return;
      }

      // Processing ar:// navigation

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
        // Redirected to gateway

        // Track the request
        updateDailyStats('request');

        // Navigation successful - request was routed to the gateway
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
    // Cleaned up tab state
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

    // Performance metrics updated

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
            // ArNS resolved
            break;
          case 'x-ar-io-data-id':
            dataId = headerValue;
            break;
        }
      }

      // Detect manifest using your insight: different resolved vs data IDs indicates manifest
      let manifestData = null;
      if (arnsResolvedId && dataId && arnsResolvedId !== dataId) {
        logger.info(
          `[MANIFEST-DETECT] Manifest detected! Resolved ID: ${arnsResolvedId}, Data ID: ${dataId}`,
        );
        
        // Get the routed gateway URL from tab state for manifest fetching
        try {
          const tabInfo = tabStateManager.get(details.tabId);
          let gatewayUrl = tabInfo?.gatewayUrl;
          
          // Fallback: if no routed gateway available, extract from wayfinder routing
          if (!gatewayUrl) {
            // Try to get gateway from wayfinder routing system
            try {
              const wayfinder = getWayfinderInstance();
              const routedUrl = await getRoutableGatewayUrl(`ar://${arnsResolvedId}`, wayfinder);
              if (routedUrl) {
                const urlMatch = routedUrl.match(/^(https?:\/\/[^\/]+)/);
                gatewayUrl = urlMatch ? urlMatch[1] : null;
              }
            } catch (routingError) {
              logger.warn('[MANIFEST-FETCH] Could not get routed gateway URL:', routingError);
            }
          }
          
          // Final fallback: use resolved domain (but log the issue)
          if (!gatewayUrl) {
            const currentUrl = new URL(details.url);
            gatewayUrl = `${currentUrl.protocol}//${currentUrl.host}`;
            logger.warn('[MANIFEST-FETCH] Using resolved ArNS domain as fallback - this may cause issues');
          }
          
          const manifestUrl = `${gatewayUrl}/raw/${arnsResolvedId}`;
          
          logger.info(`[MANIFEST-FETCH] Fetching raw manifest from: ${manifestUrl}`);
          
          const manifestResponse = await fetch(manifestUrl, {
            signal: AbortSignal.timeout(10000) // 10 second timeout
          });
          
          if (manifestResponse.ok) {
            const contentType = manifestResponse.headers.get('content-type') || '';
            const manifestText = await manifestResponse.text();
            
            // Check if response is JSON before parsing
            if (!contentType.includes('application/json') && !manifestText.trim().startsWith('{')) {
              logger.warn(`[MANIFEST-FETCH] Unexpected content type: ${contentType}, got HTML or non-JSON response`);
              logger.debug('[MANIFEST-FETCH] Response preview:', manifestText.substring(0, 200));
            } else {
              try {
                const manifest = JSON.parse(manifestText);
                
                if (manifest.manifest === 'arweave/paths' && 
                    (manifest.version === '0.1.0' || manifest.version === '0.2.0')) {
                  manifestData = manifest;
                  logger.info(`[MANIFEST-FETCH] Successfully fetched manifest with ${Object.keys(manifest.paths || {}).length} paths`);
                } else {
                  logger.warn('[MANIFEST-FETCH] Invalid manifest format');
                }
              } catch (parseError) {
                logger.error('[MANIFEST-FETCH] Failed to parse manifest JSON:', parseError);
                logger.debug('[MANIFEST-FETCH] Response preview:', manifestText.substring(0, 200));
              }
            }
          } else {
            logger.warn(`[MANIFEST-FETCH] Failed to fetch manifest: ${manifestResponse.status}`);
          }
        } catch (error) {
          logger.error('[MANIFEST-FETCH] Error fetching manifest:', error);
        }
      } else if (arnsResolvedId && !dataId) {
        // Fallback: Check if resolved ID points to a manifest when data ID is null
        logger.info(
          `[MANIFEST-DETECT-FALLBACK] Checking if resolved ID is manifest: ${arnsResolvedId} (data ID is null)`,
        );
        
        try {
          const currentUrl = new URL(details.url);
          const gatewayUrl = `${currentUrl.protocol}//${currentUrl.host}`;
          const headUrl = `${gatewayUrl}/${arnsResolvedId}`;
          
          logger.info(`[MANIFEST-DETECT-FALLBACK] HEAD request to: ${headUrl}`);
          
          const headResponse = await fetch(headUrl, {
            method: 'HEAD',
            signal: AbortSignal.timeout(5000) // 5 second timeout for HEAD request
          });
          
          if (headResponse.ok) {
            const contentType = headResponse.headers.get('content-type') || '';
            logger.info(`[MANIFEST-DETECT-FALLBACK] Content-Type: ${contentType}`);
            
            if (contentType.includes('application/x.arweave-manifest+json') || 
                contentType.includes('application/json')) {
              // Looks like a manifest, fetch it
              logger.info(`[MANIFEST-DETECT-FALLBACK] Manifest content-type detected, fetching full manifest`);
              
              const manifestUrl = `${gatewayUrl}/raw/${arnsResolvedId}`;
              const manifestResponse = await fetch(manifestUrl, {
                signal: AbortSignal.timeout(10000)
              });
              
              if (manifestResponse.ok) {
                const manifestText = await manifestResponse.text();
                
                try {
                  const manifest = JSON.parse(manifestText);
                  
                  if (manifest.manifest === 'arweave/paths' && 
                      (manifest.version === '0.1.0' || manifest.version === '0.2.0')) {
                    manifestData = manifest;
                    logger.info(`[MANIFEST-DETECT-FALLBACK] Successfully detected and fetched manifest with ${Object.keys(manifest.paths || {}).length} paths`);
                  } else {
                    logger.info('[MANIFEST-DETECT-FALLBACK] JSON found but not a valid Arweave manifest');
                  }
                } catch (parseError) {
                  logger.info('[MANIFEST-DETECT-FALLBACK] JSON parse failed, not a manifest');
                }
              }
            } else {
              logger.info(`[MANIFEST-DETECT-FALLBACK] Not a manifest content-type: ${contentType}`);
            }
          } else {
            logger.warn(`[MANIFEST-DETECT-FALLBACK] HEAD request failed: ${headResponse.status}`);
          }
        } catch (error) {
          logger.error('[MANIFEST-DETECT-FALLBACK] Error in fallback manifest detection:', error);
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
  ];
  const validTypes = [
    'convertArUrlToHttpUrl',
    'openSettings',
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

  // Removed: updateVerificationMode handler - verification modes no longer used

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

// REMOVED: Old verifyInBackground function - use verifyInBackgroundWithCache instead
// REMOVED: updateArNSCache and showVerificationToast functions (moved to background-verification-cached.ts)

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
