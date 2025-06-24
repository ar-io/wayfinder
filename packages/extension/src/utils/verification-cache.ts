/**
 * WayFinder Verification Cache
 * Lightweight caching system for verification hashes to improve performance
 */

import { logger } from './logger';

interface CachedVerification {
  txId?: string;
  hash?: string;
  algorithm?: 'sha256';
  timestamp: number;
  verified: boolean;
  trustedGatewayHash?: string;
  size?: number;
  dataId?: string; // x-ar-io-data-id (actual content being served)
  arnsName?: string; // Original ArNS name (e.g., "ar://ardrive")
  processId?: string; // x-arns-process-id (ArNS smart contract)
  lastVisit?: number; // Last time this ArNS name was accessed
  changeHistory?: ArNSChange[]; // Track changes over time for security
  // New fields for enhanced verification
  expectedDigest?: string; // Expected digest from pre-flight HEAD request
  actualDigest?: string; // Actual digest from browser response
  status?: 'pending' | 'completed' | 'failed'; // Verification status
  strategy?: 'preflight' | 'full' | 'background'; // Verification strategy used
  error?: string; // Error message if verification failed
}

interface ArNSChange {
  timestamp: number;
  type: 'content' | 'process' | 'both';
  previousTxId?: string;
  previousProcessId?: string;
  newTxId?: string;
  newProcessId?: string;
}

interface CacheConfig {
  maxSize: number; // Maximum number of entries
  ttl: number; // Time to live in milliseconds
  persistToStorage: boolean; // Whether to persist to chrome.storage.local
}

export class VerificationCache {
  private memoryCache = new Map<string, CachedVerification>();
  private config: CacheConfig;
  private accessOrder: string[] = []; // LRU tracking

  constructor(config: Partial<CacheConfig> = {}) {
    this.config = {
      maxSize: 1000, // Default 1000 entries
      ttl: 24 * 60 * 60 * 1000, // Default 24 hours
      persistToStorage: true,
      ...config,
    };

    // Load from storage on initialization
    if (this.config.persistToStorage) {
      this.loadFromStorage();
    }
  }

  /**
   * Get a cached verification result
   */
  async get(keyOrUrl: string): Promise<CachedVerification | null> {
    logger.info(
      `[CACHE] [GET] Looking for cached verification for ${keyOrUrl}`,
    );

    // Check memory cache first
    const cached = this.memoryCache.get(keyOrUrl);

    if (cached) {
      const age = Date.now() - cached.timestamp;
      const ageHours = (age / (1000 * 60 * 60)).toFixed(1);

      // Check if expired
      if (age > this.config.ttl) {
        logger.info(
          `[CACHE] [EXPIRED] Verification cache expired for ${keyOrUrl} (age: ${ageHours}h)`,
        );
        this.delete(keyOrUrl);
        return null;
      }

      // Update LRU order
      this.updateAccessOrder(keyOrUrl);
      logger.info(
        `[CACHE] [HIT] Using cached verification for ${keyOrUrl} (verified: ${cached.verified}, status: ${cached.status}, age: ${ageHours}h)`,
      );

      if (cached.arnsName) {
        logger.info(
          `[CACHE] [ARNS] Cached ArNS data - name: ${cached.arnsName}, processId: ${cached.processId?.substring(0, 8) || 'none'}`,
        );
      }

      return cached;
    }

    logger.info(
      `[CACHE] [MISS] No cached verification found for ${keyOrUrl} - will perform new verification`,
    );
    return null;
  }

  /**
   * Set a verification result in cache
   */
  async set(keyOrUrl: string, verification: CachedVerification): Promise<void> {
    // Use the provided key (could be URL or txId)
    const cacheKey = keyOrUrl;

    // Add timestamp if not provided
    if (!verification.timestamp) {
      verification.timestamp = Date.now();
    }

    const isUpdate = this.memoryCache.has(cacheKey);
    const action = isUpdate ? 'UPDATE' : 'NEW';

    // Only log if this is actual verification (not just header caching)
    if (verification.strategy !== 'none') {
      logger.info(`[CACHE] [${action}] Caching verification for ${cacheKey}`);
      logger.info(
        `[CACHE] [DETAILS] Verified: ${verification.verified}, Status: ${verification.status}, Strategy: ${verification.strategy}`,
      );

      if (verification.expectedDigest || verification.actualDigest) {
        logger.info(
          `[CACHE] [DIGEST] Expected: ${verification.expectedDigest?.substring(0, 8)}..., Actual: ${verification.actualDigest?.substring(0, 8) || 'pending'}`,
        );
      }
    }

    if (verification.arnsName) {
      logger.info(
        `[CACHE] [ARNS] ArNS data - Name: ${verification.arnsName}, ProcessId: ${verification.processId?.substring(0, 8) || 'none'}, DataId: ${verification.dataId?.substring(0, 8) || 'none'}`,
      );
    }

    // Check cache size and evict if necessary
    if (this.memoryCache.size >= this.config.maxSize) {
      logger.info(
        `[CACHE] [EVICTION] Cache full (${this.memoryCache.size}/${this.config.maxSize}), evicting LRU entry`,
      );
      this.evictLRU();
    }

    // Store in memory
    this.memoryCache.set(cacheKey, verification);
    this.updateAccessOrder(cacheKey);

    // Only log success for actual verification
    if (verification.strategy !== 'none') {
      logger.info(
        `[CACHE] [SUCCESS] Cached verification for ${cacheKey} (cache size: ${this.memoryCache.size}/${this.config.maxSize})`,
      );
    }

    // Persist to storage if enabled
    if (this.config.persistToStorage) {
      logger.debug(`[CACHE] [STORAGE] Persisting cache to Chrome storage`);
      this.saveToStorage();
    }
  }

  /**
   * Update an existing verification entry
   */
  async update(
    keyOrUrl: string,
    updates: Partial<CachedVerification>,
  ): Promise<void> {
    const existing = this.memoryCache.get(keyOrUrl);
    if (!existing) {
      logger.warn(
        `[CACHE] [UPDATE] No existing entry for ${keyOrUrl}, creating new`,
      );
      await this.set(keyOrUrl, {
        timestamp: Date.now(),
        verified: false,
        ...updates,
      });
      return;
    }

    const updated = { ...existing, ...updates, timestamp: Date.now() };
    await this.set(keyOrUrl, updated);
  }

  /**
   * Delete a specific entry
   */
  delete(keyOrUrl: string): void {
    this.memoryCache.delete(keyOrUrl);
    this.accessOrder = this.accessOrder.filter((id) => id !== keyOrUrl);

    if (this.config.persistToStorage) {
      this.saveToStorage();
    }
  }

  /**
   * Clear entire cache
   */
  async clear(): Promise<void> {
    const entriesCount = this.memoryCache.size;

    logger.info(
      `[CACHE] [CLEAR] Clearing verification cache (${entriesCount} entries)`,
    );

    this.memoryCache.clear();
    this.accessOrder = [];

    if (this.config.persistToStorage) {
      logger.info('[CACHE] [CLEAR] Removing cached data from Chrome storage');
      await chrome.storage.local.remove(['verificationCache']);
    }

    logger.info(
      `[CACHE] [CLEAR] Verification cache cleared - removed ${entriesCount} entries`,
    );
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    size: number;
    hitRate: number;
    totalHits: number;
    totalMisses: number;
  } {
    // These would be tracked in a production implementation
    return {
      size: this.memoryCache.size,
      hitRate: 0, // Would need to track hits/misses
      totalHits: 0,
      totalMisses: 0,
    };
  }

  /**
   * Update LRU access order
   */
  private updateAccessOrder(txId: string): void {
    // Remove from current position
    this.accessOrder = this.accessOrder.filter((id) => id !== txId);
    // Add to end (most recently used)
    this.accessOrder.push(txId);
  }

  /**
   * Evict least recently used entry
   */
  private evictLRU(): void {
    if (this.accessOrder.length > 0) {
      const lru = this.accessOrder.shift()!;
      const evictedEntry = this.memoryCache.get(lru);
      this.memoryCache.delete(lru);

      if (evictedEntry) {
        const age = Date.now() - evictedEntry.timestamp;
        const ageHours = (age / (1000 * 60 * 60)).toFixed(1);
        logger.info(
          `[CACHE] [LRU-EVICT] Evicted entry: ${lru} (age: ${ageHours}h, verified: ${evictedEntry.verified})`,
        );
      } else {
        logger.debug(`[CACHE] [LRU-EVICT] Evicted entry: ${lru}`);
      }
    }
  }

  /**
   * Load cache from chrome storage
   */
  private async loadFromStorage(): Promise<void> {
    try {
      logger.info(
        `[CACHE] [STORAGE] Loading verification cache from Chrome storage`,
      );

      const { verificationCache } = await chrome.storage.local.get([
        'verificationCache',
      ]);

      if (verificationCache && typeof verificationCache === 'object') {
        let loadedCount = 0;
        let expiredCount = 0;
        let invalidCount = 0;

        // Restore cache entries
        Object.entries(verificationCache).forEach(([txId, entry]) => {
          if (this.isValidCacheEntry(entry)) {
            const entryData = entry as CachedVerification;
            const age = Date.now() - entryData.timestamp;

            // Check if entry is expired
            if (age > this.config.ttl) {
              expiredCount++;
              logger.debug(
                `[CACHE] [STORAGE] Skipping expired entry: ${txId} (age: ${(age / (1000 * 60 * 60)).toFixed(1)}h)`,
              );
              return;
            }

            this.memoryCache.set(txId, entryData);
            this.accessOrder.push(txId);
            loadedCount++;

            logger.debug(
              `[CACHE] [STORAGE] Loaded: ${txId} (verified: ${entryData.verified}, age: ${(age / (1000 * 60 * 60)).toFixed(1)}h)`,
            );
          } else {
            invalidCount++;
            logger.warn(
              `[CACHE] [STORAGE] Skipping invalid cache entry: ${txId}`,
            );
          }
        });

        logger.info(
          `[CACHE] [STORAGE] Loaded ${loadedCount} entries, skipped ${expiredCount} expired, ${invalidCount} invalid`,
        );
      } else {
        logger.info(
          `[CACHE] [STORAGE] No cached verification data found in storage`,
        );
      }
    } catch (error) {
      logger.error(
        '[CACHE] [STORAGE] Failed to load verification cache from storage:',
        error,
      );
    }
  }

  /**
   * Save cache to chrome storage
   */
  private async saveToStorage(): Promise<void> {
    try {
      // Convert Map to object for storage
      const cacheObject: Record<string, CachedVerification> = {};

      // Only save the most recent entries up to half the max size for storage efficiency
      const entriesToSave = Math.min(
        this.memoryCache.size,
        Math.floor(this.config.maxSize / 2),
      );
      const recentEntries = this.accessOrder.slice(-entriesToSave);

      logger.debug(
        `[CACHE] [STORAGE] Saving ${recentEntries.length} most recent entries (${this.memoryCache.size} total in memory)`,
      );

      recentEntries.forEach((txId) => {
        const entry = this.memoryCache.get(txId);
        if (entry) {
          cacheObject[txId] = entry;
          logger.debug(
            `[CACHE] [STORAGE] Saving: ${txId} (verified: ${entry.verified}, age: ${((Date.now() - entry.timestamp) / (1000 * 60 * 60)).toFixed(1)}h)`,
          );
        }
      });

      await chrome.storage.local.set({ verificationCache: cacheObject });
      
      // Only log storage operations for actual verification entries
      const verificationEntries = Object.values(cacheObject).filter(
        (entry: any) => entry.strategy !== 'none'
      ).length;
      
      if (verificationEntries > 0) {
        logger.info(
          `[CACHE] [STORAGE] Successfully saved ${verificationEntries} verification entries to Chrome storage`,
        );
      }
    } catch (error) {
      logger.error(
        '[CACHE] [STORAGE] Failed to save verification cache to storage:',
        error,
      );
    }
  }

  /**
   * Validate cache entry structure
   */
  private isValidCacheEntry(entry: any): boolean {
    return (
      entry &&
      typeof entry === 'object' &&
      typeof entry.txId === 'string' &&
      typeof entry.hash === 'string' &&
      typeof entry.timestamp === 'number' &&
      typeof entry.verified === 'boolean'
    );
  }
}

// Create singleton instance
export const verificationCache = new VerificationCache({
  maxSize: 1000,
  ttl: 24 * 60 * 60 * 1000, // 24 hours
  persistToStorage: true,
});

/**
 * Helper function to get cache key for different verification types
 */
export function getCacheKey(
  txId: string,
  type: 'hash' | 'dataRoot' = 'hash',
): string {
  return `${type}:${txId}`;
}

/**
 * Detect ArNS changes by comparing current headers with cached data
 */
export async function detectArNSChanges(
  arnsName: string,
  currentTxId: string,
  _currentDataId?: string,
  currentProcessId?: string,
): Promise<ArNSChange | null> {
  // Find existing cache entry for this ArNS name
  const existingEntry = Array.from(
    verificationCache['memoryCache'].values(),
  ).find((entry) => entry.arnsName === arnsName);

  if (!existingEntry) {
    logger.debug(`[ARNS] No previous data for ${arnsName}, treating as new`);
    return null;
  }

  const changes: ArNSChange = {
    timestamp: Date.now(),
    type: 'content',
    previousTxId: existingEntry.txId,
    previousProcessId: existingEntry.processId,
    newTxId: currentTxId,
    newProcessId: currentProcessId,
  };

  let hasChanges = false;

  // Check for content changes (resolved transaction ID)
  if (existingEntry.txId !== currentTxId) {
    changes.type = 'content';
    hasChanges = true;
    logger.info(
      `[ARNS] Content change detected for ${arnsName}: ${existingEntry.txId} → ${currentTxId}`,
    );
  }

  // Check for process changes (smart contract upgrades)
  if (
    existingEntry.processId &&
    currentProcessId &&
    existingEntry.processId !== currentProcessId
  ) {
    changes.type = hasChanges ? 'both' : 'process';
    hasChanges = true;
    logger.info(
      `[ARNS] Process change detected for ${arnsName}: ${existingEntry.processId} → ${currentProcessId}`,
    );
  }

  return hasChanges ? changes : null;
}

/**
 * Notify user about ArNS changes with appropriate messaging
 */
export async function notifyArNSChange(
  tabId: number,
  arnsName: string,
  change: ArNSChange,
): Promise<void> {
  let title: string;
  let message: string;
  let color: string;

  switch (change.type) {
    case 'content':
      title = '📄 Content Updated';
      message = `${arnsName} has been updated with new content`;
      color = '#3b82f6'; // Blue for content updates
      break;
    case 'process':
      title = '🔧 Smart Contract Upgraded';
      message = `${arnsName} smart contract has been upgraded`;
      color = '#f59e0b'; // Amber for process changes
      break;
    case 'both':
      title = '🔄 Major Update';
      message = `${arnsName} has updated both content and smart contract`;
      color = '#8b5cf6'; // Purple for both changes
      break;
    default:
      return; // Unknown change type
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (title, message, color) => {
        const notification = document.createElement('div');
        notification.style.cssText = `
          position: fixed;
          top: 20px;
          right: 20px;
          background: ${color};
          color: white;
          padding: 16px 20px;
          border-radius: 12px;
          z-index: 10001;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
          box-shadow: 0 8px 32px rgba(0,0,0,0.3);
          max-width: 320px;
          animation: slideIn 0.3s ease-out;
          cursor: pointer;
        `;

        notification.innerHTML = `
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
            <strong style="font-size: 14px;">${title}</strong>
            <span style="margin-left: auto; font-size: 12px; opacity: 0.8;">Wayfinder</span>
          </div>
          <div style="font-size: 13px; line-height: 1.4; opacity: 0.95;">${message}</div>
        `;

        // Add animation styles
        const style = document.createElement('style');
        style.textContent = `
          @keyframes slideIn {
            from {
              transform: translateX(100%);
              opacity: 0;
            }
            to {
              transform: translateX(0);
              opacity: 1;
            }
          }
          @keyframes slideOut {
            from {
              transform: translateX(0);
              opacity: 1;
            }
            to {
              transform: translateX(100%);
              opacity: 0;
            }
          }
        `;
        document.head.appendChild(style);

        // Auto-dismiss after 8 seconds
        const dismiss = () => {
          notification.style.animation = 'slideOut 0.3s ease-out';
          setTimeout(() => {
            notification.remove();
            style.remove();
          }, 300);
        };

        // Click to dismiss
        notification.addEventListener('click', dismiss);

        document.body.appendChild(notification);
        setTimeout(dismiss, 8000);
      },
      args: [title, message, color],
    });

    logger.info(
      `[ARNS] Notified user about ${change.type} change for ${arnsName}`,
    );
  } catch (error) {
    logger.error('[ARNS] Failed to show change notification:', error);
  }
}
