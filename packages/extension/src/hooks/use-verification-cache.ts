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

import { logger } from '../utils/logger';
import { getCacheKey, verificationCache } from '../utils/verification-cache';

export interface VerificationCacheHooks {
  beforeVerification: (
    txId: string,
  ) => Promise<{ hash: string; verified: boolean } | null>;
  afterVerification: (
    txId: string,
    hash: string,
    verified: boolean,
    trustedHash?: string,
  ) => Promise<void>;
  onCacheHit: (txId: string) => void;
  onCacheMiss: (txId: string) => void;
}

/**
 * Create verification cache hooks for Wayfinder integration
 */
export function createVerificationCacheHooks(): VerificationCacheHooks {
  let cacheHits = 0;
  let cacheMisses = 0;

  return {
    /**
     * Check cache before verification
     */
    async beforeVerification(
      txId: string,
    ): Promise<{ hash: string; verified: boolean } | null> {
      const cached = await verificationCache.get(txId);

      if (cached && cached.verified) {
        // Only return successful verifications from cache
        this.onCacheHit(txId);
        return {
          hash: cached.hash,
          verified: cached.verified,
        };
      }

      this.onCacheMiss(txId);
      return null;
    },

    /**
     * Store verification result in cache
     */
    async afterVerification(
      txId: string,
      hash: string,
      verified: boolean,
      trustedHash?: string,
    ): Promise<void> {
      await verificationCache.set({
        txId,
        hash,
        algorithm: 'sha256',
        timestamp: Date.now(),
        verified,
        trustedGatewayHash: trustedHash,
      });
    },

    /**
     * Track cache hit
     */
    onCacheHit(txId: string): void {
      cacheHits++;
      const hitRate = (cacheHits / (cacheHits + cacheMisses)) * 100;
      logger.debug(
        `[CACHE] Hit for ${txId} - Hit rate: ${hitRate.toFixed(1)}%`,
      );
    },

    /**
     * Track cache miss
     */
    onCacheMiss(txId: string): void {
      cacheMisses++;
      logger.debug(`[CACHE] Miss for ${txId}`);
    },
  };
}

/**
 * Hook to use verification cache in background script
 */
export async function useVerificationCache(txId: string): Promise<{
  cached: boolean;
  hash?: string;
  verified?: boolean;
}> {
  const cached = await verificationCache.get(txId);

  if (cached) {
    return {
      cached: true,
      hash: cached.hash,
      verified: cached.verified,
    };
  }

  return { cached: false };
}
