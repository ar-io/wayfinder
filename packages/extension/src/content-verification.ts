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

export interface VerificationResult {
  verified: boolean;
  strategy: string;
  confidence: 'high' | 'medium' | 'low' | 'none';
  details?: any;
  error?: string;
}

/**
 * Verify HTML content by comparing DOM fingerprints
 * This is not cryptographically secure but provides some validation
 */
export async function verifyHTMLContent(
  expectedDigest?: string,
): Promise<VerificationResult> {
  try {
    logger.info('[VERIFY-HTML] Starting HTML content verification');

    // Strategy 1: DOM Fingerprinting
    const fingerprint = await generateDOMFingerprint();

    // Strategy 2: Meta tag injection check
    const metaVerification = checkVerificationMeta();

    // Strategy 3: Content characteristics
    const characteristics = await analyzeContentCharacteristics();

    logger.info('[VERIFY-HTML] Fingerprint generated', {
      fingerprint,
      characteristics,
      metaVerification,
    });

    // If we have an expected digest and a meta tag with actual digest, compare them
    if (expectedDigest && metaVerification.actualDigest) {
      const verified = expectedDigest === metaVerification.actualDigest;
      return {
        verified,
        strategy: 'meta-tag-digest',
        confidence: verified ? 'high' : 'none',
        details: {
          expectedDigest,
          actualDigest: metaVerification.actualDigest,
          fingerprint,
          characteristics,
        },
      };
    }

    // Otherwise, we can only do fuzzy verification
    return {
      verified: false,
      strategy: 'dom-fingerprint',
      confidence: 'low',
      details: {
        fingerprint,
        characteristics,
        reason: 'Cannot verify without access to original response body',
      },
    };
  } catch (error) {
    logger.error('[VERIFY-HTML] Error during verification:', error);
    return {
      verified: false,
      strategy: 'html-verification',
      confidence: 'none',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Generate a fingerprint of the DOM structure
 */
async function generateDOMFingerprint(): Promise<string> {
  const elements = {
    total: document.getElementsByTagName('*').length,
    scripts: document.scripts.length,
    stylesheets: document.styleSheets.length,
    images: document.images.length,
    links: document.links.length,
    forms: document.forms.length,
    iframes: document.getElementsByTagName('iframe').length,
  };

  // Get text content length (excluding scripts and styles)
  const textContent = document.body?.innerText || '';
  const textLength = textContent.length;

  // Get structural hash (simplified)
  const structure = Array.from(document.body?.children || [])
    .map((el) => `${el.tagName}:${el.children.length}`)
    .join(',');

  const fingerprint = {
    elements,
    textLength,
    structure: structure.substring(0, 100), // First 100 chars
    title: document.title,
    url: window.location.href,
    timestamp: Date.now(),
  };

  // Create a simple hash of the fingerprint
  const fingerprintStr = JSON.stringify(fingerprint);
  const encoder = new TextEncoder();
  const data = encoder.encode(fingerprintStr);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return hashHex.substring(0, 16); // First 16 chars of hash
}

/**
 * Check for verification meta tags injected by gateway
 */
function checkVerificationMeta(): { exists: boolean; actualDigest?: string } {
  const metaTags = document.getElementsByTagName('meta');

  for (const meta of metaTags) {
    if (meta.name === 'x-ar-io-digest' || meta.name === 'ar-io-digest') {
      return {
        exists: true,
        actualDigest: meta.content,
      };
    }
  }

  // Check for verification data in comments
  const walker = document.createTreeWalker(
    document.documentElement,
    NodeFilter.SHOW_COMMENT,
    null,
  );

  let node;
  while ((node = walker.nextNode())) {
    const comment = node.textContent || '';
    if (comment.includes('x-ar-io-digest:')) {
      const match = comment.match(/x-ar-io-digest:\s*([a-zA-Z0-9+/=]+)/);
      if (match) {
        return {
          exists: true,
          actualDigest: match[1],
        };
      }
    }
  }

  return { exists: false };
}

/**
 * Analyze content characteristics for verification
 */
async function analyzeContentCharacteristics() {
  return {
    doctype: document.doctype?.name || 'none',
    charset: document.characterSet,
    contentLength: document.documentElement.outerHTML.length,
    hasArweaveRefs: checkArweaveReferences(),
    contentSecurityPolicy: getCSPInfo(),
    timing: getTimingInfo(),
  };
}

/**
 * Check for Arweave-specific references in the content
 */
function checkArweaveReferences(): boolean {
  const html = document.documentElement.outerHTML;
  return (
    html.includes('arweave') ||
    html.includes('ar://') ||
    html.includes('ar.io') ||
    html.includes('permaweb')
  );
}

/**
 * Get Content Security Policy information
 */
function getCSPInfo() {
  const cspMeta = document.querySelector(
    'meta[http-equiv="Content-Security-Policy"]',
  );
  return {
    exists: !!cspMeta,
    content: cspMeta?.getAttribute('content') || null,
  };
}

/**
 * Get timing information
 */
function getTimingInfo() {
  const navigation = performance.getEntriesByType(
    'navigation',
  )[0] as PerformanceNavigationTiming;
  if (!navigation) return null;

  return {
    responseEnd: navigation.responseEnd,
    domComplete: navigation.domComplete,
    loadEventEnd: navigation.loadEventEnd,
    transferSize: navigation.transferSize,
    encodedBodySize: navigation.encodedBodySize,
    decodedBodySize: navigation.decodedBodySize,
  };
}

/**
 * Verify image content using canvas fingerprinting
 */
export async function verifyImageContent(
  imgElement: HTMLImageElement,
  _expectedDigest?: string,
): Promise<VerificationResult> {
  try {
    logger.info('[VERIFY-IMAGE] Starting image verification');

    // Create canvas and draw image
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      throw new Error('Cannot create canvas context');
    }

    canvas.width = imgElement.naturalWidth;
    canvas.height = imgElement.naturalHeight;
    ctx.drawImage(imgElement, 0, 0);

    // Get image data
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    // Create a hash of image data (simplified - sample pixels)
    const pixelSample = samplePixels(imageData);
    const encoder = new TextEncoder();
    const data = encoder.encode(JSON.stringify(pixelSample));
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const imageHash = hashArray
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    logger.info('[VERIFY-IMAGE] Image fingerprint generated', {
      dimensions: `${canvas.width}x${canvas.height}`,
      hash: imageHash.substring(0, 16),
    });

    return {
      verified: false, // We can't truly verify without original bytes
      strategy: 'canvas-fingerprint',
      confidence: 'low',
      details: {
        width: canvas.width,
        height: canvas.height,
        fingerprint: imageHash.substring(0, 16),
        reason:
          'Canvas fingerprinting provides identity verification, not integrity',
      },
    };
  } catch (error) {
    logger.error('[VERIFY-IMAGE] Error during verification:', error);
    return {
      verified: false,
      strategy: 'image-verification',
      confidence: 'none',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Sample pixels from image data for fingerprinting
 */
function samplePixels(imageData: ImageData): number[] {
  const samples: number[] = [];
  const data = imageData.data;
  const step = Math.floor(data.length / 1000); // Sample 1000 pixels

  for (let i = 0; i < data.length; i += step * 4) {
    samples.push(data[i], data[i + 1], data[i + 2], data[i + 3]);
  }

  return samples;
}

/**
 * Attempt to verify content based on size and headers
 */
export async function verifySizeAndMetadata(
  expectedSize?: number,
  _expectedType?: string,
): Promise<VerificationResult> {
  try {
    const timing = performance.getEntriesByType(
      'navigation',
    )[0] as PerformanceNavigationTiming;

    if (!timing) {
      return {
        verified: false,
        strategy: 'size-metadata',
        confidence: 'none',
        error: 'No timing information available',
      };
    }

    const actualSize = timing.encodedBodySize;
    const transferSize = timing.transferSize;

    logger.info('[VERIFY-SIZE] Size verification', {
      expectedSize,
      actualSize,
      transferSize,
    });

    // If we have expected size, compare
    if (expectedSize && actualSize) {
      const sizeDiff = Math.abs(actualSize - expectedSize);
      const tolerance = expectedSize * 0.01; // 1% tolerance for compression differences

      if (sizeDiff <= tolerance) {
        return {
          verified: true,
          strategy: 'size-match',
          confidence: 'medium',
          details: {
            expectedSize,
            actualSize,
            difference: sizeDiff,
            withinTolerance: true,
          },
        };
      }
    }

    return {
      verified: false,
      strategy: 'size-metadata',
      confidence: 'low',
      details: {
        actualSize,
        transferSize,
        reason: 'Size verification alone is not sufficient',
      },
    };
  } catch (error) {
    logger.error('[VERIFY-SIZE] Error during verification:', error);
    return {
      verified: false,
      strategy: 'size-verification',
      confidence: 'none',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Main verification orchestrator
 */
export async function verifyLoadedContent(
  contentType: string,
  expectedDigest?: string,
  expectedSize?: number,
): Promise<VerificationResult> {
  logger.info('[VERIFY] Starting content verification', {
    contentType,
    hasExpectedDigest: !!expectedDigest,
    hasExpectedSize: !!expectedSize,
  });

  // Route to appropriate verification strategy
  if (contentType.includes('text/html')) {
    return verifyHTMLContent(expectedDigest);
  } else if (contentType.includes('image/')) {
    // Find first image in page
    const img = document.querySelector('img');
    if (img) {
      return verifyImageContent(img as HTMLImageElement, expectedDigest);
    }
  }

  // Fallback to size verification
  return verifySizeAndMetadata(expectedSize, contentType);
}

/**
 * Install verification handler in content script
 */
export function installVerificationHandler() {
  // Listen for verification requests from background
  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request.type === 'VERIFY_LOADED_CONTENT') {
      verifyLoadedContent(
        request.contentType || 'text/html',
        request.expectedDigest,
        request.expectedSize,
      ).then((result) => {
        sendResponse(result);
      });
      return true; // Keep channel open for async response
    }
  });

  // Auto-verify on page load if configured
  window.addEventListener('load', async () => {
    const { enableContentVerification, showVerificationToasts } =
      await chrome.storage.local.get([
        'enableContentVerification',
        'showVerificationToasts',
      ]);

    if (enableContentVerification) {
      // Check if this page was loaded via ar://
      const isArweaveContent =
        window.location.hostname.includes('arweave') ||
        document.querySelector('meta[name="x-ar-io-digest"]') !== null;

      if (isArweaveContent) {
        const result = await verifyLoadedContent('text/html');

        logger.info('[VERIFY] Page verification result:', result);

        // Show toast if enabled
        if (showVerificationToasts && result.confidence !== 'none') {
          showVerificationToast(
            `Content verification: ${result.confidence} confidence`,
            result.verified ? 'info' : 'warning',
          );
        }
      }
    }
  });
}

/**
 * Show verification toast (reuse from content.ts)
 */
function showVerificationToast(
  message: string,
  type: 'success' | 'error' | 'info' | 'warning' = 'info',
) {
  const toast = document.createElement('div');
  const bgColor = {
    success: '#10b981',
    error: '#ef4444',
    info: '#3b82f6',
    warning: '#f59e0b',
  }[type];

  toast.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: ${bgColor};
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
  }, 5000);
}
