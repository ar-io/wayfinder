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

// Inline logger for content script to avoid module import issues
const logger = {
  debug: (message: string, ...args: any[]) =>
    console.debug('[Wayfinder Content]', message, ...args),
  info: (message: string, ...args: any[]) =>
    console.info('[Wayfinder Content]', message, ...args),
  warn: (message: string, ...args: any[]) =>
    console.warn('[Wayfinder Content]', message, ...args),
  error: (message: string, ...args: any[]) =>
    console.error('[Wayfinder Content]', message, ...args),
};

/**
 * Utility function to add timeout to promises
 */
function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs),
    ),
  ]);
}

/**
 * Show verification toast notification
 */
function showVerificationToast(
  message: string,
  type: 'success' | 'error' | 'info' = 'info',
) {
  // Check if verification toasts are enabled (avoid spam)
  chrome.storage.local
    .get(['showVerificationToasts'])
    .then(({ showVerificationToasts = false }) => {
      if (!showVerificationToasts) return;

      const toast = document.createElement('div');
      toast.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: ${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#3b82f6'};
      color: white;
      padding: 12px 16px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      z-index: 10000;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      max-width: 300px;
      word-break: break-word;
    `;
      toast.textContent = message;

      document.body.appendChild(toast);

      setTimeout(() => {
        if (toast.parentNode) {
          toast.parentNode.removeChild(toast);
        }
      }, 3000);
    });
}

// Enhanced content script with verification status indicators
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', afterContentDOMLoaded);
} else {
  afterContentDOMLoaded();
}

/**
 * Add verification status indicator to elements
 */
function addVerificationIndicator(
  element: Element,
  status: 'pending' | 'verified' | 'failed',
): void {
  // Remove existing indicators
  const existingIndicator = element.parentElement?.querySelector(
    '.wayfinder-verification',
  );
  if (existingIndicator) {
    existingIndicator.remove();
  }

  // Create new indicator
  const indicator = document.createElement('span');
  indicator.className = 'wayfinder-verification';
  indicator.style.cssText = `
    display: inline-flex;
    align-items: center;
    margin-left: 4px;
    font-size: 11px;
    padding: 2px 6px;
    border-radius: 12px;
    font-weight: 600;
    vertical-align: middle;
    box-shadow: 0 1px 3px rgba(0,0,0,0.2);
    z-index: 1000;
    line-height: 1;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    border: 1px solid rgba(255,255,255,0.2);
  `;

  switch (status) {
    case 'pending':
      indicator.innerHTML =
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display: inline-block; vertical-align: middle; animation: wayfinder-spin 1s linear infinite;"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg> <span style="margin-left: 2px;">Verifying</span>';
      indicator.title = 'Wayfinder: Verifying data integrity...';
      indicator.style.backgroundColor = '#f59e0b';
      indicator.style.color = 'white';
      break;
    case 'verified':
      indicator.innerHTML =
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display: inline-block; vertical-align: middle;"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> <span style="margin-left: 2px;">Verified</span>';
      indicator.title = 'Wayfinder: Data integrity verified by AR.IO network';
      indicator.style.backgroundColor = '#10b981';
      indicator.style.color = 'white';
      break;
    case 'failed':
      indicator.innerHTML =
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display: inline-block; vertical-align: middle;"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg> <span style="margin-left: 2px;">Failed</span>';
      indicator.title = 'Wayfinder: Data verification failed';
      indicator.style.backgroundColor = '#ef4444';
      indicator.style.color = 'white';
      break;
  }

  // Add CSS animation for pending state
  if (!document.getElementById('wayfinder-styles')) {
    const style = document.createElement('style');
    style.id = 'wayfinder-styles';
    style.textContent = `
      @keyframes wayfinder-pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.6; }
      }
      @keyframes wayfinder-spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);
  }

  // Insert after the element
  if (element.parentElement) {
    element.parentElement.insertBefore(indicator, element.nextSibling);
  }
}

/**
 * Process ar:// URLs with enhanced verification support
 */
async function processArUrl(
  element: Element,
  arUrl: string,
  attribute: string,
): Promise<void> {
  // Check if verification indicators are enabled
  const storage = await new Promise<{
    showVerificationIndicators?: boolean;
  }>((resolve) => {
    chrome.storage.local.get(
      ['showVerificationIndicators'],
      resolve,
    );
  });

  const showVerificationIndicators =
    storage.showVerificationIndicators !== false;

  // Add pending indicator if enabled
  if (showVerificationIndicators) {
    addVerificationIndicator(element, 'pending');
  }

  try {
    // First, convert the ar:// URL to HTTP with timeout
    const convertResponse = await withTimeout(
      new Promise<any>((resolve) => {
        chrome.runtime.sendMessage(
          { type: 'convertArUrlToHttpUrl', arUrl },
          resolve,
        );
      }),
      5000, // 5 second timeout for URL conversion
      'URL conversion timed out',
    );

    if (!convertResponse || convertResponse.error) {
      throw new Error(convertResponse?.error || 'URL conversion failed');
    }

    // Set the converted URL
    (element as any)[attribute] = convertResponse.url;

    // For transaction IDs, optionally verify in content script for immediate UI feedback
    // Note: This makes an additional request beyond the background verification
    const txIdMatch = arUrl.match(/^ar:\/\/([a-zA-Z0-9_-]{43})/);
    if (txIdMatch) {
      const txId = txIdMatch[1];

      try {
        // Wait a moment for the browser request to complete and cache to be populated
        await new Promise((resolve) => setTimeout(resolve, 1000));

        // Check if we have a cached verification result from the browser request
        const cacheCheckResponse = await withTimeout(
          new Promise<any>((resolve) => {
            chrome.runtime.sendMessage(
              {
                type: 'checkVerificationCache',
                url: arUrl,
              },
              resolve,
            );
          }),
          1000, // Quick timeout for cache check
          'Cache check timed out',
        );

        let verifyResponse;

        if (
          cacheCheckResponse &&
          cacheCheckResponse.cached &&
          cacheCheckResponse.result
        ) {
          // Use cached result from the browser's navigation request
          logger.debug(
            `[CACHED] Using verification result from browser request for ${txId}`,
          );
          verifyResponse = {
            success: true,
            response: {
              verification: {
                verified: cacheCheckResponse.result.verified,
                strategy: cacheCheckResponse.result.strategy,
                error: cacheCheckResponse.result.error,
              },
            },
          };
        } else {
          // No verification data available (verification might be disabled)
          logger.debug(
            `[NO VERIFY] No verification data available for ${txId}`,
          );
          verifyResponse = null;
        }

        if (showVerificationIndicators && verifyResponse) {
          if (verifyResponse.success && verifyResponse.response) {
            const verification = verifyResponse.response.verification;

            if (verification && verification.verified) {
              addVerificationIndicator(element, 'verified');
              showVerificationToast(
                `Data verified using ${verification.strategy} strategy`,
                'success',
              );
              logger.debug(
                `[SUCCESS] Verified data integrity for ${txId} using ${verification.strategy}`,
              );
            } else if (verification) {
              addVerificationIndicator(element, 'failed');
              showVerificationToast(
                `Verification failed: ${verification.error || 'Unknown error'}`,
                'error',
              );
              logger.warn(
                `[FAILED] Verification failed for ${txId}:`,
                verification.error || 'Unknown verification error',
              );
            }
          }
        } else if (showVerificationIndicators && !verifyResponse) {
          // No verification data - verification might be disabled
          logger.debug(
            `[INFO] No verification indicators shown - verification may be disabled`,
          );
        }
      } catch (verifyError) {
        // If verification fails, still allow the content to load but show failed status
        if (showVerificationIndicators) {
          addVerificationIndicator(element, 'failed');
        }
        logger.warn(`Verification error for ${txId}:`, verifyError);
      }
    } else {
      // For ArNS names, just show as verified since we can't verify them directly
      if (showVerificationIndicators) {
        addVerificationIndicator(element, 'verified');
      }
    }
  } catch (error) {
    // Remove indicator on total failure
    const indicator = element.parentElement?.querySelector(
      '.wayfinder-verification',
    );
    if (indicator) {
      indicator.remove();
    }

    logger.error(`Failed to process ar:// URL ${arUrl}:`, error);
  }
}

/**
 * Main content script initialization with enhanced verification
 */
async function afterContentDOMLoaded(): Promise<void> {
  logger.debug('Wayfinder Content Script: Processing ar:// URLs');

  // Gather all elements with `ar://` protocol
  const arElements = document.querySelectorAll(
    'a[href^="ar://"], img[src^="ar://"], iframe[src^="ar://"], ' +
      'audio > source[src^="ar://"], video > source[src^="ar://"], ' +
      'link[href^="ar://"], embed[src^="ar://"], object[data^="ar://"]',
  );

  logger.debug(`Found ${arElements.length} ar:// elements to process`);

  // Process each element
  for (const element of arElements) {
    let arUrl: string | null = null;
    let attribute: string | null = null;

    switch (element.tagName) {
      case 'A':
        arUrl = (element as HTMLAnchorElement).href;
        attribute = 'href';
        break;
      case 'IMG':
        arUrl = (element as HTMLImageElement).src;
        attribute = 'src';
        break;
      case 'IFRAME':
        arUrl = (element as HTMLIFrameElement).src;
        attribute = 'src';
        break;
      case 'SOURCE':
        if (
          element.parentNode &&
          element.parentNode.nodeType === Node.ELEMENT_NODE
        ) {
          const parentElement = element.parentNode as HTMLMediaElement;
          if (
            parentElement.tagName === 'AUDIO' ||
            parentElement.tagName === 'VIDEO'
          ) {
            arUrl = (element as HTMLSourceElement).src;
            attribute = 'src';
          }
        }
        break;
      case 'LINK':
        arUrl = (element as HTMLLinkElement).href;
        attribute = 'href';
        break;
      case 'EMBED':
        arUrl = (element as HTMLEmbedElement).src;
        attribute = 'src';
        break;
      case 'OBJECT':
        arUrl = (element as HTMLObjectElement).data;
        attribute = 'data';
        break;
    }

    if (arUrl && attribute) {
      // Process each URL with verification
      processArUrl(element, arUrl, attribute).catch((error) =>
        logger.error('Error processing ar:// URL:', error),
      );

      // Special handling for media elements
      if (element.tagName === 'SOURCE') {
        const parentElement = element.parentNode as HTMLMediaElement;
        if (
          parentElement &&
          (parentElement.tagName === 'AUDIO' ||
            parentElement.tagName === 'VIDEO')
        ) {
          // Reload media element after source change
          setTimeout(() => parentElement.load(), 100);
        }
      }

      // Special handling for link elements
      if (element.tagName === 'LINK') {
        // For link elements, we need to replace the element to trigger reload
        setTimeout(() => {
          const newLinkEl = element.cloneNode(true) as HTMLLinkElement;
          if (element.parentNode) {
            element.parentNode.replaceChild(newLinkEl, element);
          }
        }, 100);
      }
    }
  }

  // Watch for dynamically added ar:// elements
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const element = node as Element;

          // Check if the element itself has ar:// URLs
          const arAttributes = ['href', 'src', 'data'];
          for (const attr of arAttributes) {
            const value = element.getAttribute(attr);
            if (value && value.startsWith('ar://')) {
              processArUrl(element, value, attr).catch((error) =>
                logger.error('Error processing dynamic ar:// URL:', error),
              );
            }
          }

          // Check child elements
          const childArElements = element.querySelectorAll(
            'a[href^="ar://"], img[src^="ar://"], iframe[src^="ar://"], ' +
              'audio > source[src^="ar://"], video > source[src^="ar://"], ' +
              'link[href^="ar://"], embed[src^="ar://"], object[data^="ar://"]',
          );

          childArElements.forEach((childElement) => {
            let arUrl: string | null = null;
            let attribute: string | null = null;

            switch (childElement.tagName) {
              case 'A':
                arUrl = (childElement as HTMLAnchorElement).href;
                attribute = 'href';
                break;
              case 'IMG':
                arUrl = (childElement as HTMLImageElement).src;
                attribute = 'src';
                break;
              // ... other cases similar to above
            }

            if (arUrl && attribute) {
              processArUrl(childElement, arUrl, attribute).catch((error) =>
                logger.error('Error processing child ar:// URL:', error),
              );
            }
          });
        }
      });
    });
  });

  // Start observing
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  logger.debug('Wayfinder Content Script: Initialization complete');
}
