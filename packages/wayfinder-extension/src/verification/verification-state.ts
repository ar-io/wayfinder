/**
 * WayFinder Extension - Verification State Management
 * Copyright (C) 2022-2025 Permanent Data Solutions, Inc.
 *
 * Licensed under the Apache License, Version 2.0
 *
 * Manifest-aware verification state tracker.
 * Tracks the full lifecycle of manifest verification:
 * - Resolution (ArNS → txId)
 * - Manifest fetching and parsing
 * - Pre-verification of all resources
 * - Completion status
 */

import { logger } from './logger';
import type {
  ArweaveManifest,
  ManifestVerificationState,
  VerificationEvent,
} from './types';

const TAG = 'State';

// Active manifest verifications keyed by identifier (ArNS name or txId)
const manifestStates = new Map<string, ManifestVerificationState>();

// Currently active identifier (for intercepting absolute path requests)
// This tracks which identifier's content is currently being served in the iframe
let activeIdentifier: string | null = null;

// Counter for generating unique verification IDs
// Used to detect and ignore updates from stale/abandoned verifications
let verificationCounter = 0;

/**
 * Set the currently active identifier.
 * Used to intercept absolute path requests from the iframe.
 */
export function setActiveIdentifier(identifier: string | null): void {
  activeIdentifier = identifier;
  if (identifier) {
    logger.debug(TAG, `Active identifier: ${identifier}`);
  }
}

/**
 * Get the currently active identifier.
 */
export function getActiveIdentifier(): string | null {
  return activeIdentifier;
}

/**
 * Broadcast verification event to all extension pages.
 * Uses chrome.runtime.sendMessage which works in the extension context.
 */
export async function broadcastEvent(event: VerificationEvent): Promise<void> {
  try {
    // Use chrome.runtime.sendMessage to broadcast to all extension pages
    // This sends to all extension contexts (popup, options, verified page, etc.)
    chrome.runtime
      .sendMessage({
        type: 'VERIFICATION_EVENT',
        event,
      })
      .catch(() => {
        // Ignore errors - no listeners may be active
      });
  } catch {
    // Ignore errors if no listeners
  }
}

/**
 * Check if a verification ID is current (not stale from an abandoned verification).
 */
function isCurrentVerification(
  identifier: string,
  verificationId: number,
): boolean {
  const state = manifestStates.get(identifier);
  return (
    state !== null &&
    state !== undefined &&
    state.verificationId === verificationId
  );
}

/**
 * Start tracking a new manifest verification.
 * Returns the verification ID which must be passed to all subsequent state updates.
 */
export function startManifestVerification(identifier: string): number {
  const verificationId = ++verificationCounter;

  const state: ManifestVerificationState = {
    identifier,
    verificationId,
    manifestTxId: '',
    status: 'resolving',
    manifest: null,
    totalResources: 0,
    verifiedResources: 0,
    failedResources: [],
    pathToTxId: new Map(),
    indexPath: 'index.html',
    isSingleFile: false,
    startedAt: Date.now(),
  };

  manifestStates.set(identifier, state);

  broadcastEvent({
    type: 'verification-started',
    identifier,
  });

  logger.debug(TAG, `Started: ${identifier} (id=${verificationId})`);
  return verificationId;
}

/**
 * Update state after ArNS resolution.
 * @param verificationId - Must match the ID returned by startManifestVerification
 */
export function setResolvedTxId(
  identifier: string,
  verificationId: number,
  manifestTxId: string,
  gateway?: string,
): void {
  if (!isCurrentVerification(identifier, verificationId)) {
    logger.debug(TAG, `Ignoring stale setResolvedTxId for ${identifier}`);
    return;
  }
  const state = manifestStates.get(identifier)!;
  state.manifestTxId = manifestTxId;
  state.status = 'fetching-manifest';
  if (gateway) {
    state.routingGateway = gateway;
  }
  logger.debug(
    TAG,
    `Resolved "${identifier}" → ${manifestTxId.slice(0, 8)}...`,
  );
}

/**
 * Update state after manifest is parsed.
 * @param verificationId - Must match the ID returned by startManifestVerification
 * @param isSingleFile - True if this is a single file (not a real manifest)
 */
export function setManifestLoaded(
  identifier: string,
  verificationId: number,
  manifest: ArweaveManifest,
  isSingleFile: boolean = false,
): void {
  if (!isCurrentVerification(identifier, verificationId)) {
    logger.debug(TAG, `Ignoring stale setManifestLoaded for ${identifier}`);
    return;
  }
  const state = manifestStates.get(identifier)!;

  state.manifest = manifest;
  state.status = 'verifying';
  state.indexPath = manifest.index?.path || 'index.html';
  state.isSingleFile = isSingleFile;

  // Build path → txId mapping
  // Handle both formats: { id: string } and raw string txId
  state.pathToTxId.clear();
  for (const [path, entry] of Object.entries(manifest.paths)) {
    const txId = typeof entry === 'string' ? entry : entry.id;
    if (txId) {
      state.pathToTxId.set(path, txId);
    }
  }

  // Include fallback if present
  if (manifest.fallback?.id) {
    state.pathToTxId.set('__fallback__', manifest.fallback.id);
  }

  state.totalResources = state.pathToTxId.size;

  logger.debug(TAG, `Manifest: ${state.totalResources} resources`);
  logger.debug(TAG, `Paths:`, Array.from(state.pathToTxId.keys()));

  broadcastEvent({
    type: 'manifest-loaded',
    identifier,
    manifestTxId: state.manifestTxId,
    progress: { current: 0, total: state.totalResources },
    isSingleFile: state.isSingleFile,
  });
}

/**
 * Record successful verification of a resource.
 * @param verificationId - Must match the ID returned by startManifestVerification
 */
export function recordResourceVerified(
  identifier: string,
  verificationId: number,
  _txId: string,
  path: string,
): void {
  if (!isCurrentVerification(identifier, verificationId)) {
    logger.debug(
      TAG,
      `Ignoring stale recordResourceVerified for ${identifier}`,
    );
    return;
  }
  const state = manifestStates.get(identifier)!;

  state.verifiedResources++;

  logger.debug(
    TAG,
    `✓ ${path} (${state.verifiedResources}/${state.totalResources})`,
  );

  broadcastEvent({
    type: 'verification-progress',
    identifier,
    manifestTxId: state.manifestTxId,
    resourcePath: path,
    progress: { current: state.verifiedResources, total: state.totalResources },
  });

  // Check if all done
  if (
    state.verifiedResources + state.failedResources.length >=
    state.totalResources
  ) {
    completeVerificationInternal(identifier, verificationId);
  }
}

/**
 * Record failed verification of a resource.
 * @param verificationId - Must match the ID returned by startManifestVerification
 */
export function recordResourceFailed(
  identifier: string,
  verificationId: number,
  txId: string,
  path: string,
  error: string,
): void {
  if (!isCurrentVerification(identifier, verificationId)) {
    logger.debug(TAG, `Ignoring stale recordResourceFailed for ${identifier}`);
    return;
  }
  const state = manifestStates.get(identifier)!;

  state.failedResources.push(txId);

  logger.warn(TAG, `✗ ${path}: ${error}`);

  broadcastEvent({
    type: 'verification-failed',
    identifier,
    manifestTxId: state.manifestTxId,
    resourcePath: path,
    error,
    progress: { current: state.verifiedResources, total: state.totalResources },
  });

  // Check if all done (even with failures)
  if (
    state.verifiedResources + state.failedResources.length >=
    state.totalResources
  ) {
    completeVerificationInternal(identifier, verificationId);
  }
}

/**
 * Internal function to mark verification as complete.
 * Called automatically when all resources are processed.
 */
function completeVerificationInternal(
  identifier: string,
  verificationId: number,
): void {
  if (!isCurrentVerification(identifier, verificationId)) {
    logger.debug(TAG, `Ignoring stale completeVerification for ${identifier}`);
    return;
  }
  const state = manifestStates.get(identifier)!;

  // Determine final status:
  // - 'complete': all resources verified successfully
  // - 'partial': some verified, some failed (can still serve verified resources)
  // - 'failed': all resources failed (nothing to serve)
  if (state.failedResources.length === 0) {
    state.status = 'complete';
  } else if (state.verifiedResources > 0) {
    state.status = 'partial';
  } else {
    state.status = 'failed';
  }

  state.completedAt = Date.now();

  const elapsed = state.completedAt - state.startedAt;
  const statusMsg =
    state.status === 'complete'
      ? `All ${state.verifiedResources} verified`
      : state.status === 'partial'
        ? `${state.verifiedResources} verified, ${state.failedResources.length} failed`
        : `All ${state.failedResources.length} failed`;

  logger.info(TAG, `Complete: ${statusMsg} (${elapsed}ms)`);

  broadcastEvent({
    type: 'verification-complete',
    identifier,
    manifestTxId: state.manifestTxId,
    progress: { current: state.verifiedResources, total: state.totalResources },
    error:
      state.failedResources.length > 0
        ? `${state.failedResources.length} resources failed verification`
        : undefined,
  });
}

/**
 * Mark verification as complete.
 * Status is 'complete' if all succeeded, 'partial' if some failed but some succeeded.
 * @param verificationId - Must match the ID returned by startManifestVerification
 */
export function completeVerification(
  identifier: string,
  verificationId: number,
): void {
  completeVerificationInternal(identifier, verificationId);
}

/**
 * Mark verification as failed with error.
 * @param verificationId - Must match the ID returned by startManifestVerification
 */
export function failVerification(
  identifier: string,
  verificationId: number,
  error: string,
): void {
  if (!isCurrentVerification(identifier, verificationId)) {
    logger.debug(TAG, `Ignoring stale failVerification for ${identifier}`);
    return;
  }
  const state = manifestStates.get(identifier)!;
  state.status = 'failed';
  state.error = error;
  state.completedAt = Date.now();

  logger.error(TAG, `Failed: ${identifier} - ${error}`);

  broadcastEvent({
    type: 'verification-failed',
    identifier,
    error,
  });
}

/**
 * Get manifest verification state.
 */
export function getManifestState(
  identifier: string,
): ManifestVerificationState | null {
  return manifestStates.get(identifier) || null;
}

/**
 * Check if verification is complete for an identifier.
 * Returns true for 'complete' or 'partial' (some resources verified).
 */
export function isVerificationComplete(identifier: string): boolean {
  const state = manifestStates.get(identifier);
  return state?.status === 'complete' || state?.status === 'partial';
}

/**
 * Check if verification is in progress for an identifier.
 */
export function isVerificationInProgress(identifier: string): boolean {
  const state = manifestStates.get(identifier);
  return (
    state?.status === 'resolving' ||
    state?.status === 'fetching-manifest' ||
    state?.status === 'verifying'
  );
}

/**
 * Get the txId for a path within a verified manifest.
 */
export function getTxIdForPath(
  identifier: string,
  path: string,
): string | null {
  const state = manifestStates.get(identifier);
  if (!state?.pathToTxId) return null;

  // Normalize path
  let normalizedPath = path.startsWith('/') ? path.slice(1) : path;
  if (normalizedPath === '' || normalizedPath === '/') {
    // Root path - use index
    normalizedPath = state.indexPath;
  } else if (normalizedPath.endsWith('/')) {
    // Directory path - append index (e.g., "foo/" -> "foo/index.html")
    normalizedPath = normalizedPath + state.indexPath;
  }

  // Direct lookup
  if (state.pathToTxId.has(normalizedPath)) {
    return state.pathToTxId.get(normalizedPath)!;
  }

  // Fallback
  if (state.pathToTxId.has('__fallback__')) {
    return state.pathToTxId.get('__fallback__')!;
  }

  return null;
}

/**
 * Check if a path exists EXPLICITLY in the active identifier's manifest.
 * Returns the txId if found, null otherwise.
 *
 * NOTE: This does NOT use the fallback mechanism. For absolute path interception,
 * we only want to intercept paths that are explicitly in the manifest.
 * Using fallback would cause us to intercept requests for scripts/resources
 * that aren't part of the Arweave app (like external scripts, service workers, etc.)
 */
export function getActiveTxIdForPath(path: string): string | null {
  if (!activeIdentifier) return null;

  const state = manifestStates.get(activeIdentifier);
  if (!state?.pathToTxId) return null;

  // Never intercept absolute paths for single files - they have no sub-resources
  // Only real manifests with multiple paths need absolute path interception
  if (state.isSingleFile) {
    return null;
  }

  // Normalize path
  let normalizedPath = path.startsWith('/') ? path.slice(1) : path;
  if (normalizedPath === '' || normalizedPath === '/') {
    normalizedPath = state.indexPath;
  } else if (normalizedPath.endsWith('/')) {
    normalizedPath = normalizedPath + state.indexPath;
  }

  // Only return if path is explicitly in manifest (no fallback)
  if (state.pathToTxId.has(normalizedPath)) {
    return state.pathToTxId.get(normalizedPath)!;
  }

  return null;
}

/**
 * Clear state for an identifier.
 */
export function clearManifestState(identifier: string): void {
  manifestStates.delete(identifier);
}

/**
 * Clear all states.
 */
export function clearAllStates(): void {
  manifestStates.clear();
}

/**
 * Clean up old completed/failed manifest states to prevent memory leaks.
 * Keeps states for the specified duration (default 30 minutes).
 */
export function cleanupOldStates(maxAgeMs: number = 30 * 60 * 1000): number {
  const now = Date.now();
  let cleaned = 0;

  for (const [identifier, state] of manifestStates) {
    // Only clean up completed or failed states
    if (
      state.status === 'complete' ||
      state.status === 'partial' ||
      state.status === 'failed'
    ) {
      const age = now - (state.completedAt || state.startedAt);
      if (age > maxAgeMs) {
        manifestStates.delete(identifier);
        cleaned++;
      }
    }
  }

  if (cleaned > 0) {
    logger.debug(TAG, `Cleaned ${cleaned} old states`);
  }

  return cleaned;
}

// Run cleanup periodically (every 10 minutes)
setInterval(
  () => {
    cleanupOldStates();
  },
  10 * 60 * 1000,
);
