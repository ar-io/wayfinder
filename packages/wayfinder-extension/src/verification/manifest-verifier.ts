/**
 * WayFinder Extension - Manifest Verification
 * Copyright (C) 2022-2025 Permanent Data Solutions, Inc.
 *
 * Licensed under the Apache License, Version 2.0
 *
 * Manifest-first verification orchestrator.
 *
 * SECURITY MODEL:
 * - ArNS names are resolved via trusted gateways with consensus checking
 * - Manifest content is cryptographically verified BEFORE trusting path->txId mappings
 * - All resources are verified against trusted gateways before serving
 *
 * Flow:
 * 1. Resolve ArNS name to txId via trusted gateways (consensus required)
 * 2. Select a responsive routing gateway
 * 3. Fetch AND VERIFY manifest content (hash check)
 * 4. Parse manifest only AFTER verification passes
 * 5. Verify all resources in manifest
 * 6. Serve only verified content from cache
 */

import type { VerificationStrategy } from '@ar.io/wayfinder-core';
import { swGatewayHealth } from './gateway-health';
import { injectLocationPatch } from './location-patcher';
import { logger } from './logger';
import type {
  ArweaveManifest,
  ManifestCheckResult,
  SwWayfinderConfig,
} from './types';
import {
  broadcastEvent,
  completeVerification,
  failVerification,
  getManifestState,
  recordResourceFailed,
  recordResourceVerified,
  setManifestLoaded,
  setResolvedTxId,
  startManifestVerification,
} from './verification-state';
import { verifiedCache } from './verified-cache';
import {
  getVerificationStrategy,
  isWayfinderReady,
  setSelectedGateway,
} from './wayfinder-instance';

const TAG = 'Verifier';

// Default concurrency limit for parallel verification
const DEFAULT_CONCURRENCY = 10;

// Timeout for individual gateway requests (ArNS resolution, gateway selection)
const GATEWAY_TIMEOUT_MS = 10000; // 10 seconds

// Shorter timeout for resource fetches (most resources are small)
const RESOURCE_FETCH_TIMEOUT_MS = 5000; // 5 seconds

// Current concurrency setting (can be updated via config)
let maxConcurrentVerifications = DEFAULT_CONCURRENCY;

/**
 * Set the concurrency limit for parallel resource verification.
 */
export function setVerificationConcurrency(concurrency: number): void {
  maxConcurrentVerifications = Math.max(1, Math.min(20, concurrency));
  logger.debug(TAG, `Concurrency: ${maxConcurrentVerifications}`);
}

// Detect if identifier is a 43-char Arweave transaction ID
const TX_ID_REGEX = /^[A-Za-z0-9_-]{43}$/;

function isTxId(identifier: string): boolean {
  return TX_ID_REGEX.test(identifier);
}

/**
 * Resolve an ArNS name to a transaction ID using trusted gateways.
 * Queries multiple trusted gateways and requires consensus to prevent
 * a malicious gateway from redirecting to different content.
 *
 * Uses subdomain format: {arnsName}.{gateway-host} (e.g., vilenarios.ar-io.dev)
 */
export async function resolveArnsToTxId(
  arnsName: string,
  trustedGateways: string[],
): Promise<{ txId: string; gateway: string }> {
  if (trustedGateways.length === 0) {
    throw new Error('No trusted gateways available for ArNS resolution');
  }

  logger.debug(
    TAG,
    `Resolving ArNS "${arnsName}" via ${trustedGateways.length} gateways`,
  );

  const results = await Promise.allSettled(
    trustedGateways.map(async (gateway) => {
      const gatewayUrl = new URL(gateway);
      const arnsUrl = `https://${arnsName}.${gatewayUrl.host}`;

      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        GATEWAY_TIMEOUT_MS,
      );

      try {
        const response = await fetch(arnsUrl, {
          method: 'HEAD',
          headers: { Accept: '*/*' },
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const txId = response.headers.get('x-arns-resolved-id');
        if (!txId) {
          throw new Error('No x-arns-resolved-id header');
        }

        return { txId, gateway: gateway.replace(/\/$/, '') };
      } catch (error) {
        clearTimeout(timeoutId);
        throw error;
      }
    }),
  );

  const successful = results
    .map((r, i) => ({ result: r, gateway: trustedGateways[i] }))
    .filter(
      (
        r,
      ): r is {
        result: PromiseFulfilledResult<{ txId: string; gateway: string }>;
        gateway: string;
      } => r.result.status === 'fulfilled',
    )
    .map((r) => r.result.value);

  if (successful.length === 0) {
    const errors = results
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .map((r) => r.reason?.message || 'Unknown error');
    throw new Error(
      `All gateways failed to resolve ArNS "${arnsName}": ${errors.join(', ')}`,
    );
  }

  const txIds = successful.map((r) => r.txId);
  const uniqueTxIds = [...new Set(txIds)];

  if (uniqueTxIds.length > 1) {
    logger.error(
      TAG,
      `ArNS mismatch for "${arnsName}":`,
      successful.map(
        (s) => `${new URL(s.gateway).hostname}=${s.txId.slice(0, 8)}`,
      ),
    );
    throw new Error(
      `ArNS resolution mismatch for "${arnsName}" - security issue`,
    );
  }

  const resolvedTxId = uniqueTxIds[0];
  const usedGateway = successful[0].gateway;

  logger.debug(TAG, `ArNS "${arnsName}" → ${resolvedTxId.slice(0, 8)}...`);

  return { txId: resolvedTxId, gateway: usedGateway };
}

/**
 * Find a working gateway by trying each one until one responds.
 */
async function selectWorkingGateway(
  txId: string,
  gateways: string[],
): Promise<string> {
  if (gateways.length === 0) {
    throw new Error('No gateways available');
  }

  // Filter out known unhealthy gateways first
  let candidates = swGatewayHealth.filterHealthy(gateways);

  // If all are marked unhealthy, clear cache and use all gateways
  if (candidates.length === 0) {
    logger.debug(TAG, 'All gateways marked unhealthy, clearing cache');
    swGatewayHealth.clear();
    candidates = gateways;
  }

  let lastError: Error | null = null;

  for (const gateway of candidates) {
    const gatewayBase = gateway.replace(/\/+$/, '');
    const rawUrl = `${gatewayBase}/raw/${txId}`;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        GATEWAY_TIMEOUT_MS,
      );

      const response = await fetch(rawUrl, {
        method: 'HEAD',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      logger.debug(TAG, `Selected gateway: ${new URL(gatewayBase).hostname}`);
      return gatewayBase;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      const isTimeout = error instanceof Error && error.name === 'AbortError';
      logger.debug(
        TAG,
        `Gateway ${isTimeout ? 'timeout' : 'failed'}: ${new URL(gatewayBase).hostname} - ${errMsg}`,
      );

      // Mark this gateway as unhealthy
      swGatewayHealth.markUnhealthy(gatewayBase, undefined, errMsg);

      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw new Error(`All gateways failed. Last error: ${lastError?.message}`);
}

/**
 * Convert an ArrayBuffer to a ReadableStream for SDK compatibility.
 */
function arrayBufferToStream(data: ArrayBuffer): ReadableStream<Uint8Array> {
  const uint8Array = new Uint8Array(data);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(uint8Array);
      controller.close();
    },
  });
}

/**
 * Compute SHA-256 hash of data and return as base64url string.
 */
async function computeHash(data: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = new Uint8Array(hashBuffer);
  let binary = '';
  for (let i = 0; i < hashArray.length; i++) {
    binary += String.fromCharCode(hashArray[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Fetch the trusted hash for a txId from trusted gateways using /raw/ endpoint.
 */
async function fetchTrustedHashForManifest(
  txId: string,
  trustedGateways: URL[],
): Promise<string> {
  const errors: string[] = [];

  for (const gateway of trustedGateways) {
    const gatewayBase = gateway.toString().replace(/\/+$/, '');

    try {
      const rawUrl = `${gatewayBase}/raw/${txId}`;

      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        GATEWAY_TIMEOUT_MS,
      );

      // Try HEAD request first to get hash from header
      const headResponse = await fetch(rawUrl, {
        method: 'HEAD',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!headResponse.ok) {
        throw new Error(`HTTP ${headResponse.status}`);
      }

      // Check for hash header
      const hashHeader =
        headResponse.headers.get('x-ar-io-digest') ||
        headResponse.headers.get('x-ar-io-data-hash') ||
        headResponse.headers.get('x-arweave-data-hash');

      if (hashHeader) {
        logger.debug(
          TAG,
          `Got trusted hash from ${gateway.hostname}: ${hashHeader.slice(0, 12)}...`,
        );
        return hashHeader;
      }

      // No header - need to fetch and compute hash
      const controller2 = new AbortController();
      const timeoutId2 = setTimeout(
        () => controller2.abort(),
        GATEWAY_TIMEOUT_MS,
      );

      const fullResponse = await fetch(rawUrl, {
        signal: controller2.signal,
      });

      clearTimeout(timeoutId2);

      if (!fullResponse.ok) {
        throw new Error(`HTTP ${fullResponse.status}`);
      }

      const data = await fullResponse.arrayBuffer();
      const hash = await computeHash(data);
      logger.debug(
        TAG,
        `Computed trusted hash from ${gateway.hostname}: ${hash.slice(0, 12)}...`,
      );
      return hash;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      errors.push(`${gateway.hostname}: ${errMsg}`);
      logger.debug(
        TAG,
        `Trusted gateway ${gateway.hostname} failed: ${errMsg}`,
      );
    }
  }

  throw new Error(
    `All trusted gateways failed to provide hash: ${errors.join(', ')}`,
  );
}

/**
 * Verify MANIFEST content using hash verification.
 */
async function verifyManifestData(
  txId: string,
  data: ArrayBuffer,
  strategy: VerificationStrategy,
): Promise<void> {
  const computedHash = await computeHash(data);
  logger.debug(TAG, `Computed manifest hash: ${computedHash.slice(0, 12)}...`);

  const trustedHash = await fetchTrustedHashForManifest(
    txId,
    strategy.trustedGateways,
  );

  if (computedHash !== trustedHash) {
    throw new Error(
      `Manifest hash mismatch: computed=${computedHash.slice(0, 12)}..., trusted=${trustedHash.slice(0, 12)}...`,
    );
  }

  logger.debug(TAG, `Manifest verified: ${txId.slice(0, 8)}...`);
}

/**
 * Verify RESOURCE content using the SDK's verification strategy.
 */
async function verifyResourceWithSdk(
  txId: string,
  data: ArrayBuffer,
  strategy: VerificationStrategy,
): Promise<void> {
  const dataStream = arrayBufferToStream(data);

  await strategy.verifyData({
    data: dataStream,
    txId,
    headers: {},
  });

  logger.debug(TAG, `SDK verified resource: ${txId.slice(0, 8)}...`);
}

/**
 * Fetch and verify manifest/content from the selected routing gateway.
 */
async function fetchAndVerifyRawContent(
  txId: string,
  routingGateway: string,
): Promise<ManifestCheckResult> {
  const gatewayBase = routingGateway.replace(/\/+$/, '');
  const rawUrl = `${gatewayBase}/raw/${txId}`;

  logger.debug(
    TAG,
    `Fetching raw content: ${txId.slice(0, 8)}... from ${new URL(gatewayBase).hostname}`,
  );

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GATEWAY_TIMEOUT_MS);

  const response = await fetch(rawUrl, {
    signal: controller.signal,
  });

  clearTimeout(timeoutId);

  if (!response.ok) {
    throw new Error(`Failed to fetch raw content: HTTP ${response.status}`);
  }

  const contentType =
    response.headers.get('content-type') || 'application/octet-stream';
  const rawData = await response.arrayBuffer();
  const strategy = getVerificationStrategy();

  // Check if it's a manifest first
  let isManifest = false;
  let manifest: ArweaveManifest | undefined;

  if (contentType.includes('application/x.arweave-manifest+json')) {
    isManifest = true;
    const text = new TextDecoder().decode(rawData);
    manifest = JSON.parse(text) as ArweaveManifest;
  } else {
    // Try parsing as JSON manifest (some may not have correct content-type)
    try {
      const text = new TextDecoder().decode(rawData);
      const parsed = JSON.parse(text);
      if (parsed.manifest === 'arweave/paths' && parsed.paths) {
        isManifest = true;
        manifest = parsed as ArweaveManifest;
      }
    } catch {
      // Not JSON, not a manifest
    }
  }

  // Use appropriate verification method
  if (isManifest) {
    await verifyManifestData(txId, rawData, strategy);
  } else {
    await verifyResourceWithSdk(txId, rawData, strategy);
  }

  // Cache the verified content
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  verifiedCache.set(txId, { contentType, data: rawData, headers });

  if (isManifest) {
    return { isManifest: true, manifest: manifest!, rawData, contentType };
  }
  return { isManifest: false, rawData, contentType };
}

/**
 * Verify and cache a single resource by txId.
 *
 * NOTE: We use direct fetch() instead of wayfinder.request() because
 * wayfinder.request() has compatibility issues in Chrome extension
 * service worker context ("Illegal invocation" errors).
 */
async function verifyAndCacheResource(
  identifier: string,
  verificationId: number,
  txId: string,
  path: string,
  gateways: string[],
): Promise<void> {
  if (!isWayfinderReady()) {
    throw new Error('Wayfinder not ready');
  }

  if (verifiedCache.has(txId)) {
    recordResourceVerified(identifier, verificationId, txId, path);
    return;
  }

  const strategy = getVerificationStrategy();
  let lastError: Error | null = null;

  // Try up to 3 gateways to avoid long delays if resource is unavailable
  const maxGatewayAttempts = 3;
  const gatewaysToTry = gateways.slice(0, maxGatewayAttempts);

  // Try each gateway until one succeeds
  for (const gateway of gatewaysToTry) {
    const gatewayBase = gateway.replace(/\/+$/, '');

    try {
      const rawUrl = `${gatewayBase}/raw/${txId}`;

      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        RESOURCE_FETCH_TIMEOUT_MS,
      );

      const response = await fetch(rawUrl, {
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.arrayBuffer();
      const contentType =
        response.headers.get('content-type') || 'application/octet-stream';

      await verifyResourceWithSdk(txId, data, strategy);

      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });

      verifiedCache.set(txId, { contentType, data, headers });
      recordResourceVerified(identifier, verificationId, txId, path);
      return;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      logger.debug(
        TAG,
        `Gateway ${new URL(gatewayBase).hostname} failed for ${path}: ${lastError.message}`,
      );
    }
  }

  const errorMsg = lastError?.message || 'All gateways failed';
  logger.warn(TAG, `Failed: ${path} - ${errorMsg}`);
  recordResourceFailed(identifier, verificationId, txId, path, errorMsg);
  throw lastError || new Error(errorMsg);
}

/**
 * Verify all resources in a manifest with concurrency control.
 */
async function verifyAllResources(
  identifier: string,
  verificationId: number,
  manifest: ArweaveManifest,
  primaryGateway: string,
  allGateways: string[],
): Promise<boolean> {
  const entries = Object.entries(manifest.paths);

  if (manifest.fallback?.id) {
    entries.push(['__fallback__', { id: manifest.fallback.id }]);
  }

  if (entries.length === 0) {
    logger.info(TAG, 'Empty manifest');
    return true;
  }

  // Put primary gateway first, then the rest
  const primaryBase = primaryGateway.replace(/\/+$/, '');
  const orderedGateways = [
    primaryGateway,
    ...allGateways.filter((g) => g.replace(/\/+$/, '') !== primaryBase),
  ];

  logger.debug(
    TAG,
    `Verifying ${entries.length} resources via ${orderedGateways.length} gateways`,
  );

  const allResults: Promise<void>[] = [];
  const activePromises = new Set<Promise<void>>();

  for (const [path, entry] of entries) {
    while (activePromises.size >= maxConcurrentVerifications) {
      await Promise.race(activePromises);
    }

    const txId = typeof entry === 'string' ? entry : entry.id;

    const promise = verifyAndCacheResource(
      identifier,
      verificationId,
      txId,
      path,
      orderedGateways,
    ).catch(() => {
      /* Errors already logged */
    });

    activePromises.add(promise);
    promise.finally(() => activePromises.delete(promise));
    allResults.push(promise);
  }

  await Promise.allSettled(allResults);
  return false;
}

/**
 * Main entry point: verify an identifier (ArNS name or txId).
 */
export async function verifyIdentifier(
  identifier: string,
  config: SwWayfinderConfig,
): Promise<void> {
  const verificationId = startManifestVerification(identifier);

  try {
    let txId: string;

    if (isTxId(identifier)) {
      txId = identifier;
      setResolvedTxId(identifier, verificationId, txId);
    } else {
      const resolved = await resolveArnsToTxId(
        identifier,
        config.trustedGateways,
      );
      txId = resolved.txId;
      setResolvedTxId(identifier, verificationId, txId, resolved.gateway);
    }

    const routingGateways =
      config.routingGateways && config.routingGateways.length > 0
        ? config.routingGateways
        : config.trustedGateways;

    const hasPreferredGateway =
      config.routingStrategy === 'preferred' && config.preferredGateway;

    let workingGateway: string;
    let fallbackGateways: string[];

    if (hasPreferredGateway) {
      const preferredGateway = config
        .preferredGateway!.trim()
        .replace(/\/+$/, '');
      logger.debug(TAG, `Using preferred gateway: ${preferredGateway}`);

      try {
        workingGateway = await selectWorkingGateway(txId, [preferredGateway]);
      } catch {
        throw new Error(
          `Preferred gateway ${preferredGateway} is not responding. Try a different gateway.`,
        );
      }

      fallbackGateways = routingGateways.filter(
        (g) => g.replace(/\/+$/, '') !== preferredGateway,
      );
    } else {
      const shuffledGateways = [...routingGateways];
      for (let i = shuffledGateways.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffledGateways[i], shuffledGateways[j]] = [
          shuffledGateways[j],
          shuffledGateways[i],
        ];
      }

      workingGateway = await selectWorkingGateway(txId, shuffledGateways);
      fallbackGateways = shuffledGateways;
    }

    setSelectedGateway(workingGateway);

    const state = getManifestState(identifier);
    if (state) {
      state.routingGateway = workingGateway;
    }

    broadcastEvent({
      type: 'routing-gateway',
      identifier,
      manifestTxId: txId,
      gatewayUrl: workingGateway,
    });

    const { isManifest, manifest } = await fetchAndVerifyRawContent(
      txId,
      workingGateway,
    );

    if (!isManifest) {
      const singleFileManifest: ArweaveManifest = {
        manifest: 'arweave/paths',
        version: '0.2.0',
        index: { path: 'index' },
        paths: { index: { id: txId } },
      };

      setManifestLoaded(
        identifier,
        verificationId,
        singleFileManifest,
        true /* isSingleFile */,
      );
      // This will automatically trigger completeVerificationInternal
      // since totalResources=1 and verified+failed >= total after this call
      recordResourceVerified(identifier, verificationId, txId, 'index');
      return;
    }

    setManifestLoaded(identifier, verificationId, manifest!);
    const wasEmpty = await verifyAllResources(
      identifier,
      verificationId,
      manifest!,
      workingGateway,
      fallbackGateways,
    );

    if (wasEmpty) {
      completeVerification(identifier, verificationId);
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    failVerification(identifier, verificationId, errorMsg);
    throw error;
  } finally {
    setSelectedGateway(null);
  }
}

/**
 * Get verified content for a path.
 */
export function getVerifiedContent(
  identifier: string,
  path: string,
): Response | null {
  const state = getManifestState(identifier);
  if (!state || (state.status !== 'complete' && state.status !== 'partial')) {
    return null;
  }

  let normalizedPath = path.startsWith('/') ? path.slice(1) : path;
  if (normalizedPath === '') {
    normalizedPath = state.indexPath;
  } else if (normalizedPath.endsWith('/')) {
    normalizedPath = normalizedPath + state.indexPath;
  }

  const txId = state.pathToTxId.get(normalizedPath);

  if (!txId) {
    const fallbackId = state.pathToTxId.get('__fallback__');
    if (fallbackId) {
      const resource = verifiedCache.get(fallbackId);
      if (resource) {
        return verifiedCache.toResponse(resource);
      }
    }
    return null;
  }

  const resource = verifiedCache.get(txId);
  if (!resource) {
    logger.warn(TAG, `Cache miss: ${txId.slice(0, 8)}...`);
    return null;
  }

  const contentType = resource.contentType.toLowerCase();
  logger.debug(
    TAG,
    `Serving ${identifier}/${normalizedPath}: contentType=${contentType}, routingGateway=${state.routingGateway || 'none'}`,
  );

  // Inject location patch for HTML content
  if (state.routingGateway && contentType.includes('text/html')) {
    try {
      logger.debug(TAG, `Injecting location patch for ${identifier}`);
      const html = new TextDecoder().decode(resource.data);
      const patchedHtml = injectLocationPatch(
        html,
        identifier,
        state.routingGateway,
      );
      const patchedData = new TextEncoder().encode(patchedHtml);

      const headers = new Headers();
      Object.entries(resource.headers).forEach(([key, value]) => {
        headers.set(key, value);
      });
      if (!headers.has('content-type')) {
        headers.set('content-type', resource.contentType);
      }
      headers.set('x-wayfinder-verified', 'true');
      headers.set('x-wayfinder-verified-at', resource.verifiedAt.toString());
      headers.set('x-wayfinder-location-patched', 'true');
      // Set a permissive CSP for verified content so it can run inline scripts, eval, etc.
      // This overrides the extension's restrictive CSP for this response only.
      headers.set(
        'Content-Security-Policy',
        "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; " +
          "script-src * 'unsafe-inline' 'unsafe-eval' data: blob:; " +
          "style-src * 'unsafe-inline' data: blob:; " +
          'img-src * data: blob:; ' +
          'font-src * data: blob:; ' +
          'connect-src * data: blob:; ' +
          'frame-src * data: blob:;',
      );

      return new Response(patchedData, {
        status: 200,
        headers,
      });
    } catch (e) {
      logger.warn(TAG, `Failed to patch HTML: ${e}`);
    }
  }

  return verifiedCache.toResponse(resource);
}
