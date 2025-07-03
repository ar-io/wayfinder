/**
 * Arweave Manifest Renderer
 * 
 * Implements a complete manifest-based rendering system that:
 * 1. Parses Arweave manifests according to v0.2.0 spec
 * 2. Pre-fetches and verifies ALL resources using Wayfinder Core
 * 3. Renders content with verified blob URLs
 */
class ManifestRenderer {
  constructor() {
    this.manifest = null;
    this.verifiedResources = new Map(); // path -> {blob, url, verified}
    this.verificationProgress = {
      total: 0,
      completed: 0,
      verified: 0,
      failed: 0
    };
    this.resourceCache = new Map(); // transaction ID -> verified blob
    this.loadingStrategy = null; // Will be determined based on manifest size
  }

  /**
   * Analyze manifest and determine optimal loading strategy
   * @param {Object} manifest - Parsed manifest object
   * @returns {Object} Strategy configuration
   */
  analyzeManifest(manifest) {
    const resourceCount = Object.keys(manifest.paths).length;
    const criticalResources = this.identifyCriticalResources(manifest);
    
    let strategy;
    let showWarning = false;
    let estimatedSize = resourceCount * 50; // rough estimate in KB
    
    if (resourceCount <= 5) {
      strategy = 'instant';
    } else if (resourceCount <= 25) {
      strategy = 'full-prefetch';
    } else if (resourceCount <= 100) {
      strategy = 'critical-first';
    } else {
      strategy = 'progressive';
      showWarning = true;
    }
    
    console.log(`[MANIFEST-STRATEGY] Manifest has ${resourceCount} resources, using '${strategy}' strategy`);
    
    return {
      strategy,
      resourceCount,
      criticalResources,
      estimatedSize,
      showWarning,
      batchSize: strategy === 'progressive' ? 3 : strategy === 'critical-first' ? 5 : 10
    };
  }

  /**
   * Identify critical resources that should be loaded first
   * @param {Object} manifest - Parsed manifest object  
   * @returns {Set<string>} Set of critical resource transaction IDs
   */
  identifyCriticalResources(manifest) {
    const critical = new Set();
    const criticalPaths = [];
    
    // 1. Index file is always critical
    if (manifest.index?.path) {
      criticalPaths.push(manifest.index.path);
    } else if (manifest.index?.id) {
      critical.add(manifest.index.id);
    } else {
      // Look for common index files
      const commonIndex = ['index.html', 'index.htm', '/index.html', '/index.htm'];
      for (const path of commonIndex) {
        if (manifest.paths[path]) {
          criticalPaths.push(path);
          break;
        }
      }
    }
    
    // 2. Main CSS files (first 3 found)
    const cssFiles = Object.keys(manifest.paths).filter(path => 
      path.endsWith('.css') || path.includes('style') || path.includes('main')
    ).slice(0, 3);
    criticalPaths.push(...cssFiles);
    
    // 3. Main JavaScript files (first 3 found)  
    const jsFiles = Object.keys(manifest.paths).filter(path =>
      (path.endsWith('.js') || path.endsWith('.mjs')) && 
      (path.includes('main') || path.includes('app') || path.includes('bundle') || path.includes('index'))
    ).slice(0, 3);
    criticalPaths.push(...jsFiles);
    
    // 4. Favicon and essential images
    const essentialImages = Object.keys(manifest.paths).filter(path =>
      path.includes('favicon') || path.includes('icon') || path.includes('logo')
    ).slice(0, 2);
    criticalPaths.push(...essentialImages);
    
    // Convert paths to transaction IDs
    criticalPaths.forEach(path => {
      if (manifest.paths[path] && manifest.paths[path].id) {
        critical.add(manifest.paths[path].id);
      }
    });
    
    console.log(`[MANIFEST-CRITICAL] Identified ${critical.size} critical resources (by txId)`);
    return critical;
  }

  /**
   * Parse and validate an Arweave manifest according to spec v0.2.0
   * @param {string} manifestContent - Raw JSON content of the manifest
   * @returns {Object} Parsed and validated manifest
   */
  parseManifest(manifestContent) {
    let parsed;
    try {
      parsed = JSON.parse(manifestContent);
    } catch (error) {
      throw new Error(`Invalid JSON in manifest: ${error.message}`);
    }

    // Validate required fields according to spec
    if (!parsed.manifest || parsed.manifest !== 'arweave/paths') {
      throw new Error('Invalid manifest type. Must be "arweave/paths"');
    }

    if (!parsed.version) {
      throw new Error('Manifest version is required');
    }

    // Support both v0.1.0 and v0.2.0
    if (!['0.1.0', '0.2.0'].includes(parsed.version)) {
      console.warn(`[MANIFEST] Unsupported version ${parsed.version}, attempting to parse anyway`);
    }

    if (!parsed.paths || typeof parsed.paths !== 'object') {
      throw new Error('Manifest must contain a paths object');
    }

    // Validate paths structure
    for (const [path, pathData] of Object.entries(parsed.paths)) {
      if (!pathData || typeof pathData !== 'object') {
        throw new Error(`Invalid path data for "${path}"`);
      }
      
      if (!pathData.id || typeof pathData.id !== 'string') {
        throw new Error(`Missing or invalid transaction ID for path "${path}"`);
      }

      // Validate transaction ID format (43 character base64url)
      if (!/^[a-zA-Z0-9_-]{43}$/.test(pathData.id)) {
        throw new Error(`Invalid transaction ID format for path "${path}": ${pathData.id}`);
      }
    }

    // Validate index if present
    if (parsed.index) {
      if (parsed.index.path && !parsed.paths[parsed.index.path]) {
        throw new Error(`Index path "${parsed.index.path}" not found in paths object`);
      }
      
      if (parsed.index.id && !/^[a-zA-Z0-9_-]{43}$/.test(parsed.index.id)) {
        throw new Error(`Invalid transaction ID format in index: ${parsed.index.id}`);
      }
    }

    // Validate fallback if present
    if (parsed.fallback) {
      if (!parsed.fallback.id || !/^[a-zA-Z0-9_-]{43}$/.test(parsed.fallback.id)) {
        throw new Error(`Invalid transaction ID format in fallback: ${parsed.fallback.id}`);
      }
    }

    console.log(`[MANIFEST] Valid manifest parsed with ${Object.keys(parsed.paths).length} paths`);
    return parsed;
  }

  /**
   * Extract all unique transaction IDs from the manifest
   * @param {Object} manifest - Parsed manifest object
   * @returns {Set} Set of unique transaction IDs
   */
  extractTransactionIds(manifest) {
    const txIds = new Set();

    // Add all path transaction IDs
    for (const pathData of Object.values(manifest.paths)) {
      txIds.add(pathData.id);
    }

    // Add index transaction ID if present
    if (manifest.index && manifest.index.id) {
      txIds.add(manifest.index.id);
    }

    // Add fallback transaction ID if present
    if (manifest.fallback && manifest.fallback.id) {
      txIds.add(manifest.fallback.id);
    }

    console.log(`[MANIFEST] Extracted ${txIds.size} unique transaction IDs for verification`);
    return txIds;
  }

  /**
   * Resolve the index content according to manifest spec
   * @param {Object} manifest - Parsed manifest object
   * @returns {string|null} Transaction ID for index content, or null if none
   */
  resolveIndex(manifest) {
    if (!manifest.index) {
      console.log('[MANIFEST] No index defined in manifest');
      return null;
    }

    if (manifest.index.path) {
      const pathData = manifest.paths[manifest.index.path];
      if (pathData) {
        console.log(`[MANIFEST] Index resolved via path "${manifest.index.path}" to ${pathData.id}`);
        return pathData.id;
      } else {
        throw new Error(`Index path "${manifest.index.path}" not found in manifest`);
      }
    }

    if (manifest.index.id) {
      console.log(`[MANIFEST] Index resolved directly to ${manifest.index.id}`);
      return manifest.index.id;
    }

    return null;
  }

  /**
   * Resolve a path to a transaction ID using the manifest
   * @param {Object} manifest - Parsed manifest object
   * @param {string} path - Path to resolve
   * @returns {string|null} Transaction ID or null if not found
   */
  resolvePath(manifest, path) {
    // Clean the path (remove leading ./ or /)
    const cleanPath = path.replace(/^\.?\//, '');
    
    if (manifest.paths[cleanPath]) {
      return manifest.paths[cleanPath].id;
    }

    if (manifest.paths[path]) {
      return manifest.paths[path].id;
    }

    // Try fallback if available
    if (manifest.fallback && manifest.fallback.id) {
      console.log(`[MANIFEST] Path "${path}" not found, using fallback ${manifest.fallback.id}`);
      return manifest.fallback.id;
    }

    console.warn(`[MANIFEST] Path "${path}" not found and no fallback available`);
    return null;
  }

  /**
   * Verify a single transaction ID using Wayfinder Core
   * @param {string} txId - Transaction ID to verify
   * @returns {Promise<{verified: boolean, data: Uint8Array, error?: string}>}
   */
  async verifyTransaction(txId) {
    try {
      console.log(`[MANIFEST] Starting verification for ${txId}`);
      
      const response = await chrome.runtime.sendMessage({
        type: 'FETCH_AND_VERIFY_RESOURCE',
        url: `ar://${txId}`
      });

      if (!response) {
        throw new Error('No response from background script');
      }

      if (response.error) {
        throw new Error(response.error);
      }

      // Convert base64 back to Uint8Array
      const binaryString = atob(response.data);
      const data = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        data[i] = binaryString.charCodeAt(i);
      }

      console.log(`[MANIFEST] Verification complete for ${txId}: ${response.verified ? 'VERIFIED' : 'FAILED'}`);
      
      return {
        verified: response.verified,
        data: data,
        error: response.error
      };
    } catch (error) {
      console.error(`[MANIFEST] Verification failed for ${txId}:`, error);
      return {
        verified: false,
        data: null,
        error: error.message
      };
    }
  }

  /**
   * Verify a batch of resources by transaction IDs
   * @param {Array<string>} txIds - Array of transaction IDs to verify
   * @param {Object} manifest - Parsed manifest object (for context)
   * @param {Function} progressCallback - Called with progress updates
   * @returns {Promise<Map>} Map of txId -> {verified, blob, contentType}
   */
  async verifyResourceBatch(txIds, manifest, progressCallback) {
    const results = new Map();
    
    // Initialize progress for this batch
    const batchProgress = {
      total: txIds.length,
      completed: 0,
      verified: 0,
      failed: 0
    };

    console.log(`[MANIFEST] Starting batch verification of ${txIds.length} resources`);

    // Verify resources in parallel with concurrency limit
    const CONCURRENCY_LIMIT = 3;
    
    for (let i = 0; i < txIds.length; i += CONCURRENCY_LIMIT) {
      const batch = txIds.slice(i, i + CONCURRENCY_LIMIT);
      
      await Promise.all(batch.map(async (txId) => {
        const result = await this.verifyTransaction(txId);
        
        if (result.verified && result.data) {
          // Determine content type from data
          const contentType = this.detectContentType(result.data, txId);
          const blob = new Blob([result.data], { type: contentType });
          
          results.set(txId, {
            verified: true,
            blob: blob,
            contentType: contentType
          });
          
          batchProgress.verified++;
        } else {
          results.set(txId, {
            verified: false,
            blob: null,
            contentType: null,
            error: result.error
          });
          
          batchProgress.failed++;
        }
        
        batchProgress.completed++;
        
        if (progressCallback) {
          progressCallback(batchProgress);
        }
      }));
    }

    console.log(`[MANIFEST] Batch verification complete: ${batchProgress.verified} verified, ${batchProgress.failed} failed`);
    return results;
  }

  /**
   * Verify all resources referenced in the manifest
   * @param {Object} manifest - Parsed manifest object
   * @param {Function} progressCallback - Called with progress updates
   * @returns {Promise<Map>} Map of txId -> {verified, blob, contentType}
   */
  async verifyAllResources(manifest, progressCallback) {
    const txIds = this.extractTransactionIds(manifest);
    const txIdArray = Array.from(txIds);
    
    console.log(`[MANIFEST] Starting verification of ${txIds.size} resources`);

    // Use batch verification for all resources
    return await this.verifyResourceBatch(txIdArray, manifest, progressCallback);
  }

  /**
   * Detect content type from binary data
   * @param {Uint8Array} data - Binary data
   * @param {string} txId - Transaction ID for context
   * @returns {string} MIME type
   */
  detectContentType(data, txId) {
    // Check magic bytes for common formats
    if (data.length >= 4) {
      const header = Array.from(data.slice(0, 4)).map(b => b.toString(16).padStart(2, '0')).join('');
      
      // PNG
      if (header.startsWith('89504e47')) return 'image/png';
      // JPEG
      if (header.startsWith('ffd8ff')) return 'image/jpeg';
      // GIF
      if (header.startsWith('47494638')) return 'image/gif';
      // WebP
      if (header.startsWith('52494646') && data.length >= 12) {
        const webpSig = Array.from(data.slice(8, 12)).map(b => b.toString(16).padStart(2, '0')).join('');
        if (webpSig === '57454250') return 'image/webp';
      }
    }

    // Try to decode as text to check for HTML/CSS/JS
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(data.slice(0, Math.min(1024, data.length)));
      
      if (text.includes('<!DOCTYPE html') || text.includes('<html')) {
        return 'text/html';
      }
      if (text.includes('function') || text.includes('const ') || text.includes('var ')) {
        return 'application/javascript';
      }
      if (text.includes('{') && (text.includes('color:') || text.includes('margin:') || text.includes('padding:'))) {
        return 'text/css';
      }
      
      return 'text/plain';
    } catch {
      // Not valid UTF-8, probably binary
      return 'application/octet-stream';
    }
  }

  /**
   * Create blob URLs for all verified resources
   * @param {Map} verifiedResources - Map of txId -> resource data
   * @returns {Map} Map of txId -> blob URL
   */
  createBlobUrls(verifiedResources) {
    const blobUrls = new Map();
    let failedCount = 0;
    
    for (const [txId, resource] of verifiedResources) {
      if (resource.verified && resource.blob) {
        const blobUrl = URL.createObjectURL(resource.blob);
        blobUrls.set(txId, blobUrl);
      } else {
        failedCount++;
        console.warn(`[MANIFEST] Resource ${txId} not verified or missing blob:`, resource.error || 'Unknown error');
      }
    }
    
    console.log(`[MANIFEST] Created ${blobUrls.size} blob URLs (${failedCount} resources failed verification)`);
    return blobUrls;
  }

  /**
   * Rewrite HTML content to use blob URLs for verified resources
   * @param {string} htmlContent - Original HTML content
   * @param {Object} manifest - Parsed manifest object
   * @param {Map} blobUrls - Map of txId -> blob URL
   * @returns {string} Rewritten HTML content
   */
  rewriteHtmlContent(htmlContent, manifest, blobUrls) {
    let rewrittenContent = htmlContent;
    
    // Build path to blob URL mapping
    const pathToBlobUrl = new Map();
    for (const [path, pathData] of Object.entries(manifest.paths)) {
      if (blobUrls.has(pathData.id)) {
        pathToBlobUrl.set(path, blobUrls.get(pathData.id));
      }
    }
    
    // Replace src and href attributes that match manifest paths
    for (const [path, blobUrl] of pathToBlobUrl) {
      // Handle various path formats: "./path", "/path", "path"
      const patterns = [
        new RegExp(`(src|href)=["']\\.\/${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`, 'gi'),
        new RegExp(`(src|href)=["']/${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`, 'gi'),
        new RegExp(`(src|href)=["']${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`, 'gi')
      ];
      
      for (const pattern of patterns) {
        rewrittenContent = rewrittenContent.replace(pattern, `$1="${blobUrl}"`);
      }
    }
    
    console.log(`[MANIFEST] Rewritten HTML content with ${pathToBlobUrl.size} blob URL replacements`);
    return rewrittenContent;
  }

  /**
   * Cleanup blob URLs to prevent memory leaks
   * @param {Map} blobUrls - Map of txId -> blob URL
   */
  cleanup(blobUrls) {
    for (const blobUrl of blobUrls.values()) {
      URL.revokeObjectURL(blobUrl);
    }
    console.log(`[MANIFEST] Cleaned up ${blobUrls.size} blob URLs`);
  }
}

// Export for use in viewer.js
window.ManifestRenderer = ManifestRenderer;