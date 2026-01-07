/**
 * WayFinder Extension - Verification Fetch Handler
 * Copyright (C) 2022-2025 Permanent Data Solutions, Inc.
 *
 * Licensed under the Apache License, Version 2.0
 *
 * Fetch handler for the background service worker.
 * Intercepts /ar-proxy/ requests from extension pages and serves verified content.
 *
 * This module is imported by background.ts to add fetch interception to the
 * extension's background service worker (declared in manifest.json).
 *
 * Chrome Extension MV3 service workers CAN intercept fetch events from:
 * - Extension pages (popup.html, options.html, verified.html, etc.)
 * - Requests to extension resources (chrome-extension://...)
 *
 * They CANNOT intercept:
 * - Content script requests (those run in web page context)
 * - Regular web page requests
 */

import { logger } from './logger';
import {
  getVerifiedContent,
  setVerificationConcurrency,
  verifyIdentifier,
} from './manifest-verifier';
import type { SwWayfinderConfig } from './types';
import {
  broadcastEvent,
  clearManifestState,
  getActiveIdentifier,
  getActiveTxIdForPath,
  getManifestState,
  isVerificationComplete,
  isVerificationInProgress,
  setActiveIdentifier,
} from './verification-state';
import { verifiedCache } from './verified-cache';
import {
  getConfig,
  initializeWayfinder,
  isWayfinderReady,
  waitForInitialization,
} from './wayfinder-instance';

const TAG = 'FetchHandler';

// Track pending verification promises to avoid duplicate work
const pendingVerifications = new Map<string, Promise<void>>();

/**
 * Initialize the fetch handler by registering the fetch event listener.
 * Call this at the top level of background.ts.
 */
export function initializeFetchHandler(): void {
  logger.info(TAG, 'Initializing fetch handler for verification');

  // Register fetch event listener at top level (required for MV3 service workers)
  self.addEventListener('fetch', handleFetchEvent);

  logger.info(TAG, 'Fetch handler registered');
}

/**
 * Handle fetch events from extension pages.
 */
function handleFetchEvent(event: FetchEvent): void {
  const url = new URL(event.request.url);

  // Verify this is a request to our extension origin
  const extensionOrigin = `chrome-extension://${chrome.runtime.id}`;
  if (!event.request.url.startsWith(extensionOrigin)) {
    return;
  }

  // Primary: Intercept /ar-proxy/ requests
  if (url.pathname.startsWith('/ar-proxy/')) {
    logger.debug(TAG, `Intercepting ar-proxy: ${url.pathname}`);
    event.respondWith(handleArweaveProxy(event.request));
    return;
  }

  // Secondary: Intercept absolute path requests that match the active identifier's manifest
  // This handles the case where location patcher rewrote /ar-proxy/id/ to /
  // and the app is now requesting resources like /styles.css or /script.js
  // IMPORTANT: Never intercept navigation requests (those should go through ar-proxy)
  if (event.request.mode === 'navigate') {
    return;
  }

  const activeId = getActiveIdentifier();
  if (activeId && isVerificationComplete(activeId)) {
    // Remove leading slash for path lookup
    const path = url.pathname.startsWith('/')
      ? url.pathname.slice(1)
      : url.pathname;

    // Check if this path exists in the active manifest
    const txId = getActiveTxIdForPath(path);
    if (txId) {
      logger.debug(
        TAG,
        `Intercepting absolute path: ${url.pathname} → ${activeId}`,
      );
      event.respondWith(serveFromCache(activeId, path));
      return;
    } else {
      logger.debug(
        TAG,
        `Absolute path not in manifest: ${path} (activeId: ${activeId})`,
      );
    }
  } else if (activeId) {
    logger.debug(
      TAG,
      `Absolute path skipped - verification not complete: ${url.pathname}`,
    );
  }

  // Pass through all other requests (extension resources, etc.)
}

/**
 * Handle /ar-proxy/{identifier}/{path} requests.
 */
async function handleArweaveProxy(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const { identifier, resourcePath } = parseProxyPath(url.pathname);

  if (!identifier) {
    return new Response('Missing identifier in path', { status: 400 });
  }

  // Wait for Wayfinder to be initialized
  if (!isWayfinderReady()) {
    logger.debug(TAG, 'Waiting for Wayfinder initialization...');
    const initialized = await waitForInitialization(10000);

    if (!initialized) {
      logger.warn(TAG, 'Wayfinder initialization timeout');
      return createErrorResponse(
        'Verification Not Ready',
        'The verification service is still initializing. Please reload the page or try again.',
        identifier,
      );
    }
    logger.debug(TAG, 'Wayfinder initialization complete');
  }

  const config = getConfig();
  if (!config) {
    return createErrorResponse(
      'Configuration Error',
      'Verification configuration not available. Please reload the page.',
      identifier,
    );
  }

  try {
    const complete = isVerificationComplete(identifier);
    const inProgress = isVerificationInProgress(identifier);

    if (complete) {
      logger.debug(
        TAG,
        `Serving cached: ${identifier}/${resourcePath || 'index'}`,
      );
      setActiveIdentifier(identifier);
      return serveFromCache(identifier, resourcePath);
    }

    if (inProgress) {
      logger.debug(TAG, `Waiting for verification: ${identifier}`);
      await waitForVerification(identifier);
      setActiveIdentifier(identifier);
      return serveFromCache(identifier, resourcePath);
    }

    // Start new verification
    logger.debug(TAG, `Starting verification: ${identifier}`);
    await startVerification(identifier, config);
    setActiveIdentifier(identifier);
    return serveFromCache(identifier, resourcePath);
  } catch (error) {
    logger.error(TAG, 'Verification error:', error);
    const errorMsg = error instanceof Error ? error.message : String(error);

    broadcastEvent({
      type: 'verification-failed',
      identifier,
      error: errorMsg,
    });

    return createErrorResponse('Verification Failed', errorMsg, identifier);
  }
}

/**
 * Escape HTML special characters to prevent XSS.
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Create a styled HTML error response.
 */
function createErrorResponse(
  title: string,
  message: string,
  identifier: string,
): Response {
  const safeTitle = escapeHtml(title);
  const safeMessage = escapeHtml(message);
  const safeIdentifier = escapeHtml(identifier);

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${safeTitle}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0e0e0f;
      color: #cacad6;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .container {
      max-width: 480px;
      text-align: center;
    }
    .icon {
      font-size: 64px;
      margin-bottom: 24px;
    }
    h1 {
      font-size: 24px;
      font-weight: 600;
      color: #f23f5d;
      margin-bottom: 16px;
    }
    .message {
      font-size: 14px;
      color: #7f7f87;
      margin-bottom: 24px;
      word-break: break-word;
    }
    .identifier {
      font-family: monospace;
      font-size: 12px;
      background: #1c1c1f;
      padding: 8px 12px;
      border-radius: 6px;
      color: #a3a3ad;
      margin-bottom: 24px;
      word-break: break-all;
    }
    .hint {
      font-size: 12px;
      color: #7f7f87;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">🛡️</div>
    <h1>${safeTitle}</h1>
    <div class="message">${safeMessage || 'An unknown error occurred during verification.'}</div>
    <div class="identifier">${safeIdentifier}</div>
    <div class="hint">Try reloading the page or using a different gateway.</div>
  </div>
</body>
</html>`;

  return new Response(html, {
    status: 500,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

/**
 * Parse /ar-proxy/{identifier}/{path...} into components.
 * Decodes URL-encoded components.
 */
function parseProxyPath(pathname: string): {
  identifier: string;
  resourcePath: string;
} {
  const fullPath = pathname.slice('/ar-proxy/'.length);
  const firstSlash = fullPath.indexOf('/');

  if (firstSlash === -1) {
    return { identifier: decodeURIComponent(fullPath), resourcePath: '' };
  }

  const identifier = decodeURIComponent(fullPath.slice(0, firstSlash));
  const resourcePath = decodeURIComponent(fullPath.slice(firstSlash + 1));

  return { identifier, resourcePath };
}

/**
 * Start verification for an identifier.
 */
async function startVerification(
  identifier: string,
  config: SwWayfinderConfig,
): Promise<void> {
  let pending = pendingVerifications.get(identifier);
  if (pending) {
    logger.debug(TAG, `Joining existing verification: ${identifier}`);
    return pending;
  }

  pending = verifyIdentifier(identifier, config).finally(() => {
    pendingVerifications.delete(identifier);
  });

  pendingVerifications.set(identifier, pending);
  return pending;
}

/**
 * Handle START_VERIFICATION message.
 * Starts verification if not already in progress.
 */
async function handleStartVerification(identifier: string): Promise<void> {
  // Wait for Wayfinder to be initialized
  if (!isWayfinderReady()) {
    logger.debug(TAG, 'Waiting for Wayfinder initialization...');
    const initialized = await waitForInitialization(10000);
    if (!initialized) {
      throw new Error('Verification service not ready');
    }
  }

  const config = getConfig();
  if (!config) {
    throw new Error('Verification configuration not available');
  }

  const complete = isVerificationComplete(identifier);
  const inProgress = isVerificationInProgress(identifier);

  if (complete) {
    logger.debug(TAG, `Already verified: ${identifier}`);
    return;
  }

  if (inProgress) {
    logger.debug(TAG, `Waiting for verification: ${identifier}`);
    await waitForVerification(identifier);
    return;
  }

  logger.debug(TAG, `Starting verification: ${identifier}`);
  await startVerification(identifier, config);
}

/**
 * Get verified content metadata for sandbox rendering.
 * Returns HTML and list of resource paths (not the actual data to avoid message size limits).
 */
function getVerifiedContentForSandbox(identifier: string): {
  success: boolean;
  error?: string;
  html?: string;
  resourcePaths?: Array<{ path: string; contentType: string; size: number }>;
  indexPath?: string;
  totalResources?: number;
} {
  const state = getManifestState(identifier);

  if (!state) {
    return { success: false, error: 'No verification state found' };
  }

  logger.info(
    TAG,
    `getVerifiedContentForSandbox: status=${state.status}, verified=${state.verifiedResources}, failed=${state.failedResources.length}, total=${state.totalResources}`,
  );
  logger.info(TAG, `pathToTxId has ${state.pathToTxId.size} entries`);
  logger.info(TAG, `Cache stats:`, verifiedCache.getStats());

  if (state.status !== 'complete' && state.status !== 'partial') {
    return { success: false, error: `Verification status: ${state.status}` };
  }

  // Get the index HTML
  const indexTxId = state.pathToTxId.get(state.indexPath);
  if (!indexTxId) {
    return { success: false, error: 'Index file not found in manifest' };
  }

  const indexResource = verifiedCache.get(indexTxId);
  if (!indexResource) {
    return { success: false, error: 'Index file not in cache' };
  }

  // Decode HTML
  const html = new TextDecoder().decode(indexResource.data);

  // Get resource metadata (not actual data to avoid message size limits)
  const resourcePaths: Array<{
    path: string;
    contentType: string;
    size: number;
  }> = [];

  for (const [path, txId] of state.pathToTxId.entries()) {
    if (path === '__fallback__' || path === state.indexPath) continue;

    const resource = verifiedCache.get(txId);
    if (resource) {
      resourcePaths.push({
        path,
        contentType: resource.contentType,
        size: resource.data.byteLength,
      });
    }
  }

  // Log discrepancy between manifest and cache
  const manifestPathCount = state.pathToTxId.size;
  const cachedCount = resourcePaths.length + 1; // +1 for index
  if (cachedCount < manifestPathCount) {
    logger.warn(
      TAG,
      `Cache miss: ${manifestPathCount} in manifest, ${cachedCount} in cache`,
    );
    // Log which paths are missing
    for (const [path, txId] of state.pathToTxId.entries()) {
      if (path === '__fallback__') continue;
      const resource = verifiedCache.get(txId);
      if (!resource) {
        logger.warn(
          TAG,
          `Missing from cache: ${path} (${txId.slice(0, 8)}...)`,
        );
      }
    }
  }

  logger.debug(
    TAG,
    `Returning metadata for ${resourcePaths.length} resources (manifest has ${manifestPathCount})`,
  );

  return {
    success: true,
    html,
    resourcePaths,
    indexPath: state.indexPath,
    totalResources: resourcePaths.length,
  };
}

/**
 * Get a single verified resource by path.
 * Used for chunked loading to avoid message size limits.
 */
// Maximum size for a single message chunk (16MB should be safe)
const MAX_CHUNK_SIZE = 16 * 1024 * 1024;

function getVerifiedResource(
  identifier: string,
  path: string,
  chunkIndex: number = 0,
): {
  success: boolean;
  error?: string;
  data?: number[];
  contentType?: string;
  totalChunks?: number;
  chunkIndex?: number;
  totalSize?: number;
} {
  const state = getManifestState(identifier);

  if (!state) {
    return { success: false, error: 'No verification state found' };
  }

  const txId = state.pathToTxId.get(path);
  if (!txId) {
    return { success: false, error: `Resource not found: ${path}` };
  }

  const resource = verifiedCache.get(txId);
  if (!resource) {
    return { success: false, error: `Resource not in cache: ${path}` };
  }

  const fullData = new Uint8Array(resource.data);
  const totalSize = fullData.length;
  const totalChunks = Math.ceil(totalSize / MAX_CHUNK_SIZE);

  // If the resource is small enough, send it all at once
  if (totalSize <= MAX_CHUNK_SIZE) {
    return {
      success: true,
      data: Array.from(fullData),
      contentType: resource.contentType,
      totalChunks: 1,
      chunkIndex: 0,
      totalSize,
    };
  }

  // For large resources, send the requested chunk
  const start = chunkIndex * MAX_CHUNK_SIZE;
  const end = Math.min(start + MAX_CHUNK_SIZE, totalSize);

  if (start >= totalSize) {
    return { success: false, error: `Invalid chunk index: ${chunkIndex}` };
  }

  const chunkData = fullData.slice(start, end);

  logger.debug(
    TAG,
    `Sending chunk ${chunkIndex + 1}/${totalChunks} for ${path} (${chunkData.length} bytes)`,
  );

  return {
    success: true,
    data: Array.from(chunkData),
    contentType: resource.contentType,
    totalChunks,
    chunkIndex,
    totalSize,
  };
}

/**
 * Wait for an in-progress verification to complete.
 */
async function waitForVerification(identifier: string): Promise<void> {
  const pending = pendingVerifications.get(identifier);
  if (pending) {
    await pending;
    return;
  }

  // Poll for completion
  const maxWait = 60000;
  const pollInterval = 100;
  let waited = 0;

  while (waited < maxWait) {
    if (isVerificationComplete(identifier)) {
      return;
    }
    if (!isVerificationInProgress(identifier)) {
      throw new Error('Verification stopped unexpectedly');
    }
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
    waited += pollInterval;
  }

  throw new Error('Verification timeout');
}

/**
 * Serve a resource from the verified cache.
 */
function serveFromCache(identifier: string, resourcePath: string): Response {
  const state = getManifestState(identifier);

  if (!state) {
    logger.error(TAG, `No state for: ${identifier}`);
    return createErrorResponse(
      'Not Found',
      'No verification state found for this content.',
      identifier,
    );
  }

  if (state.status === 'failed') {
    return createErrorResponse(
      'Verification Failed',
      state.error || 'All resources failed verification.',
      identifier,
    );
  }

  if (state.status !== 'complete' && state.status !== 'partial') {
    return createErrorResponse(
      'Verification In Progress',
      'Please wait while content is being verified.',
      identifier,
    );
  }

  const response = getVerifiedContent(identifier, resourcePath);

  if (!response) {
    logger.warn(TAG, `Resource not found: ${identifier}/${resourcePath}`);
    const availablePaths = state?.pathToTxId
      ? Array.from(state.pathToTxId.keys()).slice(0, 10)
      : [];
    const pathsHint =
      availablePaths.length > 0
        ? `Available paths: ${availablePaths.join(', ')}${availablePaths.length >= 10 ? '...' : ''}`
        : 'No paths available in manifest.';
    return createErrorResponse(
      'Resource Not Found',
      `The path "${resourcePath}" was not found in the manifest. ${pathsHint}`,
      identifier,
    );
  }

  return response;
}

// ============================================================================
// Message Handlers (called from verified.ts via chrome.runtime.sendMessage)
// ============================================================================

/**
 * Check if we already have verified content ready for an identifier.
 * Returns true if verification is complete AND the index file is still in cache.
 * This handles the edge case where verification completed but resources were
 * evicted from the LRU cache due to memory pressure.
 */
function isContentReady(identifier: string): boolean {
  if (!isVerificationComplete(identifier)) {
    return false;
  }

  // Also verify the index file is still in cache
  const state = getManifestState(identifier);
  if (!state?.pathToTxId) {
    return false;
  }

  const indexTxId = state.pathToTxId.get(state.indexPath);
  if (!indexTxId) {
    return false;
  }

  // Check if index is still in cache (could have been evicted by LRU)
  return verifiedCache.has(indexTxId);
}

/**
 * Handle messages from the verified.html page.
 * These are Chrome runtime messages, not service worker postMessage.
 */
export function handleVerificationMessage(
  message: { type: string; [key: string]: any },
  _sender: chrome.runtime.MessageSender,
  sendResponse: (response: any) => void,
): boolean {
  // Quick check if content is already verified and cached
  if (message.type === 'CHECK_VERIFICATION_STATUS') {
    const identifier = message.identifier;
    if (!identifier) {
      sendResponse({ ready: false, error: 'Missing identifier' });
      return false;
    }
    const ready = isContentReady(identifier);
    sendResponse({ ready, status: ready ? 'complete' : 'not_verified' });
    return false;
  }

  if (message.type === 'INIT_VERIFICATION') {
    const config: SwWayfinderConfig = message.config;
    initializeWayfinder(config);
    if (config.concurrency) {
      setVerificationConcurrency(config.concurrency);
    }
    logger.info(TAG, 'Wayfinder initialized via message');
    sendResponse({ success: true });
    return false; // Synchronous response
  }

  if (message.type === 'CLEAR_VERIFICATION_CACHE') {
    verifiedCache.clear();
    logger.debug(TAG, 'Cache cleared');
    sendResponse({ success: true });
    return false;
  }

  if (message.type === 'CLEAR_VERIFICATION_STATE') {
    const identifier = message.identifier;
    const clearCache = message.clearCache === true; // Only clear cache if explicitly requested

    if (identifier) {
      const state = getManifestState(identifier);
      if (clearCache && state?.pathToTxId) {
        // Only clear cache if explicitly requested (e.g., force refresh)
        const txIds = Array.from(state.pathToTxId.values());
        if (state.manifestTxId) {
          txIds.push(state.manifestTxId);
        }
        verifiedCache.clearForManifest(txIds);
        logger.debug(TAG, `Cleared cache for: ${identifier}`);
      }
      clearManifestState(identifier);
      pendingVerifications.delete(identifier);
      if (getActiveIdentifier() === identifier) {
        setActiveIdentifier(null);
      }
      logger.debug(TAG, `Cleared verification state for: ${identifier}`);
    }
    sendResponse({ success: true });
    return false;
  }

  // Start verification for an identifier
  if (message.type === 'START_VERIFICATION') {
    const identifier = message.identifier;
    if (!identifier) {
      sendResponse({ success: false, error: 'Missing identifier' });
      return false;
    }

    // Handle async verification
    handleStartVerification(identifier)
      .then(() => sendResponse({ success: true }))
      .catch((error) => {
        sendResponse({ success: false, error: error.message });
      });
    return true; // Async response
  }

  // Get verified content metadata for sandbox rendering
  if (message.type === 'GET_VERIFIED_CONTENT') {
    const identifier = message.identifier;
    if (!identifier) {
      sendResponse({ success: false, error: 'Missing identifier' });
      return false;
    }

    const result = getVerifiedContentForSandbox(identifier);
    sendResponse(result);
    return false;
  }

  // Get a single verified resource (for chunked loading)
  if (message.type === 'GET_VERIFIED_RESOURCE') {
    const { identifier, path, chunkIndex = 0 } = message;
    if (!identifier || !path) {
      sendResponse({ success: false, error: 'Missing identifier or path' });
      return false;
    }

    const result = getVerifiedResource(identifier, path, chunkIndex);
    sendResponse(result);
    return false;
  }

  // Not a verification message
  return false;
}
