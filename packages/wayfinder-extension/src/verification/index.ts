/**
 * WayFinder Extension - Verification Module
 * Copyright (C) 2022-2025 Permanent Data Solutions, Inc.
 *
 * Licensed under the Apache License, Version 2.0
 *
 * Exports all verification utilities for use by the verification page and service worker.
 */

// Types
export type {
  ArweaveManifest,
  ManifestPath,
  ManifestVerificationState,
  ManifestCheckResult,
  VerificationEvent,
  SwWayfinderConfig,
  VerifiedResource,
  GatewayHealthEntry,
  HealthCheckResult,
} from './types';

// Logger
export { logger } from './logger';
export type { LogLevel } from './logger';

// Verified Cache
export { verifiedCache } from './verified-cache';

// Verification State
export {
  setActiveIdentifier,
  getActiveIdentifier,
  broadcastEvent,
  startManifestVerification,
  setResolvedTxId,
  setManifestLoaded,
  recordResourceVerified,
  recordResourceFailed,
  completeVerification,
  failVerification,
  getManifestState,
  isVerificationComplete,
  isVerificationInProgress,
  getTxIdForPath,
  getActiveTxIdForPath,
  clearManifestState,
  clearAllStates,
  cleanupOldStates,
} from './verification-state';

// Gateway Health
export {
  swGatewayHealth,
  checkSwGatewayHealth,
  selectHealthyGateway,
} from './gateway-health';

// Location Patcher
export { injectLocationPatch, isHtmlContent } from './location-patcher';

// Wayfinder Instance (for SW internal use)
export {
  initializeWayfinder,
  isWayfinderReady,
  getWayfinder,
  getConfig,
  getVerificationStrategy,
  setSelectedGateway,
  getSelectedGateway,
  waitForInitialization,
} from './wayfinder-instance';

// Manifest Verifier
export {
  verifyIdentifier,
  getVerifiedContent,
  resolveArnsToTxId,
  setVerificationConcurrency,
} from './manifest-verifier';

// Trusted Gateways
export {
  getTrustedGateways,
  getTopStakedGateways,
  getRoutingGateways,
  clearTrustedGatewayCache,
} from './trusted-gateways';
export type { GatewayWithStake } from './trusted-gateways';
