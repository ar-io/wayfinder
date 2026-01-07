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

/**
 * Result of a verification operation
 */
export interface VerificationResult {
  /** Transaction ID that was verified */
  txId: string;
  /** Whether verification succeeded */
  verified: boolean;
  /** Hash/digest of the content */
  hash?: string;
  /** Error if verification failed */
  error?: Error;
  /** Timestamp when verification was performed */
  timestamp: number;
  /** Verified content bytes (optional, for serving from cache) */
  content?: Uint8Array;
  /** Content type header from gateway */
  contentType?: string;
  /** All response headers from gateway */
  headers?: Record<string, string>;
}

/**
 * Cache entry with TTL tracking
 */
interface CacheEntry {
  result: VerificationResult;
  expiresAt: number;
}

/**
 * In-memory cache for manifest verification results
 *
 * Caches verification results to avoid re-verifying the same resources.
 * Each entry has a TTL (time-to-live) after which it expires.
 *
 * This significantly improves performance when:
 * - Verifying large manifests with many resources
 * - Re-visiting the same manifest multiple times
 * - Working with manifests that reference common resources
 */
export class ManifestVerificationCache {
  private cache: Map<string, CacheEntry>;
  private ttlMs: number;

  /**
   * Create a new verification cache
   *
   * @param options - Cache configuration
   */
  constructor({ ttlMs = 3600000 }: { ttlMs?: number } = {}) {
    this.cache = new Map();
    this.ttlMs = ttlMs; // Default: 1 hour
  }

  /**
   * Get a cache key for a transaction ID and optional hash
   *
   * @param txId - Transaction ID
   * @param hash - Optional content hash
   * @returns Cache key
   */
  private getCacheKey({ txId, hash }: { txId: string; hash?: string }): string {
    return hash ? `${txId}:${hash}` : txId;
  }

  /**
   * Store a verification result in the cache
   *
   * Can accept either individual parameters or a full VerificationResult object
   * @param options - Verification result details or full VerificationResult
   */
  set(
    options:
      | {
          txId: string;
          hash?: string;
          verified: boolean;
          error?: Error;
          content?: Uint8Array;
          contentType?: string;
          headers?: Record<string, string>;
        }
      | VerificationResult,
  ): void {
    const { txId, hash, verified, error, content, contentType, headers } =
      options as VerificationResult;

    const key = this.getCacheKey({ txId, hash });
    const expiresAt = Date.now() + this.ttlMs;

    this.cache.set(key, {
      result: {
        txId,
        verified,
        hash,
        error,
        timestamp: Date.now(),
        content,
        contentType,
        headers,
      },
      expiresAt,
    });
  }

  /**
   * Get a verification result from the cache
   *
   * Returns null if:
   * - Entry doesn't exist
   * - Entry has expired
   * - Hash doesn't match (if provided)
   *
   * @param options - Lookup parameters
   * @returns Cached verification result, or null if not found/expired
   */
  get({
    txId,
    hash,
  }: {
    txId: string;
    hash?: string;
  }): VerificationResult | null {
    const key = this.getCacheKey({ txId, hash });
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    // If hash was provided in query but doesn't match cached hash, return null
    if (hash && entry.result.hash && entry.result.hash !== hash) {
      return null;
    }

    return entry.result;
  }

  /**
   * Check if a transaction ID is in the cache and not expired
   *
   * @param options - Lookup parameters
   * @returns true if valid cached entry exists
   */
  has({ txId, hash }: { txId: string; hash?: string }): boolean {
    return this.get({ txId, hash }) !== null;
  }

  /**
   * Remove a specific entry from the cache
   *
   * @param options - Entry to remove
   */
  delete({ txId, hash }: { txId: string; hash?: string }): void {
    const key = this.getCacheKey({ txId, hash });
    this.cache.delete(key);
  }

  /**
   * Clear all cached verification results
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Remove expired entries from the cache
   *
   * This is automatically done when retrieving entries, but can be
   * called manually to free up memory.
   *
   * @returns Number of entries removed
   */
  prune(): number {
    const now = Date.now();
    let removed = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        removed++;
      }
    }

    return removed;
  }

  /**
   * Get the current cache size
   *
   * @returns Number of cached entries (including expired)
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Get cache statistics
   *
   * @returns Cache statistics
   */
  getStats(): {
    size: number;
    expired: number;
    valid: number;
  } {
    const now = Date.now();
    let expired = 0;
    let valid = 0;

    for (const entry of this.cache.values()) {
      if (now > entry.expiresAt) {
        expired++;
      } else {
        valid++;
      }
    }

    return {
      size: this.cache.size,
      expired,
      valid,
    };
  }
}
