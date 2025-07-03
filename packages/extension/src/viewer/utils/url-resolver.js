/**
 * URL Resolution Utilities for Arweave Content
 * 
 * Handles URL resolution, validation, and classification for:
 * - Arweave URLs (ar://)
 * - Gateway URLs (https://gateway.com/txid)
 * - Relative paths within manifests
 * - External resource detection
 */

/**
 * Resolve a URL against a base Arweave URL
 * @param {string} url - URL to resolve (relative or absolute)
 * @param {string} baseArUrl - Base ar:// URL for resolution context
 * @returns {string} Resolved URL
 */
export function resolveUrl(url, baseArUrl) {
  // If it's already a full URL, return as-is
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('chrome-extension://') || url.startsWith('ar://')) {
    return url;
  }
  
  // For relative URLs, resolve against the base AR URL
  if (baseArUrl) {
    const urlParts = baseArUrl.replace('ar://', '').split('/');
    const baseIdentifier = urlParts[0];
    
    // Check if base identifier is a transaction ID (43 chars, base64url) or ArNS name
    const isTransactionId = /^[a-zA-Z0-9_-]{43}$/.test(baseIdentifier);
    
    if (url.startsWith('/')) {
      // Root-relative URL
      return `ar://${baseIdentifier}${url}`;
    } else {
      // Document-relative URL
      if (isTransactionId) {
        // For transaction IDs, relative paths don't make sense in most cases
        // Just append to the base
        return `ar://${baseIdentifier}/${url}`;
      } else {
        // For ArNS names, resolve relative to current directory
        // If we're at ar://mysite/path/to/file.html and have "./script.js"
        // Result should be ar://mysite/path/to/script.js
        if (urlParts.length > 1) {
          // Remove the current filename to get the directory path
          const directoryParts = urlParts.slice(0, -1);
          return `ar://${directoryParts.join('/')}/${url}`;
        } else {
          // At root level
          return `ar://${baseIdentifier}/${url}`;
        }
      }
    }
  }
  
  return url;
}

/**
 * Determine if a URL points to an external (non-Arweave) resource
 * 
 * This function uses transaction ID detection rather than gateway domain checking
 * because there are hundreds of ar.io gateways with different domains.
 * 
 * @param {string} url - URL to check
 * @returns {boolean} True if the URL is external to Arweave ecosystem
 * 
 * @example
 * isExternalResource('https://permagate.io/Sie_26dvgyok0PZD_-iQAFOhOd5YxDTkczOLo') // false (has txId)
 * isExternalResource('https://vilenarios.com/xg0vnfL0R3OZ6hCQMbcKVfkwSuqFp1K1FgJktNqQUXk') // false (has txId)
 * isExternalResource('https://cdn.tailwindcss.com/3.0.0') // true (external CDN)
 * isExternalResource('ar://Sie_26dvgyok0PZD_-iQAFOhOd5YxDTkczOLo/image.png') // false (ar:// protocol)
 */
export function isExternalResource(url) {
  if (url.startsWith('data:') || url.startsWith('blob:')) return false;
  if (url.startsWith('chrome-extension:')) return false;
  if (url.startsWith('ar://')) return false; // Arweave URLs are not external
  
  // Check if URL contains an Arweave transaction ID (43 character base64url)
  // This works for any gateway, not just hardcoded ones
  const txIdPattern = /\/([a-zA-Z0-9_-]{43})(?:\/|$)/;
  if (txIdPattern.test(url)) {
    return false; // URLs with transaction IDs are Arweave resources
  }
  
  // Special case for well-known Arweave gateways (fallback)
  // Only check arweave.net and ar.io as you mentioned
  if (url.includes('arweave.net/') || url.includes('ar.io/')) {
    return false;
  }
  
  // Relative URLs on an Arweave page are considered Arweave resources
  if (!url.match(/^https?:\/\//)) {
    return false;
  }
  
  return true; // Everything else is external
}

/**
 * Validate if a string is a valid Arweave transaction ID
 * @param {string} txId - Transaction ID to validate
 * @returns {boolean} True if valid transaction ID format
 */
export function isValidTransactionId(txId) {
  return /^[a-zA-Z0-9_-]{43}$/.test(txId);
}

/**
 * Extract transaction ID from various URL formats
 * @param {string} url - URL that may contain a transaction ID
 * @returns {string|null} Transaction ID if found, null otherwise
 */
export function extractTransactionId(url) {
  // ar://txid or ar://txid/path
  if (url.startsWith('ar://')) {
    const path = url.replace('ar://', '');
    const txId = path.split('/')[0];
    return isValidTransactionId(txId) ? txId : null;
  }
  
  // https://gateway.com/txid or https://gateway.com/txid/path
  const gatewayMatch = url.match(/^https?:\/\/[^\/]+\/([a-zA-Z0-9_-]{43})/);
  if (gatewayMatch) {
    return gatewayMatch[1];
  }
  
  // Direct transaction ID
  if (isValidTransactionId(url)) {
    return url;
  }
  
  return null;
}

/**
 * Convert an ar:// URL to a gateway URL
 * @param {string} arUrl - Arweave URL (ar://...)
 * @param {string} gatewayBase - Gateway base URL (e.g., "https://arweave.net")
 * @returns {string} Gateway URL
 */
export function arUrlToGatewayUrl(arUrl, gatewayBase = 'https://arweave.net') {
  if (!arUrl.startsWith('ar://')) {
    throw new Error('Invalid ar:// URL');
  }
  
  const path = arUrl.replace('ar://', '');
  return `${gatewayBase.replace(/\/$/, '')}/${path}`;
}

/**
 * Convert a gateway URL to an ar:// URL
 * @param {string} gatewayUrl - Gateway URL
 * @returns {string|null} ar:// URL if conversion possible, null otherwise
 */
export function gatewayUrlToArUrl(gatewayUrl) {
  const txId = extractTransactionId(gatewayUrl);
  if (!txId) return null;
  
  // Extract path after transaction ID
  const match = gatewayUrl.match(/^https?:\/\/[^\/]+\/[a-zA-Z0-9_-]{43}(\/.*)?$/);
  const path = match && match[1] ? match[1] : '';
  
  return `ar://${txId}${path}`;
}

/**
 * Check if URL is a valid ar:// URL
 * @param {string} url - URL to validate
 * @returns {boolean} True if valid ar:// URL
 */
export function isValidArUrl(url) {
  if (!url.startsWith('ar://')) return false;
  
  const path = url.replace('ar://', '');
  const parts = path.split('/');
  
  // Must have at least a transaction ID or ArNS name
  if (parts.length === 0 || !parts[0]) return false;
  
  // First part should be either a valid transaction ID or a valid ArNS name
  const identifier = parts[0];
  return isValidTransactionId(identifier) || isValidArnsName(identifier);
}

/**
 * Check if a string is a valid ArNS name
 * @param {string} name - ArNS name to validate
 * @returns {boolean} True if valid ArNS name format
 */
export function isValidArnsName(name) {
  // ArNS names are typically lowercase alphanumeric with hyphens
  // Length between 1-63 characters (DNS-like rules)
  return /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(name);
}