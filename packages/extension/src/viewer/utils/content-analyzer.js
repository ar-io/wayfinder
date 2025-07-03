/**
 * Content Analysis Utilities for HTML and Resource Detection
 * 
 * Provides utilities for:
 * - HTML resource extraction (scripts, stylesheets, images)
 * - Resource type classification
 * - Arweave resource detection
 * - Content type analysis
 */

import { resolveUrl, isExternalResource } from './url-resolver.js';

/**
 * Resource types supported by the analyzer
 */
export const RESOURCE_TYPES = {
  SCRIPT: 'script',
  STYLESHEET: 'stylesheet',
  IMAGE: 'image',
  FONT: 'font',
  MEDIA: 'media',
  DOCUMENT: 'document',
  OTHER: 'other'
};

/**
 * Extract all resources from HTML content
 * @param {string} htmlContent - HTML content to analyze
 * @param {string} baseArUrl - Base ar:// URL for resolving relative URLs
 * @param {Function} isExternalFn - Function to check if URL is external (optional)
 * @returns {Array} Array of resource objects
 */
export function extractResourcesFromHtml(htmlContent, baseArUrl = null, isExternalFn = isExternalResource) {
  const resources = [];
  
  // Extract scripts
  const scripts = extractScripts(htmlContent, baseArUrl, isExternalFn);
  resources.push(...scripts);
  
  // Extract stylesheets
  const stylesheets = extractStylesheets(htmlContent, baseArUrl, isExternalFn);
  resources.push(...stylesheets);
  
  // Extract images
  const images = extractImages(htmlContent, baseArUrl, isExternalFn);
  resources.push(...images);
  
  // Extract fonts (from CSS @font-face and link tags)
  const fonts = extractFonts(htmlContent, baseArUrl, isExternalFn);
  resources.push(...fonts);
  
  return resources;
}

/**
 * Extract script resources from HTML
 * @param {string} htmlContent - HTML content
 * @param {string} baseArUrl - Base URL for resolution
 * @param {Function} isExternalFn - External resource checker
 * @returns {Array} Script resource objects
 */
export function extractScripts(htmlContent, baseArUrl = null, isExternalFn = isExternalResource) {
  const resources = [];
  const scriptRegex = /<script[^>]+src=["']([^"']+)["']/gi;
  let match;
  
  while ((match = scriptRegex.exec(htmlContent)) !== null) {
    const src = match[1];
    const fullUrl = baseArUrl ? resolveUrl(src, baseArUrl) : src;
    
    // Skip chrome-extension URLs (our proxy system)
    if (fullUrl.startsWith('chrome-extension:')) {
      continue;
    }
    
    const isExternal = isExternalFn(fullUrl);
    
    resources.push({
      url: fullUrl,
      originalUrl: src,
      type: RESOURCE_TYPES.SCRIPT,
      status: isExternal ? 'skipped' : 'pending',
      reason: isExternal ? 'External CDN resource' : null,
      isExternal
    });
  }
  
  return resources;
}

/**
 * Extract stylesheet resources from HTML
 * @param {string} htmlContent - HTML content
 * @param {string} baseArUrl - Base URL for resolution
 * @param {Function} isExternalFn - External resource checker
 * @returns {Array} Stylesheet resource objects
 */
export function extractStylesheets(htmlContent, baseArUrl = null, isExternalFn = isExternalResource) {
  const resources = [];
  const linkRegex = /<link[^>]+rel=["']stylesheet["'][^>]+href=["']([^"']+)["']/gi;
  let match;
  
  while ((match = linkRegex.exec(htmlContent)) !== null) {
    const href = match[1];
    const fullUrl = baseArUrl ? resolveUrl(href, baseArUrl) : href;
    
    // Skip chrome-extension URLs
    if (fullUrl.startsWith('chrome-extension:')) {
      continue;
    }
    
    const isExternal = isExternalFn(fullUrl);
    
    resources.push({
      url: fullUrl,
      originalUrl: href,
      type: RESOURCE_TYPES.STYLESHEET,
      status: isExternal ? 'skipped' : 'pending',
      reason: isExternal ? 'External CDN resource' : null,
      isExternal
    });
  }
  
  return resources;
}

/**
 * Extract image resources from HTML
 * @param {string} htmlContent - HTML content
 * @param {string} baseArUrl - Base URL for resolution
 * @param {Function} isExternalFn - External resource checker
 * @returns {Array} Image resource objects
 */
export function extractImages(htmlContent, baseArUrl = null, isExternalFn = isExternalResource) {
  const resources = [];
  const imgRegex = /<img[^>]+src=["']([^"']+)["']/gi;
  let match;
  
  while ((match = imgRegex.exec(htmlContent)) !== null) {
    const src = match[1];
    const fullUrl = baseArUrl ? resolveUrl(src, baseArUrl) : src;
    
    // Skip chrome-extension URLs and data URLs
    if (fullUrl.startsWith('chrome-extension:') || fullUrl.startsWith('data:')) {
      continue;
    }
    
    const isExternal = isExternalFn(fullUrl);
    
    resources.push({
      url: fullUrl,
      originalUrl: src,
      type: RESOURCE_TYPES.IMAGE,
      status: isExternal ? 'skipped' : 'pending',
      reason: isExternal ? 'External resource' : null,
      isExternal
    });
  }
  
  return resources;
}

/**
 * Extract font resources from HTML
 * @param {string} htmlContent - HTML content
 * @param {string} baseArUrl - Base URL for resolution
 * @param {Function} isExternalFn - External resource checker
 * @returns {Array} Font resource objects
 */
export function extractFonts(htmlContent, baseArUrl = null, isExternalFn = isExternalResource) {
  const resources = [];
  
  // Extract from link tags with rel="preload" as="font"
  const fontLinkRegex = /<link[^>]+rel=["']preload["'][^>]+as=["']font["'][^>]+href=["']([^"']+)["']/gi;
  let match;
  
  while ((match = fontLinkRegex.exec(htmlContent)) !== null) {
    const href = match[1];
    const fullUrl = baseArUrl ? resolveUrl(href, baseArUrl) : href;
    
    if (fullUrl.startsWith('chrome-extension:')) {
      continue;
    }
    
    const isExternal = isExternalFn(fullUrl);
    
    resources.push({
      url: fullUrl,
      originalUrl: href,
      type: RESOURCE_TYPES.FONT,
      status: isExternal ? 'skipped' : 'pending',
      reason: isExternal ? 'External font resource' : null,
      isExternal
    });
  }
  
  return resources;
}

/**
 * Guess resource type from URL file extension
 * @param {string} url - URL to analyze
 * @returns {string} Resource type
 */
export function guessResourceType(url) {
  const ext = url.split('.').pop()?.toLowerCase();
  
  if (['js', 'mjs', 'jsx', 'ts', 'tsx'].includes(ext)) return RESOURCE_TYPES.SCRIPT;
  if (['css', 'scss', 'sass', 'less'].includes(ext)) return RESOURCE_TYPES.STYLESHEET;
  if (['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'avif', 'ico'].includes(ext)) return RESOURCE_TYPES.IMAGE;
  if (['woff', 'woff2', 'ttf', 'otf', 'eot'].includes(ext)) return RESOURCE_TYPES.FONT;
  if (['mp4', 'webm', 'avi', 'mov', 'mp3', 'wav', 'ogg'].includes(ext)) return RESOURCE_TYPES.MEDIA;
  if (['html', 'htm'].includes(ext)) return RESOURCE_TYPES.DOCUMENT;
  
  return RESOURCE_TYPES.OTHER;
}

/**
 * Guess resource type from MIME content type
 * @param {string} contentType - MIME type
 * @returns {string} Resource type
 */
export function guessResourceTypeFromContentType(contentType) {
  if (!contentType) return RESOURCE_TYPES.OTHER;
  
  const type = contentType.toLowerCase();
  
  if (type.includes('javascript') || type.includes('js')) {
    return RESOURCE_TYPES.SCRIPT;
  }
  if (type.includes('css')) {
    return RESOURCE_TYPES.STYLESHEET;
  }
  if (type.startsWith('image/')) {
    return RESOURCE_TYPES.IMAGE;
  }
  if (type.startsWith('video/') || type.startsWith('audio/')) {
    return RESOURCE_TYPES.MEDIA;
  }
  if (type.includes('font') || type.includes('woff')) {
    return RESOURCE_TYPES.FONT;
  }
  if (type.includes('html')) {
    return RESOURCE_TYPES.DOCUMENT;
  }
  
  return RESOURCE_TYPES.OTHER;
}

/**
 * Check if HTML content contains Arweave resources
 * @param {string} htmlContent - HTML content to analyze
 * @param {Function} isExternalFn - Function to check if URL is external
 * @returns {boolean} True if Arweave resources are found
 */
export function containsArweaveResources(htmlContent, isExternalFn = isExternalResource) {
  // Extract URLs from common HTML attributes
  const urlPatterns = [
    /src=["']([^"']+)["']/gi,
    /href=["']([^"']+)["']/gi,
    /url\(["']?([^"')]+)["']?\)/gi
  ];
  
  for (const pattern of urlPatterns) {
    let match;
    while ((match = pattern.exec(htmlContent)) !== null) {
      const url = match[1];
      
      // Skip data: and blob: URLs
      if (url.startsWith('data:') || url.startsWith('blob:')) {
        continue;
      }
      
      // Relative URLs are considered Arweave resources (they'll be resolved later)
      if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('chrome-extension://')) {
        return true;
      }
      
      // Check if absolute URL is an Arweave resource
      if (!isExternalFn(url)) {
        return true;
      }
    }
  }
  
  return false;
}

/**
 * Check if HTML content has external or inline scripts
 * @param {string} htmlContent - HTML content to analyze
 * @returns {Object} Object with hasExternalScripts and hasInlineScripts flags
 */
export function analyzeScripts(htmlContent) {
  // Extract all script sources
  const scriptRegex = /<script[^>]+src=["']([^"']+)["']/gi;
  const scripts = [];
  let match;
  
  while ((match = scriptRegex.exec(htmlContent)) !== null) {
    scripts.push(match[1]);
  }
  
  // Check if any scripts are from external domains (not Arweave)
  const hasExternalScripts = scripts.some(src => {
    // Check if it's an external URL (not ar://, not relative, not arweave.net)
    return isExternalResource(src);
  });
  
  const hasInlineScripts = /<script(?![^>]+src=).*?>/i.test(htmlContent);
  
  return {
    hasExternalScripts,
    hasInlineScripts,
    hasAnyScripts: scripts.length > 0 || hasInlineScripts,
    scripts // Return the list for debugging
  };
}

/**
 * Get a summary of all resources in HTML content
 * @param {string} htmlContent - HTML content to analyze
 * @param {string} baseArUrl - Base URL for resolution
 * @param {Function} isExternalFn - External resource checker
 * @returns {Object} Resource summary with counts by type
 */
export function getResourceSummary(htmlContent, baseArUrl = null, isExternalFn = isExternalResource) {
  const resources = extractResourcesFromHtml(htmlContent, baseArUrl, isExternalFn);
  
  const summary = {
    total: resources.length,
    byType: {},
    byStatus: {
      pending: 0,
      skipped: 0
    },
    arweaveResources: 0,
    externalResources: 0
  };
  
  // Initialize type counts
  Object.values(RESOURCE_TYPES).forEach(type => {
    summary.byType[type] = 0;
  });
  
  // Count resources
  resources.forEach(resource => {
    summary.byType[resource.type]++;
    summary.byStatus[resource.status]++;
    
    if (resource.isExternal) {
      summary.externalResources++;
    } else {
      summary.arweaveResources++;
    }
  });
  
  return {
    ...summary,
    resources
  };
}