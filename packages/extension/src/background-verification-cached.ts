/**
 * Enhanced background verification with caching
 */

import { useVerificationCache } from './hooks/use-verification-cache';
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
    logger.info(`[VERIFY] Starting background verification for: ${arUrl}`);

    // Get verification settings
    const {
      verificationEnabled = true,
      verificationStrict = false,
      showVerificationToasts = false,
      enableVerificationCache = true,
    } = await chrome.storage.local.get([
      'verificationEnabled',
      'verificationStrict',
      'showVerificationToasts',
      'enableVerificationCache',
    ]);

    if (!verificationEnabled) {
      logger.info('[SKIP] [VERIFY] Verification is disabled, skipping');
      return;
    }

    // Check cache first if enabled
    if (enableVerificationCache) {
      const cacheResult = await useVerificationCache(txId);

      if (cacheResult.cached && cacheResult.verified) {
        logger.info(`[CACHE] [VERIFY] Using cached verification for ${txId}`);

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

    // Add listeners
    wayfinder.emitter.on('verification-succeeded', handleVerificationPassed);
    wayfinder.emitter.on('verification-failed', handleVerificationFailed);

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

      // IMPORTANT: Consume the response body to trigger verification
      try {
        await response.text(); // Consume the full response
        logger.info(
          `[CONSUMED] [VERIFY] Response body consumed, verification should complete now`,
        );
      } catch (err) {
        logger.warn(`[WARNING] [VERIFY] Error consuming response body:`, err);
      }

      // Wait for verification to complete (with timeout)
      await Promise.race([
        verificationPromise,
        new Promise((resolve) => setTimeout(resolve, 5000)), // 5 second timeout
      ]);

      logger.info(
        `[FINAL] [VERIFY] Final verification status: ${verificationResult.verified ? 'PASSED' : 'FAILED'}`,
      );

      // Cache the result if verification succeeded and caching is enabled
      if (
        enableVerificationCache &&
        verificationResult.verified &&
        verificationResult.hash &&
        txId
      ) {
        await verificationCache.set({
          txId,
          hash: verificationResult.hash,
          algorithm: 'sha256',
          timestamp: Date.now(),
          verified: true,
        });
        logger.info(
          `[CACHE] [VERIFY] Cached successful verification for ${txId}`,
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
      wayfinder.emitter.off('verification-succeeded', handleVerificationPassed);
      wayfinder.emitter.off('verification-failed', handleVerificationFailed);
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
  chrome.scripting.executeScript({
    target: { tabId },
    func: (verified, message) => {
      const toast = document.createElement('div');
      toast.style.cssText = `position: fixed; bottom: 20px; right: 20px; background: ${verified ? '#10b981' : '#ff4444'}; color: white; padding: 12px 16px; border-radius: 8px; z-index: 10000; font-family: sans-serif; box-shadow: 0 4px 12px rgba(0,0,0,0.3); animation: slideUp 0.3s ease-out;`;

      const iconSvg = verified
        ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display: inline-block; vertical-align: middle; margin-right: 4px;"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>'
        : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display: inline-block; vertical-align: middle; margin-right: 4px;"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';

      toast.innerHTML =
        iconSvg +
        (message ||
          (verified
            ? ' Content verified successfully'
            : ' Content verification failed'));

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
    args: [verified, customMessage],
  });
}
