/**
 * WayFinder Extension - Verified Content Page
 * Copyright (C) 2022-2025 Permanent Data Solutions, Inc.
 *
 * Licensed under the Apache License, Version 2.0
 *
 * This page provides a verified browsing experience for Arweave content.
 * Content is fetched and verified by the background service worker, then
 * rendered in a sandboxed iframe where CSP restrictions are relaxed.
 *
 * Architecture:
 * 1. This page sends INIT_VERIFICATION to configure the background
 * 2. User searches → START_VERIFICATION triggers background verification
 * 3. Background broadcasts progress events, we update UI
 * 4. On completion, we request GET_VERIFIED_CONTENT from background
 * 5. We send content to sandbox.html iframe via postMessage
 * 6. Sandbox renders content with relaxed CSP (eval, inline scripts allowed)
 *
 * Why sandbox? Chrome extension pages have strict CSP that blocks:
 * - Inline scripts
 * - eval() and new Function()
 * - External scripts
 * Sandbox pages are exempt from extension CSP and can run any JavaScript.
 */

import {
  getRoutingGateways,
  getTrustedGateways,
} from './verification/trusted-gateways';
import type {
  SwWayfinderConfig,
  VerificationEvent,
} from './verification/types';

// DOM Elements
const searchInput = document.getElementById('searchInput') as HTMLInputElement;
const searchBtn = document.getElementById('searchBtn') as HTMLButtonElement;
const verificationBadge = document.getElementById(
  'verificationBadge',
) as HTMLDivElement;
const badgeText = document.getElementById('badgeText') as HTMLSpanElement;

const loadingScreen = document.getElementById(
  'loadingScreen',
) as HTMLDivElement;
const loadingTitle = document.getElementById(
  'loadingTitle',
) as HTMLHeadingElement;
const loadingSubtitle = document.getElementById(
  'loadingSubtitle',
) as HTMLParagraphElement;
const phase1 = document.getElementById('phase1') as HTMLDivElement;
const phase2 = document.getElementById('phase2') as HTMLDivElement;
const phase3 = document.getElementById('phase3') as HTMLDivElement;
const progressContainer = document.getElementById(
  'progressContainer',
) as HTMLDivElement;
const progressFill = document.getElementById('progressFill') as HTMLDivElement;
const progressLabel = document.getElementById(
  'progressLabel',
) as HTMLSpanElement;
const progressPercent = document.getElementById(
  'progressPercent',
) as HTMLSpanElement;
const activityLog = document.getElementById('activityLog') as HTMLDivElement;
const gatewayHost = document.getElementById('gatewayHost') as HTMLSpanElement;

const emptyState = document.getElementById('emptyState') as HTMLDivElement;
const errorState = document.getElementById('errorState') as HTMLDivElement;
const errorTitle = document.getElementById('errorTitle') as HTMLHeadingElement;
const errorMessage = document.getElementById(
  'errorMessage',
) as HTMLParagraphElement;
const retryBtn = document.getElementById('retryBtn') as HTMLButtonElement;

const contentFrame = document.getElementById(
  'contentFrame',
) as HTMLIFrameElement;

// State
let currentIdentifier: string | null = null;
let verificationReady = false;
let sandboxReady = false;

/**
 * Initialize the page.
 */
async function init(): Promise<void> {
  // Set up event listeners
  searchBtn.addEventListener('click', handleSearch);
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  });
  retryBtn.addEventListener('click', handleRetry);

  // Listen for messages from sandbox iframe
  window.addEventListener('message', handleSandboxMessage);

  // Parse URL parameters
  const params = new URLSearchParams(window.location.search);
  const query = params.get('q');
  if (query) {
    searchInput.value = query;
  }

  // Load sandbox iframe
  contentFrame.src = chrome.runtime.getURL('sandbox.html');

  // Initialize verification in the background service worker
  try {
    await initializeVerification();
    verificationReady = true;
    console.log('[Verified] Verification service ready');

    // Auto-execute search if query param was provided
    if (query) {
      handleSearch();
    }
  } catch (error) {
    console.error('[Verified] Failed to initialize verification:', error);
    const errorMsg = error instanceof Error ? error.message : String(error);
    showError(
      'Initialization Error',
      `Failed to initialize verification service: ${errorMsg}`,
    );
  }

  // Listen for verification events from background
  chrome.runtime.onMessage.addListener(handleBackgroundMessage);
}

/**
 * Initialize verification in the background service worker.
 */
async function initializeVerification(): Promise<void> {
  console.log('[Verified] Building verification config...');

  const config = await buildVerificationConfig();
  console.log('[Verified] Config built:', {
    trustedGateways: config.trustedGateways.length,
    routingGateways: config.routingGateways?.length || 0,
    routingStrategy: config.routingStrategy,
    hasPreferredGateway: !!config.preferredGateway,
  });

  // Send config to background service worker
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: 'INIT_VERIFICATION', config },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (response?.error) {
          reject(new Error(response.error));
        } else {
          resolve();
        }
      },
    );
  });
}

/**
 * Build the verification configuration.
 */
async function buildVerificationConfig(): Promise<SwWayfinderConfig> {
  // Get settings from storage
  const settings = await chrome.storage.local.get([
    'routingMethod',
    'staticGateway',
    'verificationStrict',
  ]);

  // Get trusted gateways (top by stake) for verification
  const trustedGateways = await getTrustedGateways(3);

  // Get routing gateways for content fetching (broader pool)
  const routingGateways = await getRoutingGateways();

  // Convert staticGateway object to URL string if present
  let preferredGateway: string | undefined;
  if (settings.staticGateway?.settings) {
    const { protocol = 'https', fqdn, port } = settings.staticGateway.settings;
    if (fqdn) {
      preferredGateway =
        port && port !== 443
          ? `${protocol}://${fqdn}:${port}`
          : `${protocol}://${fqdn}`;
    }
  }

  return {
    trustedGateways,
    routingGateways:
      routingGateways.length > 0 ? routingGateways : trustedGateways,
    routingStrategy: settings.routingMethod || 'random',
    preferredGateway,
    enabled: true,
    strict: settings.verificationStrict || false,
    concurrency: 10,
  };
}

/**
 * Handle search action.
 */
async function handleSearch(): Promise<void> {
  const input = searchInput.value.trim();
  if (!input) return;

  if (!verificationReady) {
    showError(
      'Not Ready',
      'Verification service is not ready. Please wait and try again.',
    );
    return;
  }

  // Update URL
  const url = new URL(window.location.href);
  url.searchParams.set('q', input);
  window.history.replaceState({}, '', url.toString());

  // Clear previous state
  currentIdentifier = input;

  // Show loading screen
  showLoading(input);

  // Clear previous verification if any
  await clearVerification(input);

  // Reload sandbox iframe to get a fresh JavaScript context
  // This is critical - just clearing innerHTML doesn't stop running scripts
  await reloadSandbox();

  // Start verification via background service worker
  console.log('[Verified] Starting verification:', input);
  chrome.runtime.sendMessage(
    { type: 'START_VERIFICATION', identifier: input },
    (response) => {
      if (chrome.runtime.lastError) {
        console.error(
          '[Verified] Verification start error:',
          chrome.runtime.lastError,
        );
        showError(
          'Verification Error',
          chrome.runtime.lastError.message || 'Failed to start verification',
        );
      } else if (response?.error) {
        console.error('[Verified] Verification error:', response.error);
        showError('Verification Error', response.error);
      }
      // Success is handled via verification-complete event
    },
  );
}

/**
 * Clear verification state for an identifier.
 */
async function clearVerification(identifier: string): Promise<void> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: 'CLEAR_VERIFICATION_STATE', identifier },
      () => resolve(),
    );
  });
}

/**
 * Reload the sandbox iframe to get a fresh JavaScript context.
 * This is necessary because clearing innerHTML doesn't stop running scripts,
 * event listeners, intervals, etc. from the previous content.
 */
async function reloadSandbox(): Promise<void> {
  sandboxReady = false;

  return new Promise((resolve) => {
    // Set up one-time listener for SANDBOX_READY
    const onReady = (event: MessageEvent) => {
      if (event.data?.type === 'SANDBOX_READY') {
        window.removeEventListener('message', onReady);
        sandboxReady = true;
        resolve();
      }
    };
    window.addEventListener('message', onReady);

    // Reload the iframe by resetting its src
    contentFrame.src = chrome.runtime.getURL('sandbox.html');

    // Safety timeout in case sandbox fails to load
    setTimeout(() => {
      window.removeEventListener('message', onReady);
      if (!sandboxReady) {
        console.warn('[Verified] Sandbox reload timeout, proceeding anyway');
        sandboxReady = true;
        resolve();
      }
    }, 5000);
  });
}

/**
 * Handle retry action.
 */
async function handleRetry(): Promise<void> {
  if (!currentIdentifier) return;

  // Clear verification and reload
  await clearVerification(currentIdentifier);
  await handleSearch();
}

/**
 * Handle messages from sandbox iframe.
 */
function handleSandboxMessage(event: MessageEvent): void {
  // Verify origin is our extension
  if (!event.origin.startsWith('chrome-extension://')) {
    return;
  }

  const { type, ...data } = event.data || {};

  switch (type) {
    case 'SANDBOX_READY':
      console.log('[Verified] Sandbox ready');
      sandboxReady = true;
      break;

    case 'RENDER_COMPLETE':
      console.log('[Verified] Sandbox render complete:', data.identifier);
      break;
  }
}

/**
 * Handle messages from the background service worker.
 * Returns true if the response will be sent asynchronously.
 */
function handleBackgroundMessage(
  message: { type: string; event?: VerificationEvent },
  _sender: chrome.runtime.MessageSender,
  _sendResponse: (response: any) => void,
): boolean | void {
  // Handle verification events
  if (message.type === 'VERIFICATION_EVENT' && message.event) {
    handleVerificationEvent(message.event);
    // Synchronous handling, no response needed
    return;
  }
  // Return undefined for unhandled messages to allow other listeners to process
}

/**
 * Handle verification events.
 */
function handleVerificationEvent(event: VerificationEvent): void {
  // Ignore events for other identifiers
  if (event.identifier !== currentIdentifier) return;

  console.log('[Verified] Event:', event.type, event);

  switch (event.type) {
    case 'verification-started':
      setPhase(1);
      loadingSubtitle.textContent = 'Resolving identifier...';
      break;

    case 'routing-gateway':
      setPhase(2);
      loadingSubtitle.textContent = 'Fetching content...';
      if (event.gatewayUrl) {
        try {
          gatewayHost.textContent = new URL(event.gatewayUrl).hostname;
        } catch {
          gatewayHost.textContent = event.gatewayUrl;
        }
      }
      break;

    case 'manifest-loaded':
      setPhase(3);
      if (event.isSingleFile) {
        loadingSubtitle.textContent = 'Verifying file...';
      } else {
        loadingSubtitle.textContent = 'Verifying resources...';
        if (event.progress) {
          progressContainer.style.display = 'block';
          updateProgress(event.progress.current, event.progress.total);
        }
      }
      break;

    case 'verification-progress':
      if (event.progress) {
        updateProgress(event.progress.current, event.progress.total);
      }
      if (event.resourcePath) {
        addActivityItem(event.resourcePath, true);
      }
      break;

    case 'verification-complete':
      handleVerificationComplete(event);
      break;

    case 'verification-failed':
      if (event.resourcePath) {
        // Individual resource failed, not fatal
        addActivityItem(event.resourcePath, false);
      } else {
        // Full verification failed
        hideLoading();
        showError(
          'Verification Failed',
          event.error || 'An unknown error occurred.',
        );
        updateBadge('failed');
      }
      break;
  }
}

/**
 * Handle verification complete - get content and send to sandbox.
 * Uses chunked loading to avoid Chrome message size limits.
 */
async function handleVerificationComplete(
  event: VerificationEvent,
): Promise<void> {
  console.log(
    '[Verified] Verification complete, loading content to sandbox...',
  );

  // Update UI
  loadingSubtitle.textContent = 'Loading verified content...';

  try {
    // Step 1: Get metadata (HTML + resource paths, but not resource data)
    const metadata = await new Promise<{
      success: boolean;
      error?: string;
      html?: string;
      resourcePaths?: Array<{
        path: string;
        contentType: string;
        size: number;
      }>;
      totalResources?: number;
    }>((resolve, reject) => {
      chrome.runtime.sendMessage(
        { type: 'GET_VERIFIED_CONTENT', identifier: currentIdentifier },
        (response) => {
          // Check lastError inside callback before it gets cleared
          if (chrome.runtime.lastError) {
            reject(
              new Error(
                chrome.runtime.lastError.message ||
                  'Failed to get content metadata',
              ),
            );
            return;
          }
          resolve(response);
        },
      );
    });

    if (!metadata?.success) {
      throw new Error(metadata?.error || 'Content metadata not available');
    }

    const resourcePaths = metadata.resourcePaths || [];
    console.log('[Verified] Got metadata:', {
      htmlLength: metadata.html?.length || 0,
      resourceCount: resourcePaths.length,
    });

    // Step 2: Fetch each resource individually (with chunking for large files)
    loadingSubtitle.textContent = `Loading ${resourcePaths.length} resources...`;

    const resources: Array<{
      path: string;
      data: ArrayBuffer;
      contentType: string;
    }> = [];

    for (let i = 0; i < resourcePaths.length; i++) {
      const { path, contentType } = resourcePaths[i];

      // Update progress
      loadingSubtitle.textContent = `Loading resource ${i + 1}/${resourcePaths.length}...`;

      try {
        // Fetch first chunk to get metadata
        const firstChunk = await new Promise<{
          success: boolean;
          error?: string;
          data?: number[];
          contentType?: string;
          totalChunks?: number;
          chunkIndex?: number;
          totalSize?: number;
        } | null>((resolve) => {
          chrome.runtime.sendMessage(
            {
              type: 'GET_VERIFIED_RESOURCE',
              identifier: currentIdentifier,
              path,
              chunkIndex: 0,
            },
            (response) => {
              // Check lastError inside callback before it gets cleared
              if (chrome.runtime.lastError) {
                console.warn(
                  `[Verified] Failed to load resource ${path}:`,
                  chrome.runtime.lastError.message,
                );
                resolve(null);
                return;
              }
              resolve(response);
            },
          );
        });

        if (!firstChunk?.success || !firstChunk.data) {
          if (firstChunk) {
            console.warn(
              `[Verified] Resource not available: ${path}`,
              firstChunk.error,
            );
          }
          continue;
        }

        // If single chunk, use it directly
        if (!firstChunk.totalChunks || firstChunk.totalChunks === 1) {
          resources.push({
            path,
            data: new Uint8Array(firstChunk.data).buffer,
            contentType: firstChunk.contentType || contentType,
          });
          continue;
        }

        // For multi-chunk resources, fetch all chunks and combine
        console.log(
          `[Verified] Large resource ${path}: ${firstChunk.totalChunks} chunks, ${firstChunk.totalSize} bytes`,
        );
        const chunks: number[][] = [firstChunk.data];

        for (let chunkIdx = 1; chunkIdx < firstChunk.totalChunks; chunkIdx++) {
          loadingSubtitle.textContent = `Loading resource ${i + 1}/${resourcePaths.length} (chunk ${chunkIdx + 1}/${firstChunk.totalChunks})...`;

          const nextChunk = await new Promise<{
            success: boolean;
            error?: string;
            data?: number[];
          } | null>((resolve) => {
            chrome.runtime.sendMessage(
              {
                type: 'GET_VERIFIED_RESOURCE',
                identifier: currentIdentifier,
                path,
                chunkIndex: chunkIdx,
              },
              (response) => {
                // Check lastError inside callback before it gets cleared
                if (chrome.runtime.lastError) {
                  console.warn(
                    `[Verified] Failed to load chunk ${chunkIdx} for ${path}:`,
                    chrome.runtime.lastError.message,
                  );
                  resolve(null);
                  return;
                }
                resolve(response);
              },
            );
          });

          if (!nextChunk?.success || !nextChunk.data) {
            console.warn(
              `[Verified] Failed to load chunk ${chunkIdx} for ${path}`,
            );
            break;
          }

          chunks.push(nextChunk.data);
        }

        // Combine all chunks
        const totalLength = chunks.reduce(
          (sum, chunk) => sum + chunk.length,
          0,
        );
        const combined = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
          combined.set(chunk, offset);
          offset += chunk.length;
        }

        resources.push({
          path,
          data: combined.buffer,
          contentType: firstChunk.contentType || contentType,
        });
      } catch (error) {
        console.warn(`[Verified] Error loading resource ${path}:`, error);
        continue;
      }
    }

    console.log('[Verified] Sending content to sandbox:', {
      htmlLength: metadata.html?.length || 0,
      resourceCount: resources.length,
    });

    // Step 3: Send content to sandbox
    contentFrame.contentWindow?.postMessage(
      {
        type: 'RENDER_CONTENT',
        html: metadata.html,
        identifier: currentIdentifier,
        resources,
      },
      '*',
    );

    // Update UI
    hideLoading();
    showContent();
    updateBadge(event.error ? 'partial' : 'verified');
  } catch (error) {
    console.error('[Verified] Failed to load content:', error);
    const errorMsg = error instanceof Error ? error.message : String(error);
    showError('Content Error', errorMsg);
  }
}

/**
 * Set the current phase (1-3).
 */
function setPhase(phase: number): void {
  phase1.classList.toggle('active', phase === 1);
  phase1.classList.toggle('complete', phase > 1);
  phase2.classList.toggle('active', phase === 2);
  phase2.classList.toggle('complete', phase > 2);
  phase3.classList.toggle('active', phase === 3);
  phase3.classList.toggle('complete', phase > 3);
}

/**
 * Update progress bar.
 */
function updateProgress(current: number, total: number): void {
  const percent = total > 0 ? Math.round((current / total) * 100) : 0;
  progressFill.style.width = `${percent}%`;
  progressLabel.textContent = `Verified ${current} of ${total} resources`;
  progressPercent.textContent = `${percent}%`;
}

/**
 * Add an item to the activity log.
 */
function addActivityItem(path: string, success: boolean): void {
  const item = document.createElement('div');
  item.className = 'activity-item';

  const icon = success ? '✓' : '✗';
  const iconClass = success ? 'check' : 'error';

  // Truncate long paths
  const displayPath = path.length > 50 ? '...' + path.slice(-47) : path;

  item.innerHTML = `<span class="${iconClass}">${icon}</span> ${displayPath}`;
  activityLog.appendChild(item);

  // Keep only last 20 items
  while (activityLog.children.length > 20) {
    activityLog.removeChild(activityLog.firstChild!);
  }

  // Scroll to bottom
  activityLog.scrollTop = activityLog.scrollHeight;
}

/**
 * Show loading screen.
 */
function showLoading(identifier: string): void {
  loadingScreen.classList.remove('hidden');
  emptyState.classList.add('hidden');
  errorState.classList.add('hidden');
  contentFrame.classList.add('hidden');

  loadingTitle.textContent = `Verifying: ${identifier}`;
  loadingSubtitle.textContent = 'Establishing secure connection...';
  activityLog.innerHTML = '';
  progressContainer.style.display = 'none';
  progressFill.style.width = '0%';
  gatewayHost.textContent = '--';

  setPhase(1);
  updateBadge('verifying');
}

/**
 * Hide loading screen.
 */
function hideLoading(): void {
  loadingScreen.classList.add('hidden');
}

/**
 * Show content iframe.
 */
function showContent(): void {
  emptyState.classList.add('hidden');
  errorState.classList.add('hidden');
  contentFrame.classList.remove('hidden');
}

/**
 * Show error state.
 */
function showError(title: string, message: string): void {
  hideLoading();
  emptyState.classList.add('hidden');
  contentFrame.classList.add('hidden');
  errorState.classList.remove('hidden');

  errorTitle.textContent = title;
  errorMessage.textContent = message;
}

/**
 * Update the verification badge.
 */
function updateBadge(
  status: 'verifying' | 'verified' | 'partial' | 'failed',
): void {
  verificationBadge.classList.remove(
    'verifying',
    'verified',
    'partial',
    'failed',
  );
  verificationBadge.classList.add(status);

  switch (status) {
    case 'verifying':
      badgeText.textContent = 'Verifying...';
      break;
    case 'verified':
      badgeText.textContent = 'Verified';
      break;
    case 'partial':
      badgeText.textContent = 'Partial';
      break;
    case 'failed':
      badgeText.textContent = 'Failed';
      break;
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
