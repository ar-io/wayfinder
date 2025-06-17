/**
 * Cache management utilities for Wayfinder
 */

import { logger } from './utils/logger';
import { verificationCache } from './utils/verification-cache';

/**
 * Get cache statistics for display
 */
export async function getCacheStats(): Promise<{
  size: number;
  sizeInKB: number;
  hitRate: number;
  oldestEntry: number | null;
  enabled: boolean;
}> {
  const stats = verificationCache.getStats();
  const { enableVerificationCache = true } = await chrome.storage.local.get([
    'enableVerificationCache',
  ]);

  // Estimate size in KB (rough estimate: 200 bytes per entry)
  const sizeInKB = Math.round((stats.size * 200) / 1024);

  // Get oldest entry timestamp
  const oldestEntry: number | null = null;
  // This would require exposing the cache entries, which we can add if needed

  return {
    size: stats.size,
    sizeInKB,
    hitRate: stats.hitRate,
    oldestEntry,
    enabled: enableVerificationCache,
  };
}

/**
 * Clear verification cache
 */
export async function clearVerificationCache(): Promise<void> {
  await verificationCache.clear();
  logger.info('[CACHE] Verification cache cleared by user');
}

/**
 * Toggle cache enabled/disabled
 */
export async function toggleVerificationCache(enabled: boolean): Promise<void> {
  await chrome.storage.local.set({ enableVerificationCache: enabled });

  if (!enabled) {
    // Clear cache when disabling
    await verificationCache.clear();
  }

  logger.info(`[CACHE] Verification cache ${enabled ? 'enabled' : 'disabled'}`);
}

/**
 * Export cache data for debugging
 */
export async function exportCacheData(): Promise<string> {
  const { verificationCache: cacheData } = await chrome.storage.local.get([
    'verificationCache',
  ]);

  const exportData = {
    timestamp: new Date().toISOString(),
    version: '1.0',
    entries: cacheData || {},
    stats: verificationCache.getStats(),
  };

  return JSON.stringify(exportData, null, 2);
}

/**
 * Preload cache for common ArNS names
 */
export async function preloadCommonEntries(arnsNames: string[]): Promise<void> {
  logger.info(`[CACHE] Preloading ${arnsNames.length} common ArNS entries`);

  // This would require resolving ArNS names to transaction IDs
  // and then fetching/verifying them in the background
  // Implementation depends on ArNS resolution service
}

/**
 * Clean up expired entries
 */
export async function cleanupExpiredEntries(): Promise<number> {
  // This would require exposing cache internals
  // For now, return 0
  logger.info('[CACHE] Running cache cleanup');
  return 0;
}

/**
 * Set up periodic cache cleanup
 */
export function setupCacheCleanup(): void {
  // Run cleanup every 6 hours
  setInterval(
    async () => {
      const cleaned = await cleanupExpiredEntries();
      if (cleaned > 0) {
        logger.info(`[CACHE] Cleaned up ${cleaned} expired entries`);
      }
    },
    6 * 60 * 60 * 1000,
  );
}
