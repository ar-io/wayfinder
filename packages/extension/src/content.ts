/**
 * WayFinder
 * Copyright (C) 2022-2025 Permanent Data Solutions, Inc. All Rights Reserved.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

import { logger } from './utils/logger';

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
        '🔄 <span style="margin-left: 2px;">Verifying</span>';
      indicator.title = 'Wayfinder: Verifying data integrity...';
      indicator.style.backgroundColor = '#f59e0b';
      indicator.style.color = 'white';
      // Add animation
      indicator.style.animation = 'wayfinder-pulse 1.5s infinite';
      break;
    case 'verified':
      indicator.innerHTML =
        '✅ <span style="margin-left: 2px;">Verified</span>';
      indicator.title = 'Wayfinder: Data integrity verified by AR.IO network';
      indicator.style.backgroundColor = '#10b981';
      indicator.style.color = 'white';
      break;
    case 'failed':
      indicator.innerHTML = '❌ <span style="margin-left: 2px;">Failed</span>';
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
  const { showVerificationIndicators = true } = await new Promise((resolve) => {
    chrome.storage.local.get(['showVerificationIndicators'], resolve);
  });

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

    // For transaction IDs, make a verified request to check data integrity
    const txIdMatch = arUrl.match(/^ar:\/\/([a-zA-Z0-9_-]{43})/);
    if (txIdMatch) {
      const txId = txIdMatch[1];

      try {
        // Show verification start notification
        showVerificationToast(
          `🔍 Verifying data for ${txId.substring(0, 8)}...`,
          'info',
        );

        // Make verified request for transaction data with timeout
        const verifyResponse = await withTimeout(
          new Promise<any>((resolve) => {
            chrome.runtime.sendMessage(
              {
                type: 'makeVerifiedRequest',
                url: arUrl,
                options: {}, // GET request to actually download and verify data
              },
              resolve,
            );
          }),
          15000, // 15 second timeout for verification (longer since we're downloading data)
          'Verification timed out',
        );

        if (showVerificationIndicators) {
          if (
            verifyResponse &&
            verifyResponse.success &&
            verifyResponse.response
          ) {
            const verification = verifyResponse.response.verification;

            if (verification && verification.verified) {
              addVerificationIndicator(element, 'verified');
              showVerificationToast(
                `✅ Data verified using ${verification.strategy} strategy`,
                'success',
              );
              logger.debug(
                `✅ Verified data integrity for ${txId} using ${verification.strategy}`,
              );
            } else {
              addVerificationIndicator(element, 'failed');
              showVerificationToast(
                `❌ Verification failed: ${verification?.error || 'Unknown error'}`,
                'error',
              );
              logger.warn(
                `❌ Verification failed for ${txId}:`,
                verification?.error || 'Unknown verification error',
              );
            }
          } else {
            addVerificationIndicator(element, 'failed');
            showVerificationToast(
              `❌ Verification request failed: ${verifyResponse?.error || 'Unknown error'}`,
              'error',
            );
            logger.warn(
              `❌ Verification request failed for ${txId}:`,
              verifyResponse?.error,
            );
          }
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
