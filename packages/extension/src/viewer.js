/**
 * Wayfinder Verified Browsing - Phase 2 Implementation
 * Adds Service Worker integration for comprehensive resource verification
 * 
 * Phase 1 Refactoring: Now uses modular utilities for:
 * - URL resolution and validation (utils/url-resolver.js)
 * - HTML content analysis (utils/content-analyzer.js) 
 * - Toast notifications (components/toast-manager.js)
 */

// Import utility modules for Phase 1 refactoring
import { 
  resolveUrl, 
  isExternalResource} from './viewer/utils/url-resolver.js';

import { 
  extractResourcesFromHtml,
  guessResourceType,
  containsArweaveResources,
  analyzeScripts} from './viewer/utils/content-analyzer.js';

import { 
  showToast as toastShow} from './viewer/components/toast-manager.js';

// Phase 2: Import manager classes
import { ProgressManager } from './viewer/managers/progress-manager.js';
import { ContentManager } from './viewer/managers/content-manager.js';
import { ManifestManager } from './viewer/managers/manifest-manager.js';

class VerifiedBrowser {
  constructor() {
    // Initialize managers
    this.progressManager = new ProgressManager();
    this.contentManager = new ContentManager();
    this.manifestManager = new ManifestManager(this);
    
    this.isMinimized = false;
    this.arUrl = null;
    this.serviceWorker = null;
    this.swMessageChannel = null;
    this.skipButtonTimeout = null;
    this.verificationCancelled = false;
    this.gatewayUrl = null;
    this.resources = []; // Track individual resource verification
    this.verificationPanel = null;
    this.initialLoadComplete = false; // Flag to prevent stats reset on initial load
  }

  async initialize() {
    // Get URL from query params
    const params = new URLSearchParams(window.location.search);
    this.arUrl = params.get('url');
    this.gatewayUrl = params.get('gateway');

    if (!this.arUrl) {
      this.showError('No URL provided');
      return;
    }

    // Gateway URL stored for verification

    // Display the AR URL in navigation input (without ar:// prefix)
    const urlInput = document.getElementById('urlInput');
    if (urlInput && this.arUrl) {
      // Remove ar:// prefix for display
      urlInput.value = this.arUrl.replace(/^ar:\/\//, '');
      // Focus the input but don't select text
      urlInput.focus();

      // Select all text when user clicks on the input
      urlInput.addEventListener('click', function () {
        this.select();
      });
    }

    // Set up UI event handlers
    this.setupEventHandlers();

    // Set up background message listeners for verification updates
    this.setupBackgroundMessageListeners();

    // Start verification process
    await this.loadVerifiedContent();
  }

  setupBackgroundMessageListeners() {
    // Set up message listener for resource verification updates from background
    chrome.runtime.onMessage.addListener((message, _sender, _sendResponse) => {
      if (message.type === 'RESOURCE_VERIFICATION_UPDATE') {
        console.log('[VIEWER] Received resource verification update:', message);
        this.progressManager.updateResourceStats(message.resourceType, message.verified);
        
        // Update individual resource status if we have the URL
        if (message.url) {
          const status = message.verified ? 'verified' : 'failed';
          const reason = message.verified ? 'Cryptographically verified' : (message.error || 'Verification failed');
          console.log(`[VIEWER] Updating resource status: ${message.url} -> ${status}`);
          this.updateResourceStatus(message.url, status, reason);
        }
      } else if (message.type === 'MAIN_CONTENT_VERIFICATION_UPDATE') {
        // Update main content verification status when it completes asynchronously
        // Main content verification status updated
        this.progressManager.setMainContentStatus(message.verified);
        this.progressManager.updateTrustIndicator();

        if (message.verified) {
          this.showToast(
            'Verification complete',
            'success',
            'Main content verified',
          );
        }
      } else if (message.type === 'VERIFICATION_PROGRESS') {
        // Update loading progress display if not cancelled
        if (!this.verificationCancelled) {
          this.progressManager.updateLoadingProgress(
            message.percentage,
            message.processedMB,
            message.totalMB,
          );
        }
      }
    });
  }

  // Removed service worker methods - not supported in extension pages


  setupEventHandlers() {
    // Minimize toggle
    const minimizeBtn = document.getElementById('minimizeToggle');
    minimizeBtn?.addEventListener('click', () => this.toggleMinimize());

    // Floating badge click (restore from minimized)
    const floatingBadge = document.getElementById('floatingBadge');
    floatingBadge?.addEventListener('click', () => this.toggleMinimize());

    // Verification details button
    const verificationDetailsBtn = document.getElementById('verificationDetailsBtn');
    verificationDetailsBtn?.addEventListener('click', () => this.toggleVerificationPanel());

    // Close verification panel
    const closeVerificationPanel = document.getElementById('closeVerificationPanel');
    closeVerificationPanel?.addEventListener('click', () => this.hideVerificationPanel());

    // URL navigation button
    const urlGoBtn = document.getElementById('urlGoBtn');
    urlGoBtn?.addEventListener('click', () => window.navigateToUrl());

    // URL input enter key
    const urlInput = document.getElementById('urlInput');
    urlInput?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        window.navigateToUrl();
      }
    });

    // Reverify button
    const reverifyBtn = document.getElementById('reverifyBtn');
    reverifyBtn?.addEventListener('click', () => window.reverifyContent());

    // Error page buttons
    const goBackBtn = document.getElementById('goBackBtn');
    goBackBtn?.addEventListener('click', () => window.history.back());

    const proceedBtn = document.getElementById('proceedBtn');
    proceedBtn?.addEventListener('click', () => window.proceedAnyway());

    // Skip verification button
    const skipBtn = document.getElementById('skipVerificationBtn');
    skipBtn?.addEventListener('click', () => this.skipVerification());

    // Share button
    const shareBtn = document.getElementById('shareBtn');
    shareBtn?.addEventListener('click', () => this.shareGatewayUrl());

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.toggleMinimize();
      } else if (e.ctrlKey && e.key === 'm') {
        this.toggleMinimize();
      }
    });

    // Listen for iframe load to start resource tracking
    const iframe = document.getElementById('verified-content');
    iframe?.addEventListener('load', () => {
      this.onIframeLoad();
    });
  }

  onIframeLoad() {
    // Don't reset stats on the initial page load
    if (!this.initialLoadComplete) {
      this.initialLoadComplete = true;
      console.log('[VIEWER] Initial load complete - preserving verification stats');
      return;
    }
    
    // Reset stats only for subsequent navigations
    console.log('[VIEWER] Iframe reloaded - resetting stats for new navigation');
    
    // Reset progress manager stats
    this.progressManager.reset();

    this.progressManager.updateTrustIndicator();

    // Try to intercept navigation from iframe using different approach
    try {
      const iframe = document.getElementById('verified-content');
      if (iframe && iframe.contentWindow) {
        // For same-origin content, we can try to access the document
        // Note: This will only work for content served with appropriate headers
        // Navigation interception check

        // Check if we can access the iframe content
        try {
          const iframeDoc =
            iframe.contentDocument || iframe.contentWindow.document;
          if (iframeDoc) {
            // We have access - set up click handler directly
            iframeDoc.addEventListener(
              'click',
              (e) => {
                let target = e.target;
                while (target && target.tagName !== 'A') {
                  target = target.parentElement;
                }

                if (target && target.href) {
                  const url = target.href;

                  // Check if it's an Arweave URL
                  if (
                    url.includes('arweave.net/') ||
                    url.includes('ar.io/') ||
                    url.startsWith('ar://')
                  ) {
                    e.preventDefault();

                    // Convert to ar:// URL
                    let arUrl = url;
                    if (url.includes('arweave.net/')) {
                      // Extract TX ID from arweave.net URLs
                      const txMatch = url.match(
                        /arweave\.net\/([a-zA-Z0-9_-]{43})/,
                      );
                      if (txMatch) {
                        arUrl = 'ar://' + txMatch[1];
                      }
                    } else if (
                      url.includes('.ar.io/') ||
                      url.includes('ar-io.')
                    ) {
                      // Handle ar.io gateway URLs
                      const match = url.match(/https?:\/\/[^\/]+\/(.*)/);
                      if (match) {
                        arUrl = 'ar://' + match[1];
                      }
                    }

                    // Intercepted Arweave link click

                    // Navigate to the new URL in the viewer
                    window.location.href = `viewer.html?url=${encodeURIComponent(arUrl)}`;
                  }
                }
              },
              true,
            );

            // Navigation interceptor installed
          }
        } catch (_accessError) {
          // Can't access iframe content directly - this is expected for cross-origin content
          // Cross-origin content - expected behavior
        }
      }
    } catch (_error) {
      // Navigation interception setup failed - expected for cross-origin
    }

    // Note: Resource verification is limited without service worker support in extension pages
    // Iframe loaded
  }

  toggleMinimize() {
    this.isMinimized = !this.isMinimized;
    document.body.classList.toggle('minimized', this.isMinimized);
  }



  async loadVerifiedContent() {
    try {
      this.progressManager.updateLoadingState('FETCHING');

      // Initial load

      // Show skip button after 5 seconds (only if verification is enabled)
      chrome.storage.local.get(['verifiedBrowsing'], ({ verifiedBrowsing }) => {
        if (verifiedBrowsing) {
          this.skipButtonTimeout = setTimeout(() => {
            const skipDiv = document.getElementById('skipVerification');
            if (skipDiv && !this.verificationCancelled) {
              skipDiv.classList.add('show');
            }
          }, 5000);
        }
      });

      // Request verified content from background
      const response = await chrome.runtime.sendMessage({
        type: 'FETCH_VERIFIED_CONTENT',
        url: this.arUrl,
      });

      // Response received from background

      if (!response) {
        throw new Error('No response from background script');
      }

      if (response.error) {
        throw new Error(response.error);
      }

      // Store the gateway URL for sharing
      if (response.gatewayUrl) {
        this.gatewayUrl = response.gatewayUrl;
        // Gateway URL received
      }

      this.progressManager.updateLoadingState('VERIFYING');

      // Update stats based on verification
      this.progressManager.setMainContentStatus(response.verified || false, 'complete');

      // Main content verification complete
      // Verification info received

      if (response.verified) {
        this.progressManager.updateLoadingState('COMPLETE');
        this.showToast('Main content verified', 'success');
      } else {
        // Show content with warning since verification failed
        this.progressManager.updateLoadingState('COMPLETE');
        this.showToast(
          'Verification pending',
          'warning',
          'Showing content while verification completes',
        );
      }

      // Update trust indicator to show main content status
      this.progressManager.updateTrustIndicator();

      // Load content into iframe
      await this.displayContent(response);

      // Main content verification is already tracked by ProgressManager
      // and displayed separately in the verification panel

      // Hide loading overlay
      const loadingOverlay = document.getElementById('loadingOverlay');
      if (loadingOverlay) {
        loadingOverlay.style.display = 'none';
      }

      // Clear skip button timeout and hide it
      this.clearSkipButton();

      // Update share button tooltip if we have a gateway URL
      if (this.gatewayUrl) {
        const shareBtn = document.getElementById('shareBtn');
        if (shareBtn) {
          // Add tooltip with the gateway URL
          shareBtn.title = `Share: ${this.gatewayUrl}`;
        }
      }
    } catch (error) {
      console.error('[VIEWER] Failed to load:', error.message || error);
      this.showError(error.message);

      // Clear skip button timeout
      this.clearSkipButton();
    }
  }

  skipVerification() {
    // Skip verification requested

    // Set flag to indicate verification was cancelled
    this.verificationCancelled = true;

    // Hide skip button
    this.clearSkipButton();

    // Update UI
    this.showToast(
      'Skipping verification',
      'warning',
      'Loading unverified content',
    );

    // Load content without verification by navigating directly to gateway
    // Use the gateway URL from query params if available, otherwise fallback
    const gatewayUrl =
      this.gatewayUrl || this.arUrl.replace('ar://', 'https://arweave.net/');
    const iframe = document.getElementById('verified-content');
    iframe.src = gatewayUrl;

    // Hide loading overlay
    const loadingOverlay = document.getElementById('loadingOverlay');
    if (loadingOverlay) {
      loadingOverlay.style.display = 'none';
    }

    // Update share button tooltip
    const shareBtn = document.getElementById('shareBtn');
    if (shareBtn) {
      shareBtn.title = `Share: ${gatewayUrl}`;
    }

    // Update trust indicator to show unverified
    this.progressManager.setMainContentStatus(false, 'complete');
    this.progressManager.updateTrustIndicator();
  }

  clearSkipButton() {
    if (this.skipButtonTimeout) {
      clearTimeout(this.skipButtonTimeout);
      this.skipButtonTimeout = null;
    }

    const skipDiv = document.getElementById('skipVerification');
    if (skipDiv) {
      skipDiv.classList.remove('show');
    }
  }

  async shareGatewayUrl() {
    if (!this.gatewayUrl) {
      // No gateway URL to share
      return;
    }

    const shareBtn = document.getElementById('shareBtn');
    const shareBtnText = shareBtn?.querySelector('span');

    try {
      await navigator.clipboard.writeText(this.gatewayUrl);

      // Update button text temporarily
      if (shareBtnText) {
        const originalText = shareBtnText.textContent;
        shareBtnText.textContent = 'Copied!';
        setTimeout(() => {
          shareBtnText.textContent = originalText;
        }, 2000);
      }

      // Show success toast
      this.showToast(
        'Link copied!',
        'success',
        `Gateway URL copied to clipboard`,
      );

      // Copied to clipboard
    } catch (_err) {
      // Copy failed

      // Show error toast
      this.showToast(
        'Copy failed',
        'error',
        'Unable to copy link to clipboard',
      );
    }
  }

  async displayContent(response) {
    const iframe = document.getElementById('verified-content');

    if (response.dataUrl) {
      // Small content - load via data URL
      iframe.src = response.dataUrl;
    } else if (response.cacheKey) {
      // Large content - load from cache
      const cache = await caches.open('wayfinder-verified');
      const cachedResponse = await cache.match(response.cacheKey);

      if (!cachedResponse) {
        throw new Error('Cached content not found');
      }

      const blob = await cachedResponse.blob();
      let contentType = cachedResponse.headers.get('content-type');

      // Special handling for manifests - check if it's JSON that might be a manifest
      if (contentType === 'application/json' && this.arUrl) {
        // Check if this looks like a manifest by examining the content
        try {
          const text = await blob.text();
          const json = JSON.parse(text);
          if (
            json.manifest === 'arweave/paths' &&
            (json.version === '0.2.0' || json.version === '0.1.0')
          ) {
            // Use manifest renderer for complete verification
            console.log('[VIEWER] Detected Arweave manifest, using manifest renderer');
            await this.manifestManager.renderManifest(text, response);
            return;
          }
        } catch (_e) {
          // Not a manifest, continue with regular JSON handling
        }
      }

      // Create blob URL for all content types
      const objectUrl = URL.createObjectURL(blob);

      // For HTML content, we need to ensure scripts can load
      if (contentType?.includes('text/html')) {
        // Check if the HTML contains external scripts that would be blocked by CSP
        const htmlContent = await blob.text();
        
        // Store HTML content for resource scanning
        this.lastHtmlContent = htmlContent;
        console.log('[VIEWER] Stored HTML content for resource scanning');
        
        // Check if we should use pre-fetch verification
        const hasScripts = /<script[^>]+src=["'][^"']+["']/i.test(htmlContent);
        const hasImages = /<img[^>]+src=["'][^"']+["']/i.test(htmlContent);
        const hasStylesheets = /<link[^>]+rel=["']stylesheet["'][^>]+href=["'][^"']+["']/i.test(htmlContent);
        const hasArweaveResources = this.containsArweaveResources(htmlContent);
        console.log('[VIEWER] Debug - hasArweaveResources:', hasArweaveResources);
        
        // Check for external scripts that would be blocked by CSP
        const externalScriptCheck = analyzeScripts(htmlContent);
        const hasExternalScripts = externalScriptCheck.hasExternalScripts;
        console.log('[VIEWER] Script analysis:', externalScriptCheck);
        
        // If we have external scripts (like CDNs), we must load from gateway
        // to avoid CSP restrictions, even if we also have Arweave resources
        if (hasExternalScripts) {
          console.log('[VIEWER] External CDN scripts detected, loading from gateway to bypass CSP');
          iframe.src = this.gatewayUrl || objectUrl;
          
          // Scan for Arweave resources that we can track
          setTimeout(() => {
            this.scanHtmlString(htmlContent);
            
            // When loading from gateway due to external scripts, individual resource verification
            // is not performed to maintain page functionality
            setTimeout(() => {
              this.resources.forEach(resource => {
                if (resource.status === 'pending' && !isExternalResource(resource.url)) {
                  this.updateResourceStatus(
                    resource.url, 
                    'skipped',
                    'Page contains external scripts - loaded via gateway for compatibility'
                  );
                }
              });
              this.updateVerificationPanel();
            }, 1000);
          }, 100);
          
          this.showToast(
            'External scripts detected',
            'warning',
            'Loading from gateway to ensure functionality. Some resources cannot be verified.'
          );
          
          // Mark loading as complete since we're loading from gateway
          this.progressManager.updateLoadingState('COMPLETE');
          return;
        }
        
        // Use pre-fetch verification if we have any Arweave resources to verify
        if (hasArweaveResources && (hasScripts || hasImages || hasStylesheets)) {
          console.log('[VIEWER] Initiating pre-fetch verification for HTML with Arweave resources');
          console.log('[VIEWER] Debug - hasScripts:', hasScripts, 'hasImages:', hasImages, 'hasStylesheets:', hasStylesheets);
          console.log('[VIEWER] Debug - gatewayUrl:', this.gatewayUrl);
          console.log('[VIEWER] Debug - response.manifest:', response.manifest);
          await this.performPreFetchVerification(htmlContent, response);
          return;
        }
        
        // Original resource scanning for non-pre-fetch mode
        setTimeout(() => {
          this.scanHtmlString(htmlContent);
        }, 100);
        
        // No external scripts - safe to use blob URL
        iframe.removeAttribute('sandbox');
        iframe.sandbox = 'allow-scripts allow-forms allow-popups allow-downloads allow-modals';
        iframe.src = objectUrl;
      } else {
        // For non-HTML content, create a viewer or use native display
        const viewerContent = this.contentManager.createContentViewer(objectUrl, contentType);
        if (viewerContent === null) {
          // Use native browser display (e.g., for PDFs)
          iframe.src = objectUrl;
        } else {
          iframe.srcdoc = viewerContent;
        }
      }

      // Clean up blob URL when done
      iframe.addEventListener('unload', () => {
        URL.revokeObjectURL(objectUrl);
      });
    }
  }



  // Toast methods now use imported toast manager
  showToast(title, type = 'info', message = '') {
    return toastShow(title, type, message);
  }

  showError(message) {
    // Update loading state
    this.progressManager.updateLoadingState('ERROR');

    // Update error message
    const errorMessage = document.getElementById('errorMessage');
    if (errorMessage) {
      errorMessage.textContent = message;
    }

    // Show error overlay
    const loadingOverlay = document.getElementById('loadingOverlay');
    const errorOverlay = document.getElementById('errorOverlay');
    if (loadingOverlay) loadingOverlay.style.display = 'none';
    if (errorOverlay) errorOverlay.style.display = 'flex';

    // Show error toast
    this.showToast('Verification Error', 'error', message);
  }

  // displayUrl() method removed - URL now displayed in navigation input

  // Resource tracking and verification panel methods
  addResource(url, type, status = 'pending', reason = null) {
    const resource = {
      url,
      type,
      status, // 'pending', 'verified', 'skipped', 'failed'
      reason,
      timestamp: Date.now()
    };
    this.resources.push(resource);
    this.updateVerificationPanel();
    console.log('[VIEWER] Added resource:', resource);
  }

  updateResourceStatus(url, status, reason = null) {
    console.log('[VIEWER] Looking for resource to update:', url);
    
    // Try to find resource by exact match first
    let resource = this.resources.find(r => r.url === url);
    
    // If not found, try to match ar:// URLs with chrome-extension proxy URLs
    if (!resource) {
      // Extract ar:// URL from chrome-extension proxy URL if present
      const proxyMatch = url.match(/wayfinder-proxy\.html\?url=([^&]+)/);
      if (proxyMatch) {
        const arUrl = decodeURIComponent(proxyMatch[1]);
        console.log('[VIEWER] Extracted ar:// URL from proxy:', arUrl);
        resource = this.resources.find(r => r.url === arUrl);
      }
      
      // Or check if the incoming URL is an ar:// URL and find matching proxy URL
      if (!resource && url.startsWith('ar://')) {
        resource = this.resources.find(r => {
          if (r.url.includes('wayfinder-proxy.html')) {
            const match = r.url.match(/wayfinder-proxy\.html\?url=([^&]+)/);
            if (match) {
              const decodedUrl = decodeURIComponent(match[1]);
              return decodedUrl === url;
            }
          }
          return false;
        });
      }
    }
    
    if (resource) {
      resource.status = status;
      resource.reason = reason;
      this.updateVerificationPanel();
      console.log('[VIEWER] Updated resource status:', { url: resource.url, status, reason });
    } else {
      console.log('[VIEWER] Could not find resource to update:', url);
    }
  }

  toggleVerificationPanel() {
    const panel = document.getElementById('verificationPanel');
    if (panel) {
      if (panel.style.display === 'none' || !panel.style.display) {
        this.showVerificationPanel();
      } else {
        this.hideVerificationPanel();
      }
    }
  }

  showVerificationPanel() {
    const panel = document.getElementById('verificationPanel');
    if (panel) {
      panel.style.display = 'block';
      this.updateVerificationPanel();
    }
  }

  hideVerificationPanel() {
    const panel = document.getElementById('verificationPanel');
    if (panel) {
      panel.style.display = 'none';
    }
  }

  updateVerificationPanel() {
    // Count resources
    let verifiedCount = this.resources.filter(r => r.status === 'verified').length;
    const skippedCount = this.resources.filter(r => r.status === 'skipped').length;
    let failedCount = this.resources.filter(r => r.status === 'failed').length;
    
    // Include main content in counts if it has been loaded
    const stats = this.progressManager.getStats();
    console.log('[VIEWER] Verification panel update - main content status:', stats.main);
    
    if (stats.main.status === 'complete' || stats.main.status === 'error') {
      if (this.progressManager.isMainContentVerified()) {
        verifiedCount++;
      } else {
        failedCount++;
      }
    }

    // Update summary counts
    const verifiedCountEl = document.getElementById('verifiedCount');
    const skippedCountEl = document.getElementById('skippedCount');
    const failedCountEl = document.getElementById('failedCount');

    if (verifiedCountEl) verifiedCountEl.textContent = verifiedCount;
    if (skippedCountEl) skippedCountEl.textContent = skippedCount;
    if (failedCountEl) failedCountEl.textContent = failedCount;

    // Update resource list
    this.updateResourceList();
  }

  updateResourceList() {
    const resourceList = document.getElementById('resourceList');
    if (!resourceList) return;

    resourceList.innerHTML = '';

    // Add main content
    const stats = this.progressManager.getStats();
    const mainVerified = this.progressManager.isMainContentVerified();
    const mainStatus = stats.main.status;
    
    // Only show main content if it has been loaded
    if (mainStatus === 'complete' || mainStatus === 'error') {
      const mainItem = document.createElement('div');
      mainItem.className = 'resource-item';
      mainItem.innerHTML = `
        <div class="resource-status ${mainVerified ? 'verified' : 'failed'}"></div>
        <div class="resource-info">
          <div class="resource-url">${this.arUrl}</div>
          <div class="resource-type">MAIN CONTENT</div>
          <div class="resource-reason">${mainVerified ? 'Cryptographically verified' : 'Verification failed'}</div>
        </div>
      `;
      resourceList.appendChild(mainItem);
    }

    // Add individual resources
    this.resources.forEach(resource => {
      const item = document.createElement('div');
      item.className = 'resource-item';
      
      const displayUrl = resource.url.length > 60 
        ? resource.url.substring(0, 57) + '...' 
        : resource.url;

      const reasonText = resource.reason || this.getDefaultReason(resource.status);

      item.innerHTML = `
        <div class="resource-status ${resource.status}"></div>
        <div class="resource-info">
          <div class="resource-url" title="${resource.url}">${displayUrl}</div>
          <div class="resource-type">${resource.type.toUpperCase()}</div>
          <div class="resource-reason">${reasonText}</div>
        </div>
      `;
      resourceList.appendChild(item);
    });
  }

  getDefaultReason(status) {
    switch (status) {
      case 'verified': return 'Cryptographically verified';
      case 'skipped': return 'External resource - not verified';
      case 'failed': return 'Verification failed';
      case 'pending': return 'Verification in progress...';
      default: return 'Unknown status';
    }
  }

  // Intercept resource loading to track them
  trackResourceLoading() {
    // Monitor iframe content loading
    const iframe = document.getElementById('verified-content');
    if (iframe) {
      iframe.addEventListener('load', () => {
        this.scanIframeResources();
        
        // Also listen for performance entries to track actual network requests
        this.trackPerformanceEntries();
      });
    }
  }
  
  trackPerformanceEntries() {
    console.log('[VIEWER] Setting up performance entry tracking...');
    
    // Try to get performance entries from the iframe
    const iframe = document.getElementById('verified-content');
    if (!iframe) return;
    
    // For content loaded from gateway, we might be able to track some requests
    try {
      // Monitor main window performance entries for proxy requests
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.name.includes('wayfinder-proxy.html')) {
            console.log('[VIEWER] Detected proxy request:', entry.name);
            
            // Extract the ar:// URL from the proxy URL
            const match = entry.name.match(/wayfinder-proxy\.html\?url=([^&]+)/);
            if (match) {
              const arUrl = decodeURIComponent(match[1]);
              console.log('[VIEWER] Proxy request for ar:// URL:', arUrl);
              
              // Check if we already have this resource tracked
              if (!this.resources.find(r => r.url === arUrl)) {
                const type = this.guessResourceType(arUrl);
                this.addResource(arUrl, type, 'pending', null);
              }
            }
          }
        }
      });
      
      observer.observe({ entryTypes: ['resource'] });
      
      // Also check existing entries
      const existingEntries = performance.getEntriesByType('resource');
      for (const entry of existingEntries) {
        if (entry.name.includes('wayfinder-proxy.html')) {
          console.log('[VIEWER] Found existing proxy request:', entry.name);
        }
      }
    } catch (error) {
      console.log('[VIEWER] Could not set up performance monitoring:', error.message);
    }
  }
  
  // Resource type guessing now uses imported utilities
  guessResourceType(url) {
    return guessResourceType(url);
  }

  scanIframeResources() {
    console.log('[VIEWER] Attempting to scan iframe resources...');
    
    try {
      const iframe = document.getElementById('verified-content');
      if (!iframe) {
        console.log('[VIEWER] No iframe found');
        return;
      }
      
      if (!iframe.contentDocument) {
        console.log('[VIEWER] Cannot access iframe.contentDocument (likely cross-origin)');
        // For cross-origin content, try to scan the HTML source instead
        this.scanFromHtmlSource();
        return;
      }

      const doc = iframe.contentDocument;
      console.log('[VIEWER] Scanning iframe content document...');
      
      // Scan scripts
      const scripts = doc.querySelectorAll('script[src]');
      console.log(`[VIEWER] Found ${scripts.length} scripts`);
      scripts.forEach(script => {
        const src = script.src;
        console.log('[VIEWER] Processing script:', src);
        if (src && !this.resources.find(r => r.url === src)) {
          const isExternal = this.isExternalResource(src);
          console.log(`[VIEWER] Script ${src} is ${isExternal ? 'external' : 'Arweave'}`);
          this.addResource(src, 'script', isExternal ? 'skipped' : 'pending', 
            isExternal ? 'External CDN resource' : null);
        }
      });

      // Scan stylesheets
      const links = doc.querySelectorAll('link[rel="stylesheet"]');
      console.log(`[VIEWER] Found ${links.length} stylesheets`);
      links.forEach(link => {
        const href = link.href;
        console.log('[VIEWER] Processing stylesheet:', href);
        if (href && !this.resources.find(r => r.url === href)) {
          const isExternal = this.isExternalResource(href);
          console.log(`[VIEWER] Stylesheet ${href} is ${isExternal ? 'external' : 'Arweave'}`);
          this.addResource(href, 'stylesheet', isExternal ? 'skipped' : 'pending',
            isExternal ? 'External CDN resource' : null);
        }
      });

      // Scan images
      const images = doc.querySelectorAll('img[src]');
      console.log(`[VIEWER] Found ${images.length} images`);
      images.forEach(img => {
        const src = img.src;
        console.log('[VIEWER] Processing image:', src);
        if (src && !this.resources.find(r => r.url === src)) {
          const isExternal = this.isExternalResource(src);
          console.log(`[VIEWER] Image ${src} is ${isExternal ? 'external' : 'Arweave'}`);
          this.addResource(src, 'image', isExternal ? 'skipped' : 'pending',
            isExternal ? 'External resource' : null);
        }
      });

    } catch (error) {
      // Cross-origin access blocked - this is expected for external content
      console.log('[VIEWER] Cannot scan iframe resources due to cross-origin restrictions:', error.message);
      // Try alternative approach
      this.scanFromHtmlSource();
    }
  }

  // Alternative scanning method for cross-origin content
  scanFromHtmlSource() {
    console.log('[VIEWER] Attempting to scan from HTML source...');
    
    // Try to get the HTML that was loaded
    const iframe = document.getElementById('verified-content');
    if (!iframe) return;
    
    // For content loaded from gateway directly, we can't scan it
    // But we can check if we have the HTML content from the verification process
    if (this.lastHtmlContent) {
      console.log('[VIEWER] Scanning stored HTML content for resources...');
      this.scanHtmlString(this.lastHtmlContent);
    } else {
      console.log('[VIEWER] No stored HTML content available for scanning');
    }
  }

  // URL resolution methods now use imported utilities
  resolveUrl(url) {
    return resolveUrl(url, this.arUrl);
  }

  isExternalResource(url) {
    return isExternalResource(url);
  }

  // Content analysis methods now use imported utilities
  containsArweaveResources(htmlContent) {
    return containsArweaveResources(htmlContent, this.isExternalResource.bind(this));
  }

  // HTML scanning now uses imported content analyzer
  scanHtmlString(htmlContent) {
    console.log('[VIEWER] Scanning HTML string for resources using content analyzer...');
    
    const resources = extractResourcesFromHtml(
      htmlContent, 
      this.arUrl, 
      this.isExternalResource.bind(this)
    );
    
    // Add each discovered resource to our tracking
    resources.forEach(resource => {
      if (!this.resources.find(r => r.url === resource.url)) {
        console.log(`[VIEWER] Found ${resource.type}: ${resource.url} (${resource.isExternal ? 'external' : 'Arweave'})`);
        this.addResource(resource.url, resource.type, resource.status, resource.reason);
      }
    });
  }

  // Pre-fetch verification methods
  /**
   * Render an Arweave manifest using the manifest renderer approach
   * @param {string} manifestText - Raw manifest JSON content
   * @param {Object} response - Background script response
   */

  /**
   * Verify critical resources first, then remaining resources
   * @param {ManifestRenderer} renderer - Manifest renderer instance
   * @param {Object} manifest - Parsed manifest 
   * @param {Object} strategy - Loading strategy configuration
   * @param {Function} progressCallback - Progress update callback
   * @returns {Map} Verified resources map
   */
  async verifyCriticalFirst(renderer, manifest, strategy, progressCallback) {
    console.log('[VIEWER] Using critical-first verification strategy');
    
    const allTxIds = renderer.extractTransactionIds(manifest);
    const criticalPaths = strategy.criticalResources;
    const criticalTxIds = new Set();
    
    // Map critical paths to transaction IDs
    for (const path of criticalPaths) {
      if (manifest.paths[path]) {
        criticalTxIds.add(manifest.paths[path].id);
      }
    }
    
    const verifiedResources = new Map();
    let totalProgress = { total: allTxIds.size, completed: 0, verified: 0, failed: 0 };
    
    // Phase 1: Verify critical resources first
    console.log(`[VIEWER] Phase 1: Verifying ${criticalTxIds.size} critical resources`);
    
    for (const txId of criticalTxIds) {
      try {
        const resource = await renderer.verifyResource(txId);
        verifiedResources.set(txId, resource);
        
        totalProgress.completed++;
        if (resource.verified) totalProgress.verified++;
        else totalProgress.failed++;
        
        progressCallback(totalProgress);
        
        // Show critical content as soon as index is ready
        if (criticalPaths.includes(manifest.index?.path)) {
          this.progressManager.updateLoadingState('LOADING');
        }
        
      } catch (error) {
        console.error(`[VIEWER] Failed to verify critical resource ${txId}:`, error);
        totalProgress.completed++;
        totalProgress.failed++;
        progressCallback(totalProgress);
      }
    }
    
    // Phase 2: Verify remaining resources in background
    const remainingTxIds = [...allTxIds].filter(txId => !criticalTxIds.has(txId));
    console.log(`[VIEWER] Phase 2: Verifying ${remainingTxIds.length} remaining resources`);
    
    // Process remaining resources in smaller batches
    const batchSize = 3;
    for (let i = 0; i < remainingTxIds.length; i += batchSize) {
      const batch = remainingTxIds.slice(i, i + batchSize);
      
      await Promise.all(batch.map(async (txId) => {
        try {
          const resource = await renderer.verifyResource(txId);
          verifiedResources.set(txId, resource);
          
          totalProgress.completed++;
          if (resource.verified) totalProgress.verified++;
          else totalProgress.failed++;
          
          progressCallback(totalProgress);
          
        } catch (error) {
          console.error(`[VIEWER] Failed to verify resource ${txId}:`, error);
          totalProgress.completed++;
          totalProgress.failed++;
          progressCallback(totalProgress);
        }
      }));
      
      // Small delay between batches to prevent overwhelming
      if (i + batchSize < remainingTxIds.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    return verifiedResources;
  }

  /**
   * Progressive verification with user control
   * @param {ManifestRenderer} renderer - Manifest renderer instance
   * @param {Object} manifest - Parsed manifest
   * @param {Object} strategy - Loading strategy configuration  
   * @param {Function} progressCallback - Progress update callback
   * @returns {Map} Verified resources map
   */
  async verifyProgressive(renderer, manifest, strategy, progressCallback) {
    console.log('[VIEWER] Using progressive verification strategy');
    
    const allTxIds = renderer.extractTransactionIds(manifest);
    const criticalPaths = strategy.criticalResources;
    const criticalTxIds = new Set();
    
    // Map critical paths to transaction IDs
    for (const path of criticalPaths) {
      if (manifest.paths[path]) {
        criticalTxIds.add(manifest.paths[path].id);
      }
    }
    
    const verifiedResources = new Map();
    let totalProgress = { total: allTxIds.size, completed: 0, verified: 0, failed: 0 };
    
    // Phase 1: Only verify critical resources
    console.log(`[VIEWER] Progressive: Verifying ${criticalTxIds.size} critical resources only`);
    
    for (const txId of criticalTxIds) {
      try {
        const resource = await renderer.verifyResource(txId);
        verifiedResources.set(txId, resource);
        
        totalProgress.completed++;
        if (resource.verified) totalProgress.verified++;
        else totalProgress.failed++;
        
        progressCallback(totalProgress);
        
      } catch (error) {
        console.error(`[VIEWER] Failed to verify critical resource ${txId}:`, error);
        totalProgress.completed++;
        totalProgress.failed++;
        progressCallback(totalProgress);
      }
    }
    
    // Show option to continue with remaining resources
    const shouldContinue = await this.contentManager.showProgressiveChoice(
      allTxIds.size - criticalTxIds.size,
      totalProgress.verified,
      totalProgress.failed
    );
    
    if (shouldContinue) {
      // Continue with remaining resources
      const remainingTxIds = [...allTxIds].filter(txId => !criticalTxIds.has(txId));
      
      for (const txId of remainingTxIds) {
        try {
          const resource = await renderer.verifyResource(txId);
          verifiedResources.set(txId, resource);
          
          totalProgress.completed++;
          if (resource.verified) totalProgress.verified++;
          else totalProgress.failed++;
          
          progressCallback(totalProgress);
          
        } catch (error) {
          console.error(`[VIEWER] Failed to verify resource ${txId}:`, error);
          totalProgress.completed++;
          totalProgress.failed++;
          progressCallback(totalProgress);
        }
      }
    } else {
      // Mark remaining as skipped for progress calculation
      const remaining = allTxIds.size - totalProgress.completed;
      totalProgress.completed = allTxIds.size;
      progressCallback(totalProgress);
    }
    
    return verifiedResources;
  }

  /**
   * Show user choice for progressive loading
   * @param {number} remainingCount - Number of remaining resources
   * @param {number} verified - Number of verified resources  
   * @param {number} failed - Number of failed resources
   * @returns {Promise<boolean>} User's choice to continue
   */

  /**
   * Attempt to recover from manifest verification failures
   * @param {string} manifestText - Original manifest content
   * @param {Error} error - The error that occurred
   * @returns {Promise<boolean>} Whether recovery was successful
   */
  async attemptManifestRecovery(manifestText, error) {
    console.log('[VIEWER] Attempting manifest recovery for error:', error.message);
    
    try {
      // Strategy 1: Try to parse as basic JSON and extract what we can
      let partialManifest = null;
      try {
        partialManifest = JSON.parse(manifestText);
      } catch (parseError) {
        console.log('[VIEWER] Recovery: JSON parsing failed, trying alternative approaches');
        return false;
      }
      
      // Strategy 2: Check if we can extract at least some valid paths
      if (partialManifest && partialManifest.paths && typeof partialManifest.paths === 'object') {
        const validPaths = {};
        let validCount = 0;
        
        for (const [path, pathData] of Object.entries(partialManifest.paths)) {
          if (pathData && pathData.id && /^[a-zA-Z0-9_-]{43}$/.test(pathData.id)) {
            validPaths[path] = pathData;
            validCount++;
          }
        }
        
        if (validCount > 0) {
          console.log(`[VIEWER] Recovery: Found ${validCount} valid paths out of ${Object.keys(partialManifest.paths).length}`);
          
          // Create a minimal working manifest
          const recoveredManifest = {
            manifest: 'arweave/paths',
            version: partialManifest.version || '0.2.0',
            paths: validPaths
          };
          
          // Try to render with the recovered manifest
          await this.renderRecoveredManifest(recoveredManifest, validCount, Object.keys(partialManifest.paths).length - validCount);
          return true;
        }
      }
      
      // Strategy 3: If manifest has an index, try to load just that
      if (partialManifest && partialManifest.index && partialManifest.index.id) {
        console.log('[VIEWER] Recovery: Attempting to load index file only');
        await this.loadIndexOnly(partialManifest.index.id);
        return true;
      }
      
      // Strategy 4: Check if this is actually a single file (not a manifest)
      if (this.arUrl && !manifestText.includes('"manifest"') && !manifestText.includes('arweave/paths')) {
        console.log('[VIEWER] Recovery: Content may not be a manifest, treating as single file');
        await this.loadAsSingleFile();
        return true;
      }
      
    } catch (recoveryError) {
      console.error('[VIEWER] Recovery attempt failed:', recoveryError);
    }
    
    return false;
  }

  /**
   * Render a partially recovered manifest
   * @param {Object} manifest - Recovered manifest with valid paths only
   * @param {number} validCount - Number of valid resources
   * @param {number} invalidCount - Number of invalid resources
   */
  async renderRecoveredManifest(manifest, validCount, invalidCount) {
    console.log('[VIEWER] Rendering recovered manifest');
    
    this.showToast(
      'Partial manifest recovery',
      'warning',
      `${validCount} resources recovered, ${invalidCount} resources skipped due to errors`
    );
    
    const renderer = new window.ManifestRenderer();
    
    try {
      // Use a simplified strategy for recovered manifests
      const strategy = {
        strategy: 'full-prefetch', // Simpler approach for recovered content
        resourceCount: validCount,
        criticalResources: Object.keys(manifest.paths).slice(0, 3), // First few paths as critical
        batchSize: 5
      };
      
      renderer.loadingStrategy = strategy;
      
      const progressCallback = (progress) => {
        this.updateManifestProgress(progress);
      };
      
      const verifiedResources = await renderer.verifyAllResources(manifest, progressCallback);
      const blobUrls = renderer.createBlobUrls(verifiedResources);
      
      // Determine what to render
      let contentToRender = null;
      let renderType = 'manifest';
      
      // Try to find and render index
      const indexPath = manifest.index?.path || Object.keys(manifest.paths)[0];
      if (indexPath && manifest.paths[indexPath]) {
        const indexTxId = manifest.paths[indexPath].id;
        if (verifiedResources.has(indexTxId) && verifiedResources.get(indexTxId).verified) {
          const indexResource = verifiedResources.get(indexTxId);
          if (indexResource.contentType.includes('text/html')) {
            const htmlContent = await indexResource.blob.text();
            contentToRender = renderer.rewriteHtmlContent(htmlContent, manifest, blobUrls);
            renderType = 'html';
          }
        }
      }
      
      // Display content
      const iframe = document.getElementById('verified-content');
      if (renderType === 'html' && contentToRender) {
        iframe.srcdoc = contentToRender;
        this.progressManager.setMainContentStatus(true);
      } else {
        // Show manifest explorer for recovered content
        const manifestViewer = this.contentManager.createManifestExplorer(manifest, verifiedResources, blobUrls);
        iframe.srcdoc = manifestViewer;
        this.progressManager.setMainContentStatus(validCount > 0);
      }
      
      this.progressManager.updateTrustIndicator();
      
      this.showToast(
        'Recovered manifest loaded',
        'success',
        `Successfully loaded ${validCount} verified resources`
      );
      
    } catch (error) {
      console.error('[VIEWER] Recovered manifest rendering failed:', error);
      throw error; // Re-throw to trigger final error handling
    }
  }

  /**
   * Load only the index file when manifest is corrupted
   * @param {string} indexTxId - Transaction ID of the index file
   */
  async loadIndexOnly(indexTxId) {
    console.log('[VIEWER] Loading index file only:', indexTxId);
    
    this.showToast(
      'Loading index only',
      'warning',
      'Manifest corrupted, loading index file without verification of other resources'
    );
    
    try {
      // Construct URL for index file
      const indexUrl = `ar://${indexTxId}`;
      
      // Navigate to the index file directly
      window.location.href = `viewer.html?url=${encodeURIComponent(indexUrl)}`;
      
    } catch (error) {
      console.error('[VIEWER] Failed to load index only:', error);
      throw error;
    }
  }

  /**
   * Load content as a single file when it's not actually a manifest
   */
  async loadAsSingleFile() {
    console.log('[VIEWER] Loading as single file, not manifest');
    
    this.showToast(
      'Not a manifest',
      'info',
      'Content appears to be a single file, not an Arweave manifest'
    );
    
    // Hide manifest UI and proceed with normal verification
    this.hideManifestVerificationUI();
    
    // Re-trigger normal content loading
    await this.loadVerifiedContent();
  }

  async performPreFetchVerification(htmlContent, response) {
    try {
      console.log('[VIEWER] Starting pre-fetch verification');
      
      // Show pre-fetch UI
      this.showPreFetchUI();
      
      // Create pre-fetch verifier
      const verifier = new window.PreFetchVerifier(this.arUrl, response.manifest);
      
      // Set up progress listener
      chrome.runtime.onMessage.addListener((message, _sender, _sendResponse) => {
        if (message.type === 'PREFETCH_PROGRESS') {
          this.progressManager.updatePreFetchProgress(message.progress);
        }
      });
      
      // Perform verification
      const result = await verifier.verifyAndPrepareContent(htmlContent, this.gatewayUrl);
      
      // Hide pre-fetch UI
      this.hidePreFetchUI();
      
      if (result.success) {
        console.log('[VIEWER] Pre-fetch verification successful');
        
        // Update verification stats
        this.progressManager.setMainContentStatus(true);
        this.progressManager.updateTrustIndicator();
        
        // Display the rewritten content
        const iframe = document.getElementById('verified-content');
        iframe.srcdoc = result.html;
        
        // Show success toast with security score
        this.showToast(
          'All resources verified',
          'success',
          `Security score: ${result.report.securityScore}%`
        );
        
        // Update resource panel with results
        result.report.details.forEach(resource => {
          this.addResource(
            resource.url,
            this.guessResourceType(resource.url),
            resource.status,
            resource.reason || (resource.status === 'verified' ? 'Cryptographically verified' : null)
          );
        });
        
      } else {
        console.log('[VIEWER] Pre-fetch verification failed');
        
        // Show error with option to proceed
        this.showError('Some resources could not be verified. You can proceed with caution or go back.');
      }
      
    } catch (error) {
      console.error('[VIEWER] Pre-fetch verification error:', error);
      this.hidePreFetchUI();
      this.showError('Pre-fetch verification failed: ' + error.message);
    }
  }

  showPreFetchUI() {
    const modal = document.getElementById('prefetchModal');
    if (modal) {
      modal.style.display = 'flex';
      
      // Show skip button after 5 seconds
      setTimeout(() => {
        const skipBtn = document.getElementById('skipPrefetch');
        if (skipBtn) {
          skipBtn.style.display = 'inline-block';
          skipBtn.onclick = () => this.skipPreFetch();
        }
      }, 5000);
    }
  }
  
  hidePreFetchUI() {
    const modal = document.getElementById('prefetchModal');
    if (modal) {
      modal.style.display = 'none';
    }
  }
  
  showManifestVerificationUI() {
    // Reuse the existing pre-fetch modal for manifest verification
    const modal = document.getElementById('prefetchModal');
    if (modal) {
      modal.style.display = 'flex';
      
      // Update title and text for manifest verification
      const title = modal.querySelector('h2');
      if (title) {
        title.textContent = 'Verifying Manifest Resources';
      }
      
      const description = modal.querySelector('p');
      if (description) {
        description.textContent = 'Ensuring all manifest resources are cryptographically verified before display';
      }
    }
  }
  
  hideManifestVerificationUI() {
    const modal = document.getElementById('prefetchModal');
    if (modal) {
      modal.style.display = 'none';
    }
  }
  
  
  skipPreFetch() {
    console.log('[VIEWER] User skipped pre-fetch verification');
    this.hidePreFetchUI();
    
    // Load content from gateway directly
    const iframe = document.getElementById('verified-content');
    iframe.src = this.gatewayUrl;
    
    // Update UI
    this.showToast(
      'Skipped pre-fetch verification', 
      'warning',
      'Loading content without full verification'
    );
    
    // Update trust indicator
    this.progressManager.setMainContentStatus(false);
    this.progressManager.updateTrustIndicator();
  }

  /**
   * Create a manifest explorer interface for viewing manifest contents
   * @param {Object} manifest - Parsed manifest object
   * @param {Map} verifiedResources - Map of txId -> resource data
   * @param {Map} blobUrls - Map of txId -> blob URL
   * @returns {string} HTML content for manifest explorer
   */

  /**
   * Guess resource type from content type
   * @param {string} contentType - MIME type
   * @returns {string} Resource type for categorization
   * @deprecated Use guessResourceTypeFromContentType from content-analyzer.js instead
   */
  guessResourceTypeFromContentType(contentType) {
    // This method is now consolidated into content-analyzer.js
    // Keeping for backwards compatibility, but should be removed in Phase 2
    return this.guessResourceType(contentType);
  }
}

// Global function for navigation
window.navigateToUrl = function () {
  const urlInput = document.getElementById('urlInput');
  const url = urlInput?.value?.trim();

  if (url) {
    // Add ar:// prefix if not present
    const fullUrl = url.startsWith('ar://') ? url : `ar://${url}`;

    // Reload the viewer with new URL
    window.location.href = `viewer.html?url=${encodeURIComponent(fullUrl)}`;
  }
};

// Global function for reverification
window.reverifyContent = async function () {
  const browser = window.verifiedBrowser;
  if (!browser) return;

  // Add loading state to button
  const reverifyBtn = document.getElementById('reverifyBtn');
  reverifyBtn?.classList.add('loading');

  // Reset stats
  browser.stats.main = { verified: false, status: 'pending' };
  Object.keys(browser.stats.resources).forEach((type) => {
    browser.stats.resources[type] = { total: 0, verified: 0 };
  });

  // Clear existing iframe content
  const iframe = document.getElementById('verified-content');

  // Try to stop any playing media in the iframe first
  try {
    // Access iframe content and pause any media elements
    const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
    if (iframeDoc) {
      // Pause all video elements
      const videos = iframeDoc.querySelectorAll('video');
      videos.forEach((video) => {
        video.pause();
        video.src = '';
        video.load();
      });

      // Pause all audio elements
      const audios = iframeDoc.querySelectorAll('audio');
      audios.forEach((audio) => {
        audio.pause();
        audio.src = '';
        audio.load();
      });
    }
  } catch (_e) {
    // Ignore errors - might be cross-origin
    // Could not access iframe content to stop media
  }

  // Clear the iframe completely
  iframe.src = 'about:blank';

  // Force a new browsing context to ensure everything stops
  iframe.contentWindow?.location.replace('about:blank');

  // Show loading overlay
  const loadingOverlay = document.getElementById('loadingOverlay');
  const errorOverlay = document.getElementById('errorOverlay');
  if (loadingOverlay) loadingOverlay.style.display = 'flex';
  if (errorOverlay) errorOverlay.style.display = 'none';

  // Reset progress display
  browser.progressShown = false;
  const progressEl = document.getElementById('loadingProgress');
  if (progressEl) {
    progressEl.style.display = 'none';
  }
  const loadingPercent = document.getElementById('loadingPercent');
  const loadingMB = document.getElementById('loadingMB');
  if (loadingPercent) loadingPercent.textContent = '0%';
  if (loadingMB) loadingMB.textContent = '';

  // Reset skip button
  browser.clearSkipButton();
  browser.verificationCancelled = false;

  // Reset gateway URL
  browser.gatewayUrl = null;

  // Update loading state
  browser.updateLoadingState('INITIALIZING');

  // Clear any existing toasts
  const toastContainer = document.getElementById('toastContainer');
  if (toastContainer) {
    toastContainer.innerHTML = '';
  }

  // Show reverification toast
  browser.showToast(
    'Reverifying content',
    'info',
    'Running integrity checks...',
  );

  try {
    // Re-run verification process
    await browser.loadVerifiedContent();

    // Remove loading state from button
    reverifyBtn?.classList.remove('loading');
  } catch (error) {
    console.error('[VIEWER] Reverification failed:', error.message || error);
    reverifyBtn?.classList.remove('loading');
    browser.showError(error.message);
  }
};

// Remove duplicate event listener - now handled in setupEventHandlers

// Global function for "Proceed Anyway" button
window.proceedAnyway = async function () {
  // Hide error overlay
  const errorOverlay = document.getElementById('errorOverlay');
  if (errorOverlay) {
    errorOverlay.style.display = 'none';
  }

  // Get the URL and load without verification
  const params = new URLSearchParams(window.location.search);
  const arUrl = params.get('url');
  const gatewayParam = params.get('gateway');

  if (arUrl) {
    let gatewayUrl = gatewayParam;
    
    // If no gateway URL was provided, properly resolve the ar:// URL
    if (!gatewayUrl) {
      try {
        console.log('[VIEWER] Resolving ar:// URL for proceed anyway:', arUrl);
        const response = await chrome.runtime.sendMessage({
          type: 'convertArUrlToHttpUrl',
          arUrl: arUrl
        });
        
        if (response && response.url) {
          gatewayUrl = response.url;
          console.log('[VIEWER] Resolved URL for proceed anyway:', gatewayUrl);
        } else {
          throw new Error('URL resolution failed');
        }
      } catch (error) {
        console.error('[VIEWER] Failed to resolve ar:// URL, using fallback:', error);
        // Only use arweave.net fallback if URL resolution completely fails
        gatewayUrl = arUrl.replace('ar://', 'https://arweave.net/');
      }
    }
    
    const iframe = document.getElementById('verified-content');
    if (iframe) {
      iframe.src = gatewayUrl;
    }

    // Update UI to show unverified state
    const browser = window.verifiedBrowser;
    if (browser) {
      browser.gatewayUrl = gatewayUrl; // Store for sharing

      // Update share button tooltip
      const shareBtn = document.getElementById('shareBtn');
      if (shareBtn) {
        shareBtn.title = `Share: ${gatewayUrl}`;
      }

      browser.showToast(
        'Loading unverified content',
        'warning',
        'Proceed with caution',
      );
      browser.updateLoadingState('COMPLETE');
      
      // Update trust indicator to show unverified state
      browser.stats.main.verified = false;
      browser.stats.main.status = 'complete';
      browser.updateTrustIndicator();
    }
  }
}

// Duplicate navigateToUrl function removed - keeping only the first instance

// Global function for copying URL
window.copyUrl = async function () {
  const urlValue = document.getElementById('urlValue');
  if (urlValue) {
    try {
      await navigator.clipboard.writeText(urlValue.textContent);
      window.verifiedBrowser.showToast(
        'URL copied',
        'success',
        'AR URL copied to clipboard',
      );
    } catch (_err) {
      window.verifiedBrowser.showToast(
        'Copy failed',
        'error',
        'Unable to copy URL',
      );
    }
  }
};

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
  window.verifiedBrowser = new VerifiedBrowser();
  window.verifiedBrowser.initialize();
});
