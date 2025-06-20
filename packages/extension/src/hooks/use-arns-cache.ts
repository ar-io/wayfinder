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

import { logger } from "../utils/logger";
import { verificationCache } from "../utils/verification-cache";

export interface ArNSCacheEntry {
  arnsName: string;
  txId: string;
  processId?: string;
  dataId?: string;
  resolvedAt: number;
  ttl: number; // Time to live in milliseconds
}

import { CACHE_DEFAULTS } from "../config/defaults";

// Default TTL for ArNS cache entries
const DEFAULT_ARNS_TTL = CACHE_DEFAULTS.arnsDefaultTTL;

/**
 * Get cached ArNS resolution
 */
export async function getCachedArNSResolution(
  arnsName: string
): Promise<ArNSCacheEntry | null> {
  try {
    const cacheKey = `arns:${arnsName}`;
    const cached = await chrome.storage.local.get(cacheKey);

    if (cached[cacheKey]) {
      const entry = cached[cacheKey] as ArNSCacheEntry;

      // Check if cache is still valid
      const age = Date.now() - entry.resolvedAt;
      if (age < entry.ttl) {
        logger.info(
          `[ARNS-CACHE] Found valid cache for ${arnsName} → ${entry.txId}`
        );
        return entry;
      } else {
        logger.info(
          `[ARNS-CACHE] Cache expired for ${arnsName} (age: ${age}ms)`
        );
        // Clean up expired entry
        await chrome.storage.local.remove(cacheKey);
      }
    }

    return null;
  } catch (error) {
    logger.error("[ARNS-CACHE] Error getting cached resolution:", error);
    return null;
  }
}

/**
 * Cache ArNS resolution
 */
export async function cacheArNSResolution(
  arnsName: string,
  txId: string,
  processId?: string,
  dataId?: string,
  ttl: number = DEFAULT_ARNS_TTL
): Promise<void> {
  try {
    const cacheKey = `arns:${arnsName}`;
    const entry: ArNSCacheEntry = {
      arnsName,
      txId,
      processId,
      dataId,
      resolvedAt: Date.now(),
      ttl,
    };

    await chrome.storage.local.set({ [cacheKey]: entry });
    logger.info(`[ARNS-CACHE] Cached resolution for ${arnsName} → ${txId}`);
  } catch (error) {
    logger.error("[ARNS-CACHE] Error caching resolution:", error);
  }
}

/**
 * Enhanced verification cache check with ArNS support
 */
export async function useVerificationCacheWithArNS(arUrl: string): Promise<{
  cached: boolean;
  verified: boolean;
  hash?: string;
  txId?: string;
  arnsChanged?: boolean;
}> {
  try {
    // Check if this is an ArNS name
    const isArNS =
      arUrl.startsWith("ar://") && !arUrl.match(/^ar:\/\/[a-zA-Z0-9_-]{43}/);

    if (isArNS) {
      const arnsName = arUrl.replace("ar://", "").split("/")[0];

      // Check ArNS cache first
      const arnsCache = await getCachedArNSResolution(arnsName);

      if (arnsCache) {
        // Check verification cache for the resolved txId
        const verifyCache = await verificationCache.get(arnsCache.txId);

        if (verifyCache && verifyCache.verified) {
          logger.info(
            `[ARNS-CACHE] Using cached verification for ${arnsName} → ${arnsCache.txId}`
          );

          return {
            cached: true,
            verified: true,
            hash: verifyCache.hash,
            txId: arnsCache.txId,
            arnsChanged: false,
          };
        }
      }

      // No cache or verification failed
      return {
        cached: false,
        verified: false,
      };
    } else {
      // Direct transaction ID
      const txId = arUrl.replace("ar://", "").split("/")[0];
      const cached = await verificationCache.get(txId);

      if (cached && cached.verified) {
        return {
          cached: true,
          verified: true,
          hash: cached.hash,
          txId,
        };
      }

      return {
        cached: false,
        verified: false,
      };
    }
  } catch (error) {
    logger.error("[ARNS-CACHE] Error checking cache:", error);
    return {
      cached: false,
      verified: false,
    };
  }
}

/**
 * Clean up expired ArNS cache entries
 */
export async function cleanupArNSCache(): Promise<void> {
  try {
    const storage = await chrome.storage.local.get();
    const now = Date.now();
    const keysToRemove: string[] = [];

    // Find expired ArNS entries
    for (const [key, value] of Object.entries(storage)) {
      if (key.startsWith("arns:") && typeof value === "object") {
        const entry = value as ArNSCacheEntry;
        if (now - entry.resolvedAt > entry.ttl) {
          keysToRemove.push(key);
        }
      }
    }

    if (keysToRemove.length > 0) {
      await chrome.storage.local.remove(keysToRemove);
      logger.info(
        `[ARNS-CACHE] Cleaned up ${keysToRemove.length} expired entries`
      );
    }
  } catch (error) {
    logger.error("[ARNS-CACHE] Error during cleanup:", error);
  }
}

// Set up periodic cleanup
setInterval(cleanupArNSCache, CACHE_DEFAULTS.arnsDefaultTTL);
