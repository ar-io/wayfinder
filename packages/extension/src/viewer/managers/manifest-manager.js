/**
 * Manifest Manager
 * 
 * Handles all Arweave manifest rendering, verification strategies, and recovery logic.
 * Consolidates the massive manifest processing methods from the main viewer.
 */

/**
 * ManifestManager class handles all manifest-related operations
 */
export class ManifestManager {
  constructor(viewer) {
    this.viewer = viewer;
  }

  /**
   * Render Arweave manifest with verification and strategy selection
   * @param {string} manifestText - Raw manifest JSON text
   * @param {Object} response - Verification response object
   */
  async renderManifest(manifestText, response) {
    try {
      console.log('[VIEWER] Starting manifest rendering verification');
      
      // Show manifest verification UI
      this.viewer.showManifestVerificationUI();
      
      // Create manifest renderer
      const renderer = new window.ManifestRenderer();
      
      // Parse and validate the manifest
      const manifest = renderer.parseManifest(manifestText);
      console.log('[VIEWER] Manifest parsed successfully');
      
      // Analyze manifest and determine loading strategy
      const strategy = renderer.analyzeManifest(manifest);
      renderer.loadingStrategy = strategy;
      
      // Show warning for large manifests
      if (strategy.showWarning) {
        this.viewer.showToast(
          'Large manifest detected',
          'warning', 
          `${strategy.resourceCount} resources found. This may take a while to verify.`
        );
      }
      
      // Set up progress callback
      const progressCallback = (progress) => {
        this.viewer.progressManager.updateManifestProgress(progress);
      };
      
      // Verify resources based on strategy
      let verifiedResources;
      if (strategy.strategy === 'critical-first') {
        verifiedResources = await this.verifyCriticalFirst(renderer, manifest, strategy, progressCallback);
      } else if (strategy.strategy === 'progressive') {
        verifiedResources = await this.verifyProgressive(renderer, manifest, strategy, progressCallback);
      } else {
        // Full prefetch for small manifests
        verifiedResources = await renderer.verifyAllResources(manifest, progressCallback);
      }
      console.log('[VIEWER] All manifest resources verified');
      
      // Create blob URLs for verified resources
      const blobUrls = renderer.createBlobUrls(verifiedResources);
      
      // Determine what to render based on the manifest
      let contentToRender = null;
      let renderType = 'manifest';
      
      // Check if we should render the index content
      const indexTxId = renderer.resolveIndex(manifest);
      if (indexTxId && verifiedResources.has(indexTxId) && verifiedResources.get(indexTxId).verified) {
        const indexResource = verifiedResources.get(indexTxId);
        
        // If index is HTML, render it with rewritten URLs
        if (indexResource.contentType.includes('text/html')) {
          const htmlContent = await indexResource.blob.text();
          contentToRender = renderer.rewriteHtmlContent(htmlContent, manifest, blobUrls);
          renderType = 'html';
          console.log('[VIEWER] Rendering manifest index as HTML with verified resources');
        } else {
          // For non-HTML index, create a viewer
          const indexBlobUrl = blobUrls.get(indexTxId);
          contentToRender = this.viewer.contentManager.createContentViewer(indexBlobUrl, indexResource.contentType);
          renderType = 'content';
          console.log('[VIEWER] Rendering manifest index as content viewer');
        }
      }
      
      // Hide verification UI
      this.viewer.hideManifestVerificationUI();
      
      // Update verification stats
      const totalResources = verifiedResources.size;
      const verifiedCount = Array.from(verifiedResources.values()).filter(r => r.verified).length;
      const failedCount = totalResources - verifiedCount;
      
      console.log(`[VIEWER] Manifest verification complete: ${verifiedCount}/${totalResources} verified`);
      
      // Display content in iframe
      const iframe = document.getElementById('verified-content');
      if (renderType === 'html' && contentToRender) {
        iframe.srcdoc = contentToRender;
        this.viewer.progressManager.setMainContentStatus(true);
      } else if (renderType === 'content' && contentToRender) {
        iframe.srcdoc = contentToRender;
        this.viewer.progressManager.setMainContentStatus(true);
      } else {
        // No index specified or index not verified - show manifest explorer
        const manifestViewer = this.viewer.contentManager.createManifestExplorer(manifest, verifiedResources, blobUrls);
        iframe.srcdoc = manifestViewer;
        this.viewer.progressManager.setMainContentStatus(verifiedCount > 0);
      }
      
      // Update trust indicator
      this.viewer.progressManager.updateTrustIndicator();
      
      // Show success/warning toast
      if (failedCount === 0) {
        this.viewer.showToast(
          'Manifest fully verified',
          'success',
          `All ${totalResources} resources verified and loaded`
        );
      } else {
        this.viewer.showToast(
          'Manifest partially verified',
          'warning',
          `${verifiedCount}/${totalResources} resources verified`
        );
      }
      
      // Update resource panel
      for (const [txId, resource] of verifiedResources) {
        const pathsForTxId = Object.entries(manifest.paths)
          .filter(([path, pathData]) => pathData.id === txId)
          .map(([path]) => path);
        
        const displayPath = pathsForTxId.length > 0 ? pathsForTxId[0] : txId;
        
        this.viewer.addResource(
          displayPath,
          this.viewer.guessResourceTypeFromContentType(resource.contentType),
          resource.verified ? 'verified' : 'failed',
          resource.verified ? 'Cryptographically verified' : resource.error || 'Verification failed'
        );
      }
      
      // Cleanup blob URLs when page unloads
      window.addEventListener('beforeunload', () => {
        renderer.cleanup(blobUrls);
      });
      
    } catch (error) {
      console.error('[VIEWER] Manifest rendering error:', error);
      this.viewer.hideManifestVerificationUI();
      
      // Try graceful degradation
      const recovered = await this.attemptManifestRecovery(manifestText, error);
      if (!recovered) {
        this.viewer.showError('Manifest verification failed: ' + error.message);
      }
    }
  }

  /**
   * Verify critical resources first, then remaining resources
   * @param {Object} renderer - Manifest renderer instance
   * @param {Object} manifest - Parsed manifest object
   * @param {Object} strategy - Loading strategy configuration
   * @param {Function} progressCallback - Progress update callback
   * @returns {Map} Map of verified resources
   */
  async verifyCriticalFirst(renderer, manifest, strategy, progressCallback) {
    console.log('[VIEWER] Using critical-first verification strategy');
    
    // Get critical resource transaction IDs
    const allTxIds = new Set(Object.values(manifest.paths).map(p => p.id));
    const criticalTxIds = renderer.identifyCriticalResources(manifest);
    
    // Verify critical resources first
    console.log(`[VIEWER] Verifying ${criticalTxIds.size} critical resources first...`);
    const criticalResources = await renderer.verifyResourceBatch(
      Array.from(criticalTxIds), 
      manifest,
      (progress) => {
        progressCallback({
          ...progress,
          currentPhase: 'critical'
        });
      }
    );
    
    // Track progress for critical resources
    const totalProgress = {
      verified: Array.from(criticalResources.values()).filter(r => r.verified).length,
      failed: Array.from(criticalResources.values()).filter(r => !r.verified).length
    };
    
    // Check if critical resources are sufficient to display content
    const indexTxId = renderer.resolveIndex(manifest);
    if (indexTxId && criticalResources.has(indexTxId) && criticalResources.get(indexTxId).verified) {
      console.log('[VIEWER] Index resource verified, checking if we can display early');
      
      // If we have a good number of critical resources verified, offer choice
      if (allTxIds.size > 10 && criticalTxIds.size >= 3) {
        console.log('[VIEWER] Sufficient critical resources verified, offering early display option');
      }
    }
    
    // Show option to continue with remaining resources
    const shouldContinue = await this.viewer.contentManager.showProgressiveChoice(
      allTxIds.size - criticalTxIds.size,
      totalProgress.verified,
      totalProgress.failed
    );
    
    if (shouldContinue) {
      // Continue with remaining resources
      const remainingTxIds = [...allTxIds].filter(txId => !criticalTxIds.has(txId));
      console.log(`[VIEWER] Verifying ${remainingTxIds.length} remaining resources...`);
      
      const remainingResources = await renderer.verifyResourceBatch(
        remainingTxIds,
        manifest,
        (progress) => {
          progressCallback({
            ...progress,
            currentPhase: 'remaining'
          });
        }
      );
      
      // Merge results
      const allResources = new Map([...criticalResources, ...remainingResources]);
      return allResources;
    } else {
      console.log('[VIEWER] User chose to display content with critical resources only');
      return criticalResources;
    }
  }

  /**
   * Verify resources progressively with user choice points
   * @param {Object} renderer - Manifest renderer instance
   * @param {Object} manifest - Parsed manifest object
   * @param {Object} strategy - Loading strategy configuration
   * @param {Function} progressCallback - Progress update callback
   * @returns {Map} Map of verified resources
   */
  async verifyProgressive(renderer, manifest, strategy, progressCallback) {
    console.log('[VIEWER] Using progressive verification strategy');
    
    const allTxIds = Object.values(manifest.paths).map(p => p.id);
    const batchSize = Math.min(20, Math.ceil(allTxIds.length / 4)); // Process in batches
    const verifiedResources = new Map();
    
    for (let i = 0; i < allTxIds.length; i += batchSize) {
      const batchTxIds = allTxIds.slice(i, i + batchSize);
      console.log(`[VIEWER] Verifying batch ${Math.floor(i/batchSize) + 1}: ${batchTxIds.length} resources`);
      
      const batchResources = await renderer.verifyResourceBatch(
        batchTxIds,
        manifest,
        progressCallback
      );
      
      // Merge batch results
      for (const [txId, resource] of batchResources) {
        verifiedResources.set(txId, resource);
      }
      
      // Check if we should offer early display after significant progress
      if (i > 0 && (i + batchSize) < allTxIds.length) {
        const verifiedCount = Array.from(verifiedResources.values()).filter(r => r.verified).length;
        const failedCount = verifiedResources.size - verifiedCount;
        const remainingCount = allTxIds.length - verifiedResources.size;
        
        // Offer choice if we have verified enough resources and there are many remaining
        if (verifiedCount >= 5 && remainingCount > 10) {
          const shouldContinue = await this.viewer.contentManager.showProgressiveChoice(
            remainingCount,
            verifiedCount,
            failedCount
          );
          
          if (!shouldContinue) {
            console.log('[VIEWER] User chose to stop verification early');
            break;
          }
        }
      }
    }
    
    return verifiedResources;
  }

  /**
   * Attempt to recover from manifest verification failures
   * @param {string} manifestText - Original manifest content
   * @param {Error} error - The error that occurred
   * @returns {boolean} True if recovery was successful
   */
  async attemptManifestRecovery(manifestText, error) {
    console.log('[VIEWER] Attempting manifest recovery from error:', error.message);
    
    try {
      // Try to parse a partial manifest by being more lenient
      let partialManifest;
      try {
        partialManifest = JSON.parse(manifestText);
      } catch (parseError) {
        console.log('[VIEWER] Cannot parse manifest JSON, attempting string repair...');
        
        // Try to repair common JSON issues
        let repairedText = manifestText
          .replace(/,\s*}/g, '}')  // Remove trailing commas
          .replace(/,\s*]/g, ']')   // Remove trailing commas in arrays
          .trim();
        
        partialManifest = JSON.parse(repairedText);
      }
      
      // If we have a valid manifest structure, try to load what we can
      if (partialManifest && partialManifest.paths) {
        console.log('[VIEWER] Partial manifest recovered, attempting selective loading');
        
        // Validate paths and count what's usable
        let validCount = 0;
        const cleanedPaths = {};
        
        for (const [path, pathData] of Object.entries(partialManifest.paths)) {
          if (pathData && pathData.id && typeof pathData.id === 'string') {
            cleanedPaths[path] = pathData;
            validCount++;
          }
        }
        
        if (validCount > 0) {
          const recoveredManifest = {
            ...partialManifest,
            paths: cleanedPaths
          };
          
          console.log(`[VIEWER] Recovered ${validCount} valid paths from manifest`);
          
          // Render the recovered manifest with warnings
          await this.renderRecoveredManifest(recoveredManifest, validCount, Object.keys(partialManifest.paths).length - validCount);
          return true;
        }
      }
      
      // If manifest has an index, try loading just that
      if (partialManifest && partialManifest.index && partialManifest.index.id) {
        console.log('[VIEWER] Attempting to load manifest index only');
        await this.loadIndexOnly(partialManifest.index.id);
        return true;
      }
      
    } catch (recoveryError) {
      console.log('[VIEWER] Manifest recovery failed:', recoveryError.message);
    }
    
    // Last resort: treat as single file
    console.log('[VIEWER] All recovery attempts failed, loading as single file');
    await this.loadAsSingleFile();
    return true; // We can always fall back to single file
  }

  /**
   * Render a recovered manifest with partial verification
   * @param {Object} manifest - Recovered manifest object
   * @param {number} validCount - Number of valid resources
   * @param {number} invalidCount - Number of invalid resources
   */
  async renderRecoveredManifest(manifest, validCount, invalidCount) {
    try {
      console.log(`[VIEWER] Rendering recovered manifest: ${validCount} valid, ${invalidCount} invalid resources`);
      
      // Show warning about partial recovery
      this.viewer.showToast(
        'Manifest partially recovered',
        'warning',
        `${validCount} resources found, ${invalidCount} skipped due to corruption`
      );
      
      // Use a simple verification strategy for recovered manifests
      const renderer = new window.ManifestRenderer();
      const verifiedResources = await renderer.verifyAllResources(manifest, (progress) => {
        this.viewer.progressManager.updateManifestProgress(progress);
      });
      
      const blobUrls = renderer.createBlobUrls(verifiedResources);
      
      // Try to render index if available
      const indexTxId = renderer.resolveIndex(manifest);
      let contentToRender = null;
      
      if (indexTxId && verifiedResources.has(indexTxId) && verifiedResources.get(indexTxId).verified) {
        const indexResource = verifiedResources.get(indexTxId);
        if (indexResource.contentType.includes('text/html')) {
          const htmlContent = await indexResource.blob.text();
          contentToRender = renderer.rewriteHtmlContent(htmlContent, manifest, blobUrls);
        }
      }
      
      // Display content
      const iframe = document.getElementById('verified-content');
      if (contentToRender) {
        iframe.srcdoc = contentToRender;
        this.viewer.progressManager.setMainContentStatus(true);
      } else {
        // Show manifest explorer for recovered content
        const manifestViewer = this.viewer.contentManager.createManifestExplorer(manifest, verifiedResources, blobUrls);
        iframe.srcdoc = manifestViewer;
        this.viewer.progressManager.setMainContentStatus(verifiedResources.size > 0);
      }
      
      this.viewer.progressManager.updateTrustIndicator();
      
      // Cleanup
      window.addEventListener('beforeunload', () => {
        renderer.cleanup(blobUrls);
      });
      
    } catch (error) {
      console.error('[VIEWER] Recovered manifest rendering failed:', error);
      await this.loadAsSingleFile();
    }
  }

  /**
   * Load only the index file from a manifest
   * @param {string} indexTxId - Transaction ID of the index file
   */
  async loadIndexOnly(indexTxId) {
    try {
      console.log(`[VIEWER] Loading index file only: ${indexTxId}`);
      
      this.viewer.showToast(
        'Loading index file',
        'info',
        'Loading the main file from this manifest'
      );
      
      // Redirect to the index file directly
      const indexUrl = `ar://${indexTxId}`;
      window.location.href = `viewer.html?url=${encodeURIComponent(indexUrl)}`;
      
    } catch (error) {
      console.error('[VIEWER] Index-only loading failed:', error);
      await this.loadAsSingleFile();
    }
  }

  /**
   * Load the current transaction as a single file (fallback)
   */
  async loadAsSingleFile() {
    console.log('[VIEWER] Loading as single file (fallback mode)');
    
    this.viewer.showToast(
      'Loading as single file',
      'info', 
      'Manifest processing failed, loading the raw content'
    );
    
    // Get the current transaction ID and load it directly
    const currentUrl = new URL(window.location.href);
    const arUrl = currentUrl.searchParams.get('url');
    
    if (arUrl) {
      const match = arUrl.match(/^ar:\/\/([^/]+)/);
      if (match) {
        const txId = match[1];
        const directUrl = `ar://${txId}`;
        window.location.href = `viewer.html?url=${encodeURIComponent(directUrl)}`;
        return;
      }
    }
    
    // If we can't determine the transaction ID, show an error
    this.viewer.showError('Unable to load content: manifest processing failed and cannot determine source transaction');
  }
}

// Export convenience function for main viewer usage
export const createManifestManager = (viewer) => new ManifestManager(viewer);