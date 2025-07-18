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

// Toast container for verification messages
let toastContainer: HTMLDivElement | null = null;

/**
 * Create or get the toast container
 */
function getToastContainer(): HTMLDivElement {
  if (!toastContainer || !document.body.contains(toastContainer)) {
    toastContainer = document.createElement('div');
    toastContainer.id = 'wayfinder-toast-container';
    toastContainer.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 2147483647;
      pointer-events: none;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `;
    document.body.appendChild(toastContainer);
  }
  return toastContainer;
}

/**
 * Show verification toast
 */
function showVerificationToast(
  verified: boolean,
  gatewayFQDN: string,
  resolvedId?: string,
) {
  const container = getToastContainer();

  logger.info(
    `[CONTENT] Showing verification toast for ${gatewayFQDN}`,
    verified,
    resolvedId,
  );

  // Create toast element
  const toast = document.createElement('div');
  toast.className = 'wayfinder-verification-toast';

  // Since we only show verified toasts, use green styling
  const bgColor = '#10b981';
  const textColor = '#ffffff';
  const icon =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>';

  const message = `Remotely verified by ${gatewayFQDN}`;

  toast.style.cssText = `
    background-color: ${bgColor};
    color: ${textColor};
    padding: 12px 16px;
    border-radius: 8px;
    margin-bottom: 10px;
    display: flex;
    align-items: center;
    gap: 10px;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    max-width: 350px;
    font-size: 14px;
    line-height: 1.5;
    pointer-events: auto;
    animation: wayfinder-slide-in 0.3s ease-out;
    cursor: pointer;
  `;

  toast.innerHTML = `
    <div style="flex-shrink: 0;">${icon}</div>
    <div style="flex: 1;">
      <div style="font-weight: 500;">${message}</div>
      ${resolvedId ? `<div style="font-size: 12px; opacity: 0.9; margin-top: 2px;">ID: ${resolvedId.substring(0, 8)}...</div>` : ''}
    </div>
    <a href="https://docs.ar.io/guides/wayfinder" target="_blank" rel="noopener" style="color: ${textColor}; opacity: 0.8; text-decoration: none; flex-shrink: 0;" title="Learn more about AR.IO verification">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
    </a>
  `;

  // Add click to dismiss
  toast.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).tagName !== 'A') {
      toast.style.animation = 'wayfinder-slide-out 0.3s ease-in forwards';
      setTimeout(() => toast.remove(), 300);
    }
  });

  container.appendChild(toast);

  // Auto-dismiss after 4 seconds
  setTimeout(() => {
    if (toast.parentNode) {
      toast.style.animation = 'wayfinder-slide-out 0.3s ease-in forwards';
      setTimeout(() => toast.remove(), 300);
    }
  }, 4000);
}

// Add CSS animations
const style = document.createElement('style');
style.textContent = `
  @keyframes wayfinder-slide-in {
    from {
      transform: translateX(100%);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }
  
  @keyframes wayfinder-slide-out {
    from {
      transform: translateX(0);
      opacity: 1;
    }
    to {
      transform: translateX(100%);
      opacity: 0;
    }
  }
  
  .wayfinder-verification-toast a:hover {
    opacity: 1 !important;
  }
`;
document.head.appendChild(style);

// Listen for verification messages from background script
chrome.runtime.onMessage.addListener((message) => {
  console.log('message received', message);
  if (message.type === 'showVerificationToast') {
    console.error(message);
    showVerificationToast(
      message.verified,
      message.gatewayFQDN,
      message.resolvedId,
    );
  }
});

// Content script initialization
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', afterContentDOMLoaded);
} else {
  afterContentDOMLoaded();
}

/**
 * Process ar:// URLs
 */
async function processArUrl(
  element: Element,
  arUrl: string,
  attribute: string,
): Promise<void> {
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
  } catch (error: any) {
    logger.error(
      `[CONTENT] Failed to process ${arUrl}:`,
      error.message || error,
    );
  }
}

/**
 * Main content script initialization
 */
async function afterContentDOMLoaded(): Promise<void> {
  // Processing ar:// URLs

  // Gather all elements with `ar://` protocol
  const arElements = document.querySelectorAll(
    'a[href^="ar://"], img[src^="ar://"], iframe[src^="ar://"], ' +
      'audio > source[src^="ar://"], video > source[src^="ar://"], ' +
      'link[href^="ar://"], embed[src^="ar://"], object[data^="ar://"]',
  );

  // Found ar:// elements to process

  // Process each element
  for (const element of Array.from(arElements)) {
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
      // Process each URL
      processArUrl(element, arUrl, attribute).catch((error) =>
        logger.error('[CONTENT] Error:', error.message || error),
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
                logger.error(
                  '[CONTENT] Dynamic error:',
                  error.message || error,
                ),
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
                logger.error('[CONTENT] Child error:', error.message || error),
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
}
