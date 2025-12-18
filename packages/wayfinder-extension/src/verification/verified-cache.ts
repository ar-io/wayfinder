/**
 * WayFinder Extension - Verified Resource Cache
 * Copyright (C) 2022-2025 Permanent Data Solutions, Inc.
 *
 * Licensed under the Apache License, Version 2.0
 *
 * Cache for verified Arweave resources.
 * Resources are cached after successful hash verification.
 * Cache is keyed by transaction ID for deduplication.
 * Includes LRU eviction when size limit is exceeded.
 */

import { logger } from './logger';
import type { VerifiedResource } from './types';

const TAG = 'Cache';

// Maximum cache size in bytes (500MB)
// Needs to be large enough to hold all resources for a manifest during verification
const MAX_CACHE_SIZE = 500 * 1024 * 1024;

class VerifiedCacheImpl {
  private cache = new Map<string, VerifiedResource>();
  private currentSize = 0;

  /**
   * Store a verified resource in cache.
   * Evicts LRU items if cache size limit is exceeded.
   */
  set(
    txId: string,
    resource: Omit<
      VerifiedResource,
      'txId' | 'verifiedAt' | 'lastAccessedAt' | 'size'
    >,
  ): void {
    const resourceSize = resource.data.byteLength;

    // If single resource is larger than cache, don't cache it
    if (resourceSize > MAX_CACHE_SIZE) {
      logger.warn(
        TAG,
        `Too large: ${txId.slice(0, 8)}... (${(resourceSize / 1024 / 1024).toFixed(1)}MB)`,
      );
      return;
    }

    // Evict LRU items if needed
    while (
      this.currentSize + resourceSize > MAX_CACHE_SIZE &&
      this.cache.size > 0
    ) {
      this.evictLRU();
    }

    // Remove existing entry if present (to update size correctly)
    if (this.cache.has(txId)) {
      const existing = this.cache.get(txId)!;
      this.currentSize -= existing.data.byteLength;
    }

    const now = Date.now();
    this.cache.set(txId, {
      txId,
      ...resource,
      size: resourceSize,
      verifiedAt: now,
      lastAccessedAt: now,
    });
    this.currentSize += resourceSize;

    logger.debug(
      TAG,
      `Stored: ${txId.slice(0, 8)}... (${(this.currentSize / 1024 / 1024).toFixed(1)}MB total)`,
    );
  }

  /**
   * Evict the least recently used item from cache.
   */
  private evictLRU(): void {
    let oldest: { txId: string; time: number } | null = null;

    for (const [txId, resource] of this.cache) {
      if (!oldest || resource.lastAccessedAt < oldest.time) {
        oldest = { txId, time: resource.lastAccessedAt };
      }
    }

    if (oldest) {
      const evicted = this.cache.get(oldest.txId)!;
      this.currentSize -= evicted.data.byteLength;
      this.cache.delete(oldest.txId);
      logger.debug(TAG, `Evicted LRU: ${oldest.txId.slice(0, 8)}...`);
    }
  }

  /**
   * Get a verified resource from cache.
   * Updates last accessed time for LRU tracking.
   */
  get(txId: string): VerifiedResource | null {
    const resource = this.cache.get(txId);
    if (resource) {
      // Update last accessed time for LRU
      resource.lastAccessedAt = Date.now();
    }
    return resource || null;
  }

  /**
   * Check if a resource is cached.
   */
  has(txId: string): boolean {
    return this.cache.has(txId);
  }

  /**
   * Get multiple resources by txId.
   */
  getMany(txIds: string[]): Map<string, VerifiedResource> {
    const results = new Map<string, VerifiedResource>();
    for (const txId of txIds) {
      const resource = this.cache.get(txId);
      if (resource) {
        results.set(txId, resource);
      }
    }
    return results;
  }

  /**
   * Create a Response from a cached resource.
   */
  toResponse(resource: VerifiedResource): Response {
    const headers = new Headers(resource.headers);
    // Ensure content-type is set
    if (!headers.has('content-type') && resource.contentType) {
      headers.set('content-type', resource.contentType);
    }
    // Add verification header
    headers.set('x-wayfinder-verified', 'true');
    headers.set('x-wayfinder-verified-at', resource.verifiedAt.toString());

    return new Response(resource.data, {
      status: 200,
      headers,
    });
  }

  /**
   * Get cache stats.
   */
  getStats(): { count: number; totalBytes: number } {
    let totalBytes = 0;
    for (const resource of this.cache.values()) {
      totalBytes += resource.data.byteLength;
    }
    return {
      count: this.cache.size,
      totalBytes,
    };
  }

  /**
   * Clear all cached resources.
   */
  clear(): void {
    const stats = this.getStats();
    this.cache.clear();
    this.currentSize = 0;
    logger.info(
      TAG,
      `Cleared ${stats.count} resources (${(stats.totalBytes / 1024 / 1024).toFixed(1)}MB)`,
    );
  }

  /**
   * Clear resources for a specific manifest/identifier.
   * Takes a list of txIds that belong to that manifest.
   */
  clearForManifest(txIds: string[]): void {
    let cleared = 0;
    let freedBytes = 0;
    for (const txId of txIds) {
      const resource = this.cache.get(txId);
      if (resource) {
        freedBytes += resource.data.byteLength;
        this.cache.delete(txId);
        cleared++;
      }
    }
    this.currentSize -= freedBytes;
    logger.debug(
      TAG,
      `Cleared ${cleared} manifest resources (${(freedBytes / 1024 / 1024).toFixed(1)}MB freed)`,
    );
  }
}

// Singleton instance
export const verifiedCache = new VerifiedCacheImpl();
