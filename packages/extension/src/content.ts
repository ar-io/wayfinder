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
  } catch (error) {
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

  // Content script initialized
}
