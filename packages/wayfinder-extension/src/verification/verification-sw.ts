/// <reference lib="webworker" />

/**
 * WayFinder Extension - Verification Service Worker
 * Copyright (C) 2022-2025 Permanent Data Solutions, Inc.
 *
 * Licensed under the Apache License, Version 2.0
 *
 * Service Worker with manifest-first verification.
 *
 * Flow:
 * 1. Intercept /ar-proxy/{identifier}/ requests
 * 2. Resolve ArNS name to manifest txId (or use txId directly)
 * 3. Fetch and parse manifest
 * 4. Pre-verify ALL resources in manifest
 * 5. Cache verified content
 * 6. Serve from verified cache
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

const TAG = 'SW';

declare const self: ServiceWorkerGlobalScope;

// Track pending verification promises to avoid duplicate work
const pendingVerifications = new Map<string, Promise<void>>();

// ============================================================================
// Service Worker Lifecycle
// ============================================================================

self.addEventListener('install', () => {
  logger.debug(TAG, 'Installing...');
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  logger.debug(TAG, 'Activating...');
  event.waitUntil(self.clients.claim());
});

// ============================================================================
// Message Handler
// ============================================================================

self.addEventListener('message', (event) => {
  logger.debug(TAG, `Received message: ${event.data?.type}`);

  if (event.data.type === 'INIT_WAYFINDER') {
    const config: SwWayfinderConfig = event.data.config;
    initializeWayfinder(config);
    if (config.concurrency) {
      setVerificationConcurrency(config.concurrency);
    }
    event.ports[0]?.postMessage({ type: 'WAYFINDER_READY' });
  }

  if (event.data.type === 'CLEAR_CACHE') {
    verifiedCache.clear();
    logger.debug(TAG, 'Cache cleared');
    event.ports[0]?.postMessage({ type: 'CACHE_CLEARED' });
  }

  if (event.data.type === 'CLEAR_VERIFICATION') {
    const identifier = event.data.identifier;
    if (identifier) {
      const state = getManifestState(identifier);
      if (state?.pathToTxId) {
        const txIds = Array.from(state.pathToTxId.values());
        if (state.manifestTxId) {
          txIds.push(state.manifestTxId);
        }
        verifiedCache.clearForManifest(txIds);
      }
      clearManifestState(identifier);
      pendingVerifications.delete(identifier);
      if (getActiveIdentifier() === identifier) {
        setActiveIdentifier(null);
      }
      logger.debug(TAG, `Cleared verification for: ${identifier}`);
    }
    event.ports[0]?.postMessage({ type: 'VERIFICATION_CLEARED' });
  }
});

// ============================================================================
// Fetch Handler
// ============================================================================

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Primary: Intercept /ar-proxy/ requests
  if (url.pathname.startsWith('/ar-proxy/')) {
    logger.debug(TAG, `Proxy request: ${url.pathname}`);
    event.respondWith(handleArweaveProxy(event.request));
    return;
  }

  // Secondary: Intercept absolute path requests that match the active identifier's manifest
  // IMPORTANT: Never intercept navigation requests
  if (event.request.mode === 'navigate') {
    return;
  }

  const activeId = getActiveIdentifier();
  if (activeId && isVerificationComplete(activeId)) {
    const path = url.pathname.startsWith('/')
      ? url.pathname.slice(1)
      : url.pathname;
    const txId = getActiveTxIdForPath(path);

    if (txId) {
      logger.debug(
        TAG,
        `Absolute path intercept: ${url.pathname} → ${activeId}`,
      );
      event.respondWith(serveFromCache(activeId, path));
      return;
    }
  }

  // Pass through all other requests
  return;
});

// ============================================================================
// Main Proxy Handler
// ============================================================================

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

// ============================================================================
// Helper Functions
// ============================================================================

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
    // Decode the identifier in case it was URL-encoded
    return { identifier: decodeURIComponent(fullPath), resourcePath: '' };
  }

  const identifier = decodeURIComponent(fullPath.slice(0, firstSlash));
  // Resource paths may also need decoding for special characters
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
// Startup
// ============================================================================

logger.info(TAG, 'Verification service worker loaded');
