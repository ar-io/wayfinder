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

import { VERIFICATION_DEFAULTS, WAYFINDER_DEFAULTS } from './config/defaults';
import {
  cacheArNSResolution,
  useVerificationCacheWithArNS,
} from './hooks/use-arns-cache';
import { getWayfinderInstance } from './routing';
import { logger } from './utils/logger';
import { verificationCache } from './utils/verification-cache';

// Note: wayfinder-core handles ar:// URLs directly including ArNS names

/**
 * Verify ar:// content in the background with caching
 */
export async function verifyInBackgroundWithCache(
  arUrl: string,
  tabId: number,
  updateDailyStats: (type: string) => Promise<void>,
): Promise<void> {
  try {
    logger.info(`🔍 [VERIFY] Starting background verification for: ${arUrl}`);
    console.log('🔍 [VERIFY] verifyInBackgroundWithCache called for:', arUrl);

    // Get verification settings
    const {
      verifiedBrowsing = WAYFINDER_DEFAULTS.verifiedBrowsing,
      verificationStrict = WAYFINDER_DEFAULTS.verificationStrict,
      showVerificationToasts = VERIFICATION_DEFAULTS.showVerificationToasts,
      enableVerificationCache = VERIFICATION_DEFAULTS.enableVerificationCache,
    } = await chrome.storage.local.get([
      'verifiedBrowsing',
      'verificationStrict',
      'showVerificationToasts',
      'enableVerificationCache',
    ]);

    if (!verifiedBrowsing) {
      logger.info('[SKIP] [VERIFY] Verification is disabled, skipping');
      return;
    }

    // Check cache first if enabled
    if (enableVerificationCache) {
      const cacheResult = await useVerificationCacheWithArNS(arUrl);

      if (cacheResult.cached && cacheResult.verified) {
        logger.info(`[CACHE] [VERIFY] Using cached verification for ${arUrl}`);

        if (cacheResult.txId) {
          logger.info(`[CACHE] [VERIFY] Resolved to txId: ${cacheResult.txId}`);
        }

        // Update stats
        await updateDailyStats('verified');

        // Show success toast if enabled
        if (showVerificationToasts) {
          await showVerificationToast(tabId, true, 'Verified (cached)');
        }

        return; // Skip verification, use cached result
      }
    }

    // Proceed with verification
    const wayfinder = await getWayfinderInstance();
    logger.info('[VERIFY] Wayfinder instance obtained for verification');

    // Track verification status with promise for completion
    const verificationResult = {
      verified: false,
      strategy: null as string | null,
      error: null as string | null,
      hash: null as string | null,
    };

    // Create a promise that resolves when verification completes
    let verificationComplete: (value: void) => void;
    const verificationPromise = new Promise<void>((resolve) => {
      verificationComplete = resolve;
    });

    // Set up verification event listeners
    const handleVerificationPassed = (event: any) => {
      logger.info(
        `[SUCCESS] [VERIFY] Background verification PASSED for ${arUrl}`,
      );
      verificationResult.verified = true;
      verificationResult.strategy = event.strategy || 'unknown';
      verificationResult.hash = event.hash || null;
      updateDailyStats('verified');
      verificationComplete();
    };

    const handleVerificationFailed = (event: any) => {
      logger.warn(
        `[FAILED] [VERIFY] Background verification FAILED for ${arUrl}:`,
        event,
      );
      verificationResult.verified = false;
      verificationResult.error =
        event.error || event.message || 'Verification failed';
      updateDailyStats('failed');
      verificationComplete();
    };

    // Add listeners (check if emitter exists)
    if (!wayfinder.emitter) {
      logger.error('[VERIFY] Wayfinder emitter not available!');
    } else {
      logger.info('[VERIFY] Setting up verification event listeners');
      wayfinder.emitter.on('verification-succeeded', handleVerificationPassed);
      wayfinder.emitter.on('verification-failed', handleVerificationFailed);
    }

    try {
      logger.info(
        `[REQUEST] [VERIFY] Making background verification request...`,
      );

      // Make the verification request
      const response = await wayfinder.request(arUrl, {
        method: 'GET',
        headers: {
          Accept: '*/*',
        },
      });

      logger.info(
        `[RESPONSE] [VERIFY] Response received, status: ${response.status}`,
      );

      // Extract AR.IO gateway headers for ArNS caching
      const arnsResolvedId = response.headers.get('x-arns-resolved-id');
      const arIoDataId = response.headers.get('x-ar-io-data-id');
      const arnsProcessId = response.headers.get('x-arns-process-id');

      // Cache ArNS resolution if this is an ArNS name
      const isArNS =
        arUrl.startsWith('ar://') && !arUrl.match(/^ar:\/\/[a-zA-Z0-9_-]{43}/);
      if (isArNS && arnsResolvedId) {
        const arnsName = arUrl.replace('ar://', '').split('/')[0];
        await cacheArNSResolution(
          arnsName,
          arnsResolvedId,
          arnsProcessId || undefined,
          arIoDataId || undefined,
        );
        logger.info(
          `[ARNS] [VERIFY] Cached ArNS resolution: ${arnsName} → ${arnsResolvedId}`,
        );
      }

      // IMPORTANT: Consume the response body to trigger verification
      try {
        const responseBody = await response.text(); // Consume the full response
        logger.info(
          `[CONSUMED] [VERIFY] Response body consumed, length: ${responseBody.length}, verification should complete now`,
        );
      } catch (err) {
        logger.warn(`[WARNING] [VERIFY] Error consuming response body:`, err);
      }

      // Wait for verification to complete (with timeout)
      await Promise.race([
        verificationPromise,
        new Promise((resolve) =>
          setTimeout(resolve, VERIFICATION_DEFAULTS.verificationTimeout),
        ),
      ]);

      logger.info(
        `[FINAL] [VERIFY] Final verification status: ${
          verificationResult.verified ? 'PASSED' : 'FAILED'
        }`,
      );

      // Cache the result if verification succeeded and caching is enabled
      if (
        enableVerificationCache &&
        verificationResult.verified &&
        verificationResult.hash
      ) {
        // Determine the cache key - use resolved txId for ArNS or direct txId
        const cacheKey =
          arnsResolvedId || arUrl.replace('ar://', '').split('/')[0];

        const cacheEntry = {
          txId: cacheKey,
          hash: verificationResult.hash,
          algorithm: 'sha256' as const,
          timestamp: Date.now(),
          verified: true,
          // ArNS specific fields
          arnsName: isArNS ? arUrl : undefined,
          processId: arnsProcessId || undefined,
          dataId: arIoDataId || undefined,
        };

        await verificationCache.set(cacheEntry);
        logger.info(
          `[CACHE] [VERIFY] Cached successful verification for ${cacheKey}${
            isArNS ? ` (ArNS: ${arUrl})` : ''
          }`,
        );
      }

      // Show appropriate UI feedback
      if (verificationStrict && !verificationResult.verified) {
        await showVerificationWarning(tabId);
      }

      if (showVerificationToasts) {
        await showVerificationToast(tabId, verificationResult.verified);
      }
    } finally {
      // Clean up listeners
      if (wayfinder.emitter) {
        wayfinder.emitter.off(
          'verification-succeeded',
          handleVerificationPassed,
        );
        wayfinder.emitter.off('verification-failed', handleVerificationFailed);
      }
    }
  } catch (error) {
    logger.error(
      '[CRITICAL] [VERIFY] Error in background verification:',
      error,
    );
  }
}

/**
 * Show verification warning for strict mode
 */
async function showVerificationWarning(tabId: number): Promise<void> {
  chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const warning = document.createElement('div');
      warning.style.cssText =
        'position: fixed; bottom: 20px; right: 20px; background: #ff4444; color: white; padding: 16px; border-radius: 8px; z-index: 10000; font-family: sans-serif; box-shadow: 0 4px 12px rgba(0,0,0,0.3); animation: slideUp 0.3s ease-out;';
      warning.innerHTML =
        '<strong><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display: inline-block; vertical-align: middle; margin-right: 4px;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> Verification Failed</strong><br>This content could not be verified through the AR.IO network.';

      // Add slide up animation
      const style = document.createElement('style');
      style.textContent = `
        @keyframes slideUp {
          from {
            transform: translateY(100%);
            opacity: 0;
          }
          to {
            transform: translateY(0);
            opacity: 1;
          }
        }
      `;
      document.head.appendChild(style);

      document.body.appendChild(warning);
      setTimeout(() => {
        warning.style.animation = 'slideUp 0.3s ease-out reverse';
        setTimeout(() => {
          warning.remove();
          style.remove();
        }, 300);
      }, 10000);
    },
  });
}

/**
 * Show verification toast
 */
async function showVerificationToast(
  tabId: number,
  verified: boolean,
  customMessage?: string,
): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (verified, message) => {
        const toast = document.createElement('div');
        toast.style.cssText = `position: fixed; bottom: 20px; right: 20px; background: ${
          verified ? '#10b981' : '#ff4444'
        }; color: white; padding: 12px 16px; border-radius: 8px; z-index: 10000; font-family: sans-serif; box-shadow: 0 4px 12px rgba(0,0,0,0.3); animation: slideUp 0.3s ease-out;`;

        const iconSvg = verified
          ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display: inline-block; vertical-align: middle; margin-right: 4px;"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>'
          : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display: inline-block; vertical-align: middle; margin-right: 4px;"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';

        toast.innerHTML =
          iconSvg +
          (message && typeof message === 'string'
            ? message
            : verified
              ? ' Content verified successfully'
              : ' Content verification failed');

        // Add slide up animation
        const style = document.createElement('style');
        style.textContent = `
          @keyframes slideUp {
            from {
              transform: translateY(100%);
              opacity: 0;
            }
            to {
              transform: translateY(0);
              opacity: 1;
            }
          }
        `;
        document.head.appendChild(style);

        document.body.appendChild(toast);
        setTimeout(() => {
          toast.style.animation = 'slideUp 0.3s ease-out reverse';
          setTimeout(() => {
            toast.remove();
            style.remove();
          }, 300);
        }, 3000);
      },
      args: [verified, customMessage || null],
    });
  } catch (error) {
    console.error('[TOAST] Failed to show verification toast:', error);
  }
}
