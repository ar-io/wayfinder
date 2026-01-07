/**
 * WayFinder Extension - Verification Types
 * Copyright (C) 2022-2025 Permanent Data Solutions, Inc.
 *
 * Licensed under the Apache License, Version 2.0
 */

export interface ArweaveManifest {
  manifest: 'arweave/paths';
  version: string;
  index?: { path: string };
  paths: Record<string, ManifestPath | string>; // Can be { id: string } or just the txId string
  fallback?: { id: string };
}

export interface ManifestPath {
  id: string;
}

/**
 * State of manifest verification for an identifier (ArNS name or txId)
 */
export interface ManifestVerificationState {
  identifier: string; // Original ArNS name or txId requested
  verificationId: number; // Unique ID to detect stale updates from abandoned verifications
  manifestTxId: string; // Resolved manifest transaction ID
  status:
    | 'resolving'
    | 'fetching-manifest'
    | 'verifying'
    | 'complete'
    | 'partial'
    | 'failed';
  manifest: ArweaveManifest | null;
  totalResources: number;
  verifiedResources: number;
  failedResources: string[]; // List of txIds that failed verification
  pathToTxId: Map<string, string>; // path → txId mapping for serving
  indexPath: string; // The index path from manifest (e.g., "index.html")
  isSingleFile: boolean; // True if this is a single file (not a manifest with multiple paths)
  routingGateway?: string; // Gateway used for fetching
  error?: string;
  startedAt: number;
  completedAt?: number;
}

/**
 * Result of checking if content is a manifest
 */
export interface ManifestCheckResult {
  isManifest: boolean;
  manifest?: ArweaveManifest;
  rawData?: ArrayBuffer;
  contentType?: string;
}

export interface VerificationEvent {
  type:
    | 'verification-started' // Started resolving/fetching manifest
    | 'manifest-loaded' // Manifest parsed, know total resources
    | 'verification-progress' // Resource verified, progress update
    | 'verification-complete' // All resources verified
    | 'verification-failed' // Verification failed
    | 'routing-gateway'; // Gateway info for display
  identifier: string; // ArNS name or txId being verified
  manifestTxId?: string; // Resolved manifest txId
  resourcePath?: string; // Current resource being verified
  progress?: {
    current: number;
    total: number;
  };
  error?: string;
  gatewayUrl?: string;
  isSingleFile?: boolean; // True if content is a single file (not a manifest)
}

/**
 * Service Worker Wayfinder configuration.
 */
export interface SwWayfinderConfig {
  /** Top-staked gateways used for hash verification */
  trustedGateways: string[];
  /** Broader pool of gateways used for content routing/fetching */
  routingGateways?: string[];
  routingStrategy: string;
  preferredGateway?: string;
  enabled: boolean;
  /** When true, blocks content if verification fails */
  strict: boolean;
  /** Number of parallel resource verifications (1-20, default 10) */
  concurrency?: number;
}

/**
 * Verified resource stored in cache
 */
export interface VerifiedResource {
  txId: string;
  contentType: string;
  data: ArrayBuffer;
  headers: Record<string, string>;
  verifiedAt: number;
  lastAccessedAt: number;
  size: number;
}

/**
 * Gateway health entry
 */
export interface GatewayHealthEntry {
  failedAt: number;
  expiresAt: number;
  error?: string;
}

/**
 * Health check result
 */
export interface HealthCheckResult {
  healthy: boolean;
  latencyMs?: number;
  error?: string;
}
