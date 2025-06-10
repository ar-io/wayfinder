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
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', afterContentDOMLoaded);
} else {
  afterContentDOMLoaded();
}

async function afterContentDOMLoaded() {
  // Gather all elements with `ar://` protocol
  const arElements = document.querySelectorAll(
    'a[href^="ar://"], img[src^="ar://"], iframe[src^="ar://"], ' +
      'audio > source[src^="ar://"], video > source[src^="ar://"], ' +
      'link[href^="ar://"], embed[src^="ar://"], object[data^="ar://"]',
  );

  arElements.forEach((element) => {
    let arUrl: string | null = null;
    switch (element.tagName) {
      case 'A':
        arUrl = (element as HTMLAnchorElement).href;
        chrome.runtime.sendMessage(
          { type: 'convertArUrlToHttpUrl', arUrl },
          (response) => {
            if (response && response.url) {
              (element as HTMLAnchorElement).href = response.url;
            } else {
              console.error(`Failed to load URL: ${response.error}`);
            }
          },
        );
        break;
      case 'IMG':
        arUrl = (element as HTMLImageElement).src;
        chrome.runtime.sendMessage(
          { type: 'convertArUrlToHttpUrl', arUrl },
          (response) => {
            if (response && response.url) {
              (element as HTMLImageElement).src = response.url;
            } else {
              console.error(`Failed to load image: ${response.error}`);
            }
          },
        );
        break;
      case 'IFRAME':
        arUrl = (element as HTMLIFrameElement).src;
        chrome.runtime.sendMessage(
          { type: 'convertArUrlToHttpUrl', arUrl },
          (response) => {
            if (response && response.url) {
              (element as HTMLIFrameElement).src = response.url;
            } else {
              console.error(`Failed to load iframe: ${response.error}`);
            }
          },
        );
        break;
      case 'SOURCE':
        arUrl = (element as HTMLSourceElement).src;
        if (
          element.parentNode &&
          element.parentNode.nodeType === Node.ELEMENT_NODE
        ) {
          const parentElement = element.parentNode as HTMLMediaElement;
          if (
            parentElement.tagName === 'AUDIO' ||
            parentElement.tagName === 'VIDEO'
          ) {
            chrome.runtime.sendMessage(
              { type: 'convertArUrlToHttpUrl', arUrl },
              (response) => {
                if (response && response.url) {
                  (element as HTMLSourceElement).src = response.url;
                  parentElement.load(); // Load the media element with the new source
                } else {
                  console.error(`Failed to load source: ${response.error}`);
                }
              },
            );
          } else {
            console.error('Unexpected parent for source element', element);
          }
        }
        break;
      case 'LINK':
        arUrl = (element as HTMLLinkElement).href;
        chrome.runtime.sendMessage(
          { type: 'convertArUrlToHttpUrl', arUrl },
          (response) => {
            if (response && response.url) {
              // Create a clone of the original element
              const newLinkEl = element.cloneNode(true) as HTMLLinkElement;

              // Set the new URL to the cloned element
              newLinkEl.href = response.url;

              // Replace the old link element with the new one
              if (element.parentNode) {
                element.parentNode.replaceChild(newLinkEl, element);
              }
            } else {
              console.error(`Failed to load link element: ${response.error}`);
            }
          },
        );
        break;
      case 'EMBED':
        arUrl = (element as HTMLEmbedElement).src;
        chrome.runtime.sendMessage(
          { type: 'convertArUrlToHttpUrl', arUrl },
          (response) => {
            if (response && response.url) {
              (element as HTMLEmbedElement).src = response.url; // Set the new URL
            } else {
              console.error(`Failed to load embed element: ${response.error}`);
            }
          },
        );
        break;
      case 'OBJECT':
        arUrl = (element as HTMLObjectElement).data;
        chrome.runtime.sendMessage(
          { type: 'convertArUrlToHttpUrl', arUrl },
          (response) => {
            if (response && response.url) {
              (element as HTMLObjectElement).data = response.url; // Set the new URL
            } else {
              console.error(`Failed to load object: ${response.error}`);
            }
          },
        );
        break;
      default:
        console.error('Unexpected element', element);
    }
  });
}
