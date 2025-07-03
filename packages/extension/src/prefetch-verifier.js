/**
 * Pre-fetch Verification System
 * Fetches and verifies all resources before displaying content
 */

class PreFetchVerifier {
  constructor(arUrl, manifest = null) {
    this.arUrl = arUrl;
    this.manifest = manifest;
    console.log('[PREFETCH-DEBUG] Constructor called with:', { arUrl, manifest: manifest ? 'MANIFEST_PRESENT' : 'NO_MANIFEST' });
    if (manifest) {
      console.log('[PREFETCH-DEBUG] Manifest paths:', Object.keys(manifest.paths || {}));
    }
    this.resources = new Map();
    this.verificationResults = new Map();
    this.cacheName = 'wayfinder-verified-resources';
    this.progress = {
      total: 0,
      completed: 0,
      verified: 0,
      failed: 0,
      skipped: 0
    };
  }

  /**
   * Main entry point - pre-fetches and verifies all resources
   */
  async verifyAndPrepareContent(htmlContent, gatewayUrl) {
    console.log('[PREFETCH] Starting pre-fetch verification for:', this.arUrl);
    
    try {
      // 1. Extract all resources from HTML
      const extractedResources = await this.extractResources(htmlContent);
      console.log(`[PREFETCH] Found ${extractedResources.length} resources to verify`);
      
      // 2. Update progress UI
      this.progress.total = extractedResources.length + 1; // +1 for main content
      this.progress.completed = 1; // Main content already verified
      this.progress.verified = 1;
      await this.updateProgress();
      
      // 3. Open cache for storing verified resources
      const cache = await caches.open(this.cacheName);
      
      // 4. Process resources in batches for better performance
      const batchSize = 5;
      for (let i = 0; i < extractedResources.length; i += batchSize) {
        const batch = extractedResources.slice(i, i + batchSize);
        await Promise.all(batch.map(resource => this.processResource(resource, cache)));
      }
      
      // 5. Rewrite HTML to use cached resources
      const rewrittenHtml = await this.rewriteHtmlForCache(htmlContent, gatewayUrl);
      
      // 6. Create final verification report
      const report = this.generateVerificationReport();
      
      return {
        html: rewrittenHtml,
        report: report,
        success: this.progress.failed === 0
      };
      
    } catch (error) {
      console.error('[PREFETCH] Verification failed:', error);
      throw error;
    }
  }

  /**
   * Extract all resources from HTML content
   */
  async extractResources(htmlContent) {
    const resources = [];
    
    // Extract scripts
    const scriptRegex = /<script[^>]+src=["']([^"']+)["'][^>]*>/gi;
    let match;
    while ((match = scriptRegex.exec(htmlContent)) !== null) {
      resources.push({
        url: match[1],
        type: 'script',
        tag: match[0]
      });
    }
    
    // Extract stylesheets
    const linkRegex = /<link[^>]+rel=["']stylesheet["'][^>]+href=["']([^"']+)["'][^>]*>/gi;
    while ((match = linkRegex.exec(htmlContent)) !== null) {
      resources.push({
        url: match[1],
        type: 'stylesheet',
        tag: match[0]
      });
    }
    
    // Extract images
    const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
    while ((match = imgRegex.exec(htmlContent)) !== null) {
      resources.push({
        url: match[1],
        type: 'image',
        tag: match[0]
      });
    }
    
    // Extract other resources (audio, video, etc.)
    const sourceRegex = /<(?:audio|video|source)[^>]+src=["']([^"']+)["'][^>]*>/gi;
    while ((match = sourceRegex.exec(htmlContent)) !== null) {
      resources.push({
        url: match[1],
        type: 'media',
        tag: match[0]
      });
    }
    
    // Resolve URLs and classify them
    return resources.map(resource => ({
      ...resource,
      resolvedUrl: this.resolveUrl(resource.url),
      isExternal: this.isExternalResource(resource.url),
      isProxy: resource.url.includes('wayfinder-proxy.html')
    }));
  }

  /**
   * Process a single resource - fetch, verify, and cache
   */
  async processResource(resource, cache) {
    try {
      // Skip external resources
      if (resource.isExternal) {
        console.log(`[PREFETCH] Skipping external resource: ${resource.url}`);
        this.verificationResults.set(resource.url, {
          status: 'skipped',
          reason: 'External resource',
          cached: false
        });
        this.progress.skipped++;
        this.progress.completed++;
        await this.updateProgress();
        return;
      }
      
      // Handle proxy URLs - extract the actual ar:// URL
      let targetUrl = resource.resolvedUrl;
      if (resource.isProxy) {
        const match = resource.url.match(/wayfinder-proxy\.html\?url=([^&]+)/);
        if (match) {
          targetUrl = decodeURIComponent(match[1]);
        }
      }
      
      console.log(`[PREFETCH] Fetching and verifying: ${targetUrl}`);
      
      // Send verification request to background script
      const response = await this.fetchAndVerify(targetUrl);
      
      console.log(`[PREFETCH] Received verification response for ${targetUrl}:`, {
        verified: response.verified,
        hasData: !!response.data,
        contentType: response.contentType,
        error: response.error
      });
      
      if (response.verified) {
        // Cache the verified resource using a proper URL-like cache key
        const cacheKey = this.getCacheKey(resource.url);
        const cacheUrl = `https://wayfinder-cache.local/${cacheKey}`;
        
        await cache.put(cacheUrl, new Response(response.data, {
          headers: {
            'Content-Type': response.contentType || this.guessContentType(targetUrl),
            'X-Verified': 'true',
            'X-Original-Url': targetUrl
          }
        }));
        
        this.verificationResults.set(resource.url, {
          status: 'verified',
          cached: true,
          cacheKey: cacheKey,
          cacheUrl: cacheUrl
        });
        this.progress.verified++;
      } else {
        this.verificationResults.set(resource.url, {
          status: 'failed',
          reason: response.error || 'Verification failed',
          cached: false
        });
        this.progress.failed++;
      }
      
    } catch (error) {
      console.error(`[PREFETCH] Failed to process ${resource.url}:`, error);
      
      // Determine if this is a 404 or other error
      const is404 = error.message.includes('404');
      const status = is404 ? 'skipped' : 'failed';
      const reason = is404 ? 'Resource not found (404)' : error.message;
      
      this.verificationResults.set(resource.url, {
        status: status,
        reason: reason,
        cached: false
      });
      
      if (is404) {
        this.progress.skipped++;
      } else {
        this.progress.failed++;
      }
    }
    
    this.progress.completed++;
    await this.updateProgress();
  }

  /**
   * Fetch and verify a resource through the background script
   */
  async fetchAndVerify(url) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        type: 'FETCH_AND_VERIFY_RESOURCE',
        url: url
      }, response => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (response.error) {
          reject(new Error(response.error));
        } else {
          // Handle response data based on type
          if (response.data && typeof response.data === 'string') {
            try {
              // Check if data is base64 encoded (from FETCH_AND_VERIFY_RESOURCE)
              if (response.isBase64) {
                // Decode base64 string to binary string
                const binaryString = atob(response.data);
                // Convert binary string to Uint8Array
                const uint8Array = new Uint8Array(binaryString.length);
                for (let i = 0; i < binaryString.length; i++) {
                  uint8Array[i] = binaryString.charCodeAt(i);
                }
                // Convert to ArrayBuffer
                response.data = uint8Array.buffer;
              } else {
                // Data is not base64, it might be a URL or other format
                console.log('[PREFETCH] Response data is not base64 encoded, keeping as string');
              }
            } catch (error) {
              console.error('[PREFETCH] Failed to decode response data:', error);
              // CRITICAL FIX: Don't override verification status based on data processing errors
              // The verification status comes from cryptographic verification, not data handling
              // If decoding fails but verification succeeded, we should still report success
              console.log('[PREFETCH] Data decoding failed, but preserving verification status:', response.verified);
              response.error = 'Failed to decode response data';
            }
          }
          console.log('[PREFETCH] Resolving with verification status:', response.verified);
          resolve(response);
        }
      });
    });
  }

  /**
   * Rewrite HTML to use cached resources
   */
  async rewriteHtmlForCache(htmlContent, gatewayUrl) {
    let rewritten = htmlContent;
    
    // Replace each resource URL with data URL from cached content
    const cache = await caches.open(this.cacheName);
    
    for (const [originalUrl, result] of this.verificationResults) {
      if (result.cached && result.cacheUrl) {
        try {
          // Get the cached response and convert to blob URL
          const cachedResponse = await cache.match(result.cacheUrl);
          if (cachedResponse) {
            const blob = await cachedResponse.blob();
            const blobUrl = URL.createObjectURL(blob);
            
            // Replace the original URL with the blob URL
            rewritten = rewritten.replace(
              new RegExp(this.escapeRegex(originalUrl), 'g'),
              blobUrl
            );
            
            // Store blob URL for cleanup later
            result.blobUrl = blobUrl;
          }
        } catch (error) {
          console.warn(`[PREFETCH] Failed to create blob URL for ${originalUrl}:`, error);
        }
      }
      // External resources remain unchanged
    }
    
    return rewritten;
  }

  /**
   * Update progress UI
   */
  async updateProgress() {
    const percentage = Math.round((this.progress.completed / this.progress.total) * 100);
    
    // Send progress update to viewer
    chrome.runtime.sendMessage({
      type: 'PREFETCH_PROGRESS',
      progress: {
        ...this.progress,
        percentage
      }
    });
  }

  /**
   * Generate final verification report
   */
  generateVerificationReport() {
    return {
      totalResources: this.progress.total,
      verified: this.progress.verified,
      failed: this.progress.failed,
      skipped: this.progress.skipped,
      securityScore: Math.round((this.progress.verified / (this.progress.total - this.progress.skipped)) * 100),
      details: Array.from(this.verificationResults.entries()).map(([url, result]) => ({
        url,
        ...result
      }))
    };
  }

  /**
   * Resolve relative URLs to absolute ar:// URLs
   */
  resolveUrl(url) {
    console.log(`[DEBUG] resolveUrl input: url="${url}", this.arUrl="${this.arUrl}"`);
    
    // If already absolute, return as-is
    if (url.startsWith('http://') || url.startsWith('https://') || 
        url.startsWith('ar://') || url.startsWith('chrome-extension://')) {
      console.log(`[DEBUG] resolveUrl output (absolute): "${url}"`);
      return url;
    }
    
    // For manifest apps, resolve using manifest paths
    if (this.manifest) {
      return this.resolveManifestPath(url);
    }
    
    // For regular HTML, resolve relative to base URL
    const urlParts = this.arUrl.replace('ar://', '').split('/');
    const baseIdentifier = urlParts[0];
    
    // Check if base identifier is a transaction ID (43 chars, base64url) or ArNS name
    const isTransactionId = /^[a-zA-Z0-9_-]{43}$/.test(baseIdentifier);
    
    if (url.startsWith('/')) {
      // Absolute path from root of the ArNS name or transaction
      return `ar://${baseIdentifier}${url}`;
    } else {
      // Relative path - need to resolve against current directory
      if (isTransactionId) {
        // For transaction IDs, relative paths are resolved against the base
        return `ar://${baseIdentifier}/${url}`;
      } else {
        // For ArNS names, resolve relative to current directory
        // If we're at ar://mysite/path/to/file.html and have "./script.js"
        // Result should be ar://mysite/path/to/script.js
        if (urlParts.length > 1) {
          // Remove the current filename to get the directory path
          const directoryParts = urlParts.slice(0, -1);
          const result = `ar://${directoryParts.join('/')}/${url}`;
          console.log(`[DEBUG] resolveUrl output (ArNS multi-part): "${result}"`);
          return result;
        } else {
          // At root level
          const result = `ar://${baseIdentifier}/${url}`;
          console.log(`[DEBUG] resolveUrl output (ArNS root): "${result}"`);
          return result;
        }
      }
    }
  }

  /**
   * Resolve path using manifest
   */
  resolveManifestPath(path) {
    // Normalize the path
    let normalizedPath = path;
    if (normalizedPath.startsWith('./')) {
      normalizedPath = normalizedPath.substring(2);
    }
    if (normalizedPath.startsWith('/')) {
      normalizedPath = normalizedPath.substring(1);
    }
    
    console.log('[PREFETCH-DEBUG] resolveManifestPath:', { 
      originalPath: path, 
      normalizedPath,
      manifestPaths: this.manifest?.paths ? Object.keys(this.manifest.paths) : 'NO_MANIFEST'
    });
    
    // Look up in manifest
    if (this.manifest.paths && this.manifest.paths[normalizedPath]) {
      const txId = this.manifest.paths[normalizedPath].id;
      console.log('[PREFETCH-DEBUG] Found in manifest:', { normalizedPath, txId });
      return `ar://${txId}`;
    }
    
    // Not in manifest - might be external
    console.log('[PREFETCH-DEBUG] NOT found in manifest, returning original path:', path);
    return path;
  }

  /**
   * Check if resource is external (not from Arweave)
   */
  isExternalResource(url) {
    if (url.startsWith('data:') || url.startsWith('blob:')) return false;
    if (url.startsWith('ar://')) return false;
    if (url.includes('wayfinder-proxy.html')) return false;
    
    // Check if it's a full URL to external site
    if (url.startsWith('http://') || url.startsWith('https://')) {
      const gatewayPatterns = [
        /^https?:\/\/[^\/]*arweave\.[^\/]+\//,
        /^https?:\/\/[^\/]*ar\.io[^\/]*\//,
        /^https?:\/\/[^\/]*ar-io[^\/]*\//,
        /^https?:\/\/[^\/]*g8way[^\/]*\//,
      ];
      return !gatewayPatterns.some(pattern => pattern.test(url));
    }
    
    return false;
  }

  /**
   * Generate cache key for a resource
   */
  getCacheKey(url) {
    // Create a safe cache key by encoding the URL components
    const baseKey = this.arUrl.replace(/[:/]/g, '_');
    const urlKey = url.replace(/[:/]/g, '_');
    return `prefetch_${baseKey}_${urlKey}`;
  }

  /**
   * Guess content type from URL
   */
  guessContentType(url) {
    const ext = url.split('.').pop()?.toLowerCase();
    const types = {
      'js': 'application/javascript',
      'mjs': 'application/javascript',
      'css': 'text/css',
      'html': 'text/html',
      'json': 'application/json',
      'png': 'image/png',
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'gif': 'image/gif',
      'svg': 'image/svg+xml',
      'woff': 'font/woff',
      'woff2': 'font/woff2',
      'ttf': 'font/ttf',
      'otf': 'font/otf'
    };
    return types[ext] || 'application/octet-stream';
  }

  /**
   * Escape special regex characters
   */
  escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

// Export for use in viewer
window.PreFetchVerifier = PreFetchVerifier;