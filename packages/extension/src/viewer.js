/**
 * Wayfinder Verified Browsing - Phase 2 Implementation
 * Adds Service Worker integration for comprehensive resource verification
 */

class VerifiedBrowser {
  constructor() {
    this.stats = {
      main: { status: 'pending', verified: false },
      resources: {
        scripts: { total: 0, verified: 0 },
        styles: { total: 0, verified: 0 },
        media: { total: 0, verified: 0 },
        api: { total: 0, verified: 0 },
      },
    };

    this.isMinimized = false;
    this.arUrl = null;
    this.serviceWorker = null;
    this.swMessageChannel = null;
    this.progressShown = false;
    this.skipButtonTimeout = null;
    this.verificationCancelled = false;
    this.gatewayUrl = null;
    this.resources = []; // Track individual resource verification
    this.verificationPanel = null;

    this.loadingStates = {
      INITIALIZING: 'Initializing secure environment...',
      FETCHING: 'Fetching content from gateway...',
      VERIFYING: 'Verifying content integrity...',
      LOADING: 'Loading verified content...',
      COMPLETE: 'All content verified',
      ERROR: 'Verification failed',
    };
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

    // Register service worker for resource interception
    await this.registerServiceWorker();

    // Start verification process
    await this.loadVerifiedContent();
  }

  async registerServiceWorker() {
    // Service workers cannot be registered from extension pages in Manifest V3
    // Instead, we'll monitor resource loading through the iframe and verify via background script
    // Resource verification handled by background script

    // Set up message listener for resource verification updates from background
    chrome.runtime.onMessage.addListener((message, _sender, _sendResponse) => {
      if (message.type === 'RESOURCE_VERIFICATION_UPDATE') {
        console.log('[VIEWER] Received resource verification update:', message);
        this.updateResourceStats(message.resourceType, message.verified);
        
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
        this.stats.main.verified = message.verified;
        this.updateTrustIndicator();

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
          this.updateLoadingProgress(
            message.percentage,
            message.processedMB,
            message.totalMB,
          );
        }
      }
    });
  }

  // Removed service worker methods - not supported in extension pages

  updateResourceStats(resourceType, verified) {
    // Increment total count for this resource type
    if (this.stats.resources[resourceType]) {
      this.stats.resources[resourceType].total++;
      if (verified) {
        this.stats.resources[resourceType].verified++;
      }
    }

    // Update trust indicator
    this.updateTrustIndicator();

    // Start tracking resource loading
    this.trackResourceLoading();
  }

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
    // Reset resource stats for new page
    Object.keys(this.stats.resources).forEach((type) => {
      this.stats.resources[type] = { total: 0, verified: 0 };
    });

    this.updateTrustIndicator();

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

  updateLoadingState(state, _details = '') {
    // Update loading text
    const loadingText = document.getElementById('loadingText');
    if (loadingText) {
      loadingText.textContent = this.loadingStates[state] || 'Loading...';
    }

    // Update status text in header
    const statusText = document.getElementById('statusText');
    if (statusText && state === 'INITIALIZING') {
      statusText.textContent = 'Initializing';
    } else if (statusText && state === 'FETCHING') {
      statusText.textContent = 'Fetching';
    } else if (statusText && state === 'VERIFYING') {
      statusText.textContent = 'Verifying';
    }

    // Update trust indicator based on state
    if (state === 'COMPLETE' || state === 'ERROR') {
      this.updateTrustIndicator();
    }
  }

  updateLoadingProgress(percentage, processedMB, totalMB) {
    const progressEl = document.getElementById('loadingProgress');
    const percentEl = document.getElementById('loadingPercent');
    const mbEl = document.getElementById('loadingMB');

    if (progressEl && percentEl && mbEl) {
      // Show progress once we start getting updates
      if (!this.progressShown) {
        progressEl.style.display = 'block';
        this.progressShown = true;
      }

      // Update percentage
      percentEl.textContent = `${Math.round(percentage)}%`;

      // Update MB progress
      mbEl.textContent = `${processedMB} MB / ${totalMB} MB`;

      // Update loading text based on progress
      const loadingText = document.getElementById('loadingText');
      if (loadingText) {
        if (percentage < 100) {
          loadingText.textContent = 'Verifying content integrity...';
        } else {
          loadingText.textContent = 'Finalizing verification...';
        }
      }
    }
  }

  async loadVerifiedContent() {
    try {
      this.updateLoadingState('FETCHING');

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

      this.updateLoadingState('VERIFYING');

      // Update stats based on verification
      this.stats.main.verified = response.verified || false;
      this.stats.main.status = 'complete';

      // Main content verification complete
      // Verification info received

      if (response.verified) {
        this.updateLoadingState('COMPLETE');
        this.showToast('Main content verified', 'success');
      } else {
        // Show content with warning since verification failed
        this.updateLoadingState('COMPLETE');
        this.showToast(
          'Verification pending',
          'warning',
          'Showing content while verification completes',
        );
      }

      // Update trust indicator to show main content status
      this.updateTrustIndicator();

      // Load content into iframe
      await this.displayContent(response);

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
    this.stats.main.verified = false;
    this.stats.main.status = 'complete';
    this.updateTrustIndicator();
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
            contentType = 'application/x.arweave-manifest+json';
            // Detected Arweave manifest
          }
          // Create new blob since we consumed the original
          const newBlob = new Blob([text], { type: contentType });
          const objectUrl = URL.createObjectURL(newBlob);

          // For manifests, create special viewer
          const viewerContent = this.createContentViewer(
            objectUrl,
            contentType,
          );
          if (viewerContent === null) {
            iframe.src = objectUrl;
          } else {
            iframe.srcdoc = viewerContent;
          }

          // Clean up blob URL when done
          iframe.addEventListener('unload', () => {
            URL.revokeObjectURL(objectUrl);
          });
          return;
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
        
        // Scan for resources immediately
        setTimeout(() => {
          this.scanHtmlString(htmlContent);
        }, 100);
        
        const hasExternalScripts = /<script[^>]+src=["']https?:\/\/(?!.*ar\.io|.*arweave|.*g8way)[^"']+["']/i.test(htmlContent);
        const hasInlineScripts = /<script(?![^>]*src=)[^>]*>[\s\S]*?<\/script>/i.test(htmlContent);
        
        if (hasExternalScripts || hasInlineScripts) {
          // Content has scripts that would be blocked by extension CSP
          // Load from gateway directly to bypass CSP restrictions
          iframe.removeAttribute('sandbox');
          iframe.sandbox = 'allow-scripts allow-same-origin allow-forms allow-popups allow-downloads allow-modals';
          
          // Use the gateway URL directly - this should be set from the background response
          let gatewayUrl = this.gatewayUrl;
          console.log('[VIEWER] this.gatewayUrl:', this.gatewayUrl);
          
          if (!gatewayUrl) {
            // Extract from URL params 
            const urlParams = new URLSearchParams(window.location.search);
            gatewayUrl = urlParams.get('gateway');
            console.log('[VIEWER] Gateway from URL params:', gatewayUrl);
            
            if (!gatewayUrl && this.arUrl) {
              // Last resort: construct basic arweave.net URL (but this shouldn't happen)
              const txId = this.arUrl.replace('ar://', '');
              gatewayUrl = `https://arweave.net/${txId}`;
              console.log('[VIEWER] Constructed fallback URL:', gatewayUrl);
            }
          }
          
          console.log('[VIEWER] Loading from gateway URL:', gatewayUrl);
          iframe.src = gatewayUrl;
          
          // Update trust indicator to show partial verification
          setTimeout(() => {
            const trustIndicator = document.getElementById('trustIndicator');
            const trustLabel = document.getElementById('trustLabel');
            const trustDetails = document.getElementById('trustDetails');
            if (trustIndicator && trustLabel && trustDetails) {
              trustLabel.textContent = '⚠️ Partially Verified';
              trustIndicator.className = 'trust-indicator partial';
              trustDetails.textContent = 'Main content verified. External resources loaded without verification due to browser restrictions.';
            }
          }, 100);
          
          // Show a toast notification
          this.showToast(
            'Loading with external scripts',
            'warning',
            'Content contains external scripts. Loading from gateway to ensure functionality.'
          );
        } else {
          // No problematic scripts - safe to use blob URL
          iframe.removeAttribute('sandbox');
          iframe.sandbox = 'allow-scripts allow-same-origin allow-forms allow-popups allow-downloads allow-modals';
          iframe.src = objectUrl;
        }
      } else {
        // For non-HTML content, create a viewer or use native display
        const viewerContent = this.createContentViewer(objectUrl, contentType);
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

  createContentViewer(url, contentType) {
    const type = contentType || 'unknown';

    if (type.startsWith('image/')) {
      return `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { margin: 0; display: flex; justify-content: center; align-items: center; min-height: 100vh; background: #f5f5f5; }
            img { max-width: 100%; height: auto; }
          </style>
        </head>
        <body>
          <img src="${url}" alt="Verified content">
        </body>
        </html>
      `;
    } else if (type.startsWith('video/')) {
      return `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { margin: 0; display: flex; justify-content: center; align-items: center; min-height: 100vh; background: #000; }
            video { max-width: 100%; height: auto; }
          </style>
        </head>
        <body>
          <video src="${url}" controls autoplay></video>
        </body>
        </html>
      `;
    } else if (type.startsWith('audio/')) {
      return `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { 
              margin: 0; 
              display: flex; 
              justify-content: center; 
              align-items: center; 
              min-height: 100vh; 
              background: #1a1a1a;
              font-family: system-ui, -apple-system, sans-serif;
            }
            .audio-container {
              background: #2a2a2a;
              padding: 40px;
              border-radius: 12px;
              box-shadow: 0 4px 20px rgba(0,0,0,0.5);
              text-align: center;
            }
            .audio-icon {
              font-size: 64px;
              margin-bottom: 20px;
            }
            audio {
              width: 300px;
              margin: 20px 0;
            }
            .download-link {
              color: #2dd4bf;
              text-decoration: none;
              font-size: 14px;
              padding: 8px 16px;
              border: 1px solid #2dd4bf;
              border-radius: 6px;
              display: inline-block;
              margin-top: 10px;
              transition: all 0.2s;
            }
            .download-link:hover {
              background: #2dd4bf;
              color: #000;
            }
          </style>
        </head>
        <body>
          <div class="audio-container">
            <div class="audio-icon">🎵</div>
            <audio src="${url}" controls autoplay></audio>
            <br>
            <a href="${url}" download class="download-link">Download Audio</a>
          </div>
        </body>
        </html>
      `;
    } else if (type === 'application/pdf') {
      // For PDFs, use iframe to show native PDF viewer
      return null; // Signal to use iframe.src directly
    } else if (type === 'application/x.arweave-manifest+json') {
      // For manifests, we need to fetch and parse them differently
      // Since we have the blob URL, we can fetch it directly
      return `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { 
              font-family: system-ui, -apple-system, sans-serif; 
              margin: 0;
              display: flex;
              justify-content: center;
              align-items: center;
              min-height: 100vh;
              background: #1a1a1a;
              color: #fff;
            }
            .manifest-container {
              background: #2a2a2a;
              padding: 40px;
              border-radius: 12px;
              box-shadow: 0 4px 20px rgba(0,0,0,0.5);
              text-align: center;
              max-width: 500px;
            }
            .manifest-icon {
              font-size: 64px;
              margin-bottom: 20px;
            }
            h2 {
              margin: 0 0 10px 0;
              color: #2dd4bf;
            }
            .loading {
              color: #999;
              margin: 20px 0;
            }
            .error {
              color: #ff6b6b;
              margin: 20px 0;
            }
            .manifest-info {
              text-align: left;
              background: #1a1a1a;
              padding: 20px;
              border-radius: 8px;
              margin-top: 20px;
              font-family: monospace;
              font-size: 12px;
              max-height: 300px;
              overflow-y: auto;
            }
          </style>
          <script>
            // Fetch the manifest from the blob URL (which will work)
            fetch('${url}')
              .then(res => res.json())
              .then(manifest => {
                // Manifest loaded
                
                if (manifest.index && manifest.index.path) {
                  // Get the current AR URL from viewer
                  const currentUrl = new URL(window.location.href);
                  const arUrl = currentUrl.searchParams.get('url');
                  
                  // Manifest index found
                  
                  if (arUrl) {
                    // Parse the current AR URL to get the base
                    const match = arUrl.match(/^ar:\\/\\/([^/]+)/);
                    if (match) {
                      const txId = match[1];
                      // Build the index URL
                      const indexUrl = 'ar://' + txId + '/' + manifest.index.path;
                      
                      // Redirecting to index
                      document.querySelector('.loading').textContent = 'Redirecting to ' + manifest.index.path + '...';
                      
                      // Redirect to the index file using viewer.html
                      setTimeout(() => {
                        window.top.location.href = 'viewer.html?url=' + encodeURIComponent(indexUrl);
                      }, 1000);
                    } else {
                      document.querySelector('.loading').className = 'error';
                      document.querySelector('.error').textContent = 'Invalid AR URL format';
                    }
                  } else {
                    document.querySelector('.loading').className = 'error';
                    document.querySelector('.error').textContent = 'Could not determine manifest AR URL';
                  }
                } else {
                  // Show manifest contents if no index
                  document.querySelector('.loading').textContent = 'No index file specified. Manifest contents:';
                  const info = document.createElement('pre');
                  info.className = 'manifest-info';
                  info.textContent = JSON.stringify(manifest, null, 2);
                  document.querySelector('.manifest-container').appendChild(info);
                }
              })
              .catch(err => {
                console.error('[VIEWER] Manifest fetch failed:', err.message || err);
                document.querySelector('.loading').className = 'error';
                document.querySelector('.error').textContent = 'Error loading manifest: ' + (err.message || 'Unknown error');
                // Prevent further errors by not propagating
              });
          </script>
        </head>
        <body>
          <div class="manifest-container">
            <div class="manifest-icon">📂</div>
            <h2>Arweave Manifest</h2>
            <p class="loading">Loading manifest...</p>
          </div>
        </body>
        </html>
      `;
    } else if (
      type.startsWith('text/plain') ||
      type.startsWith('text/csv') ||
      (type.startsWith('application/json') && !type.includes('manifest')) ||
      type.startsWith('application/xml') ||
      type.includes('javascript') ||
      type.includes('css')
    ) {
      // For text-based content, let browser display natively
      return null;
    } else {
      // For unknown types, provide a nice download interface
      const fileName = url.split('/').pop() || 'file';
      return `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { 
              font-family: system-ui, -apple-system, sans-serif; 
              margin: 0;
              display: flex;
              justify-content: center;
              align-items: center;
              min-height: 100vh;
              background: #1a1a1a;
              color: #fff;
            }
            .download-container {
              background: #2a2a2a;
              padding: 40px;
              border-radius: 12px;
              box-shadow: 0 4px 20px rgba(0,0,0,0.5);
              text-align: center;
              max-width: 400px;
            }
            .file-icon {
              font-size: 64px;
              margin-bottom: 20px;
            }
            h2 {
              margin: 0 0 10px 0;
              color: #2dd4bf;
            }
            .file-type {
              color: #999;
              margin-bottom: 30px;
              font-size: 14px;
            }
            .download-btn {
              background: #2dd4bf;
              color: #000;
              text-decoration: none;
              font-size: 16px;
              font-weight: 600;
              padding: 12px 24px;
              border-radius: 8px;
              display: inline-block;
              transition: all 0.2s;
            }
            .download-btn:hover {
              background: #5eead4;
              transform: translateY(-2px);
              box-shadow: 0 4px 12px rgba(45, 212, 191, 0.3);
            }
            .open-link {
              color: #999;
              font-size: 12px;
              margin-top: 20px;
              display: block;
            }
            .open-link a {
              color: #2dd4bf;
              text-decoration: none;
            }
            .open-link a:hover {
              text-decoration: underline;
            }
          </style>
        </head>
        <body>
          <div class="download-container">
            <div class="file-icon">📄</div>
            <h2>Verified Content Ready</h2>
            <p class="file-type">Content Type: ${type || 'Unknown'}</p>
            <a href="${url}" download="${fileName}" class="download-btn">Download File</a>
            <p class="open-link">
              Or <a href="${url}" target="_blank">open in new tab</a>
            </p>
          </div>
        </body>
        </html>
      `;
    }
  }

  updateTrustIndicator() {
    const { scripts, styles, media, api } = this.stats.resources;

    // Calculate totals - only count main if it's been loaded
    const mainIncluded =
      this.stats.main.status === 'complete' ||
      this.stats.main.status === 'error';
    const totalResources =
      scripts.total +
      styles.total +
      media.total +
      api.total +
      (mainIncluded ? 1 : 0);
    const verifiedResources =
      scripts.verified +
      styles.verified +
      media.verified +
      api.verified +
      (mainIncluded && this.stats.main.verified ? 1 : 0);
    const unverifiedResources = totalResources - verifiedResources;

    // Calculate trust percentage
    const trustPercentage =
      totalResources > 0
        ? Math.round((verifiedResources / totalResources) * 100)
        : 0;

    // Update trust icon and status
    const trustIcon = document.getElementById('trustIcon');
    const trustLabel = document.getElementById('trustLabel');
    const trustDetails = document.getElementById('trustDetails');
    const trustIndicator = document.getElementById('trustIndicator');
    const checkmark = trustIcon?.querySelector('.checkmark');

    // Show progress until we have some resources
    if (totalResources === 0) {
      if (trustIcon) trustIcon.className = 'trust-icon';
      if (trustIndicator) trustIndicator.className = 'trust-indicator';
      if (trustLabel) trustLabel.textContent = 'Loading';
      if (trustDetails) trustDetails.textContent = 'Fetching content...';
      if (checkmark) checkmark.style.display = 'none';
    } else if (totalResources === 1 && this.stats.main.verified) {
      // Only main page loaded and verified
      if (trustIcon) trustIcon.className = 'trust-icon verified';
      if (trustIndicator) trustIndicator.className = 'trust-indicator complete';
      if (trustLabel) trustLabel.textContent = 'Page Verified';
      if (trustDetails) trustDetails.textContent = 'Content integrity confirmed';
      if (checkmark) checkmark.style.display = 'block';
    } else if (totalResources > 1 && unverifiedResources === 0) {
      // All resources verified
      if (trustIcon) trustIcon.className = 'trust-icon verified';
      if (trustIndicator) trustIndicator.className = 'trust-indicator complete';
      if (trustLabel) trustLabel.textContent = 'Fully Verified';
      if (trustDetails) trustDetails.textContent = `All ${totalResources} resources checked`;
      if (checkmark) checkmark.style.display = 'block';
    } else if (unverifiedResources > 0) {
      // Some resources not verified
      const verifiedCount = totalResources - unverifiedResources;
      if (trustIcon) trustIcon.className = 'trust-icon warning';
      if (trustIndicator) trustIndicator.className = 'trust-indicator warning';
      if (trustLabel) trustLabel.textContent = 'Partially Verified';
      if (trustDetails) trustDetails.textContent = `${verifiedCount} of ${totalResources} resources verified`;
      if (checkmark) checkmark.style.display = 'none';
    } else {
      // Main page not verified
      if (trustIcon) trustIcon.className = 'trust-icon error';
      if (trustIndicator) trustIndicator.className = 'trust-indicator error';
      if (trustLabel) trustLabel.textContent = 'Not Verified';
      if (trustDetails) trustDetails.textContent = 'Content could not be verified';
      if (checkmark) checkmark.style.display = 'none';
    }

    // Update progress bar
    const progress = document.getElementById('progress');
    if (progress) {
      progress.style.width = `${trustPercentage}%`;

      // Add active class when verifying
      if (trustPercentage > 0 && trustPercentage < 100) {
        progress.classList.add('active');
      } else {
        progress.classList.remove('active');
      }
    }

    // Removed floating badge

    // Show completion message
    if (totalResources > 1 && unverifiedResources === 0) {
      this.updateLoadingState('COMPLETE');
    }
  }

  showToast(title, type = 'info', message = '') {
    const container = document.getElementById('toastContainer');
    if (!container) {
      console.warn('[VIEWER] Toast container not found');
      return;
    }

    // Create toast element
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const icon =
      {
        success: '✓',
        warning: '⚠',
        error: '✗',
        info: 'ℹ',
      }[type] || 'ℹ';

    toast.innerHTML = `
      <div class="toast-icon">${icon}</div>
      <div class="toast-content">
        <div class="toast-title">${title}</div>
        ${message ? `<div class="toast-message">${message}</div>` : ''}
      </div>
      <button class="toast-close">✕</button>
    `;

    // Add click handler to close button
    const closeBtn = toast.querySelector('.toast-close');
    closeBtn.addEventListener('click', () => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(100%)';
      setTimeout(() => toast.remove(), 300);
    });

    container.appendChild(toast);

    // Auto-remove after 5 seconds
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(100%)';
      setTimeout(() => toast.remove(), 300);
    }, 5000);
  }

  showError(message) {
    // Update loading state
    this.updateLoadingState('ERROR');

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

  displayUrl() {
    // Removed - URL now displayed in navigation input
  }

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
    const verifiedCount = this.resources.filter(r => r.status === 'verified').length;
    const skippedCount = this.resources.filter(r => r.status === 'skipped').length;
    const failedCount = this.resources.filter(r => r.status === 'failed').length;

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
    const mainItem = document.createElement('div');
    mainItem.className = 'resource-item';
    mainItem.innerHTML = `
      <div class="resource-status ${this.stats.main.verified ? 'verified' : 'failed'}"></div>
      <div class="resource-info">
        <div class="resource-url">${this.arUrl}</div>
        <div class="resource-type">MAIN CONTENT</div>
        <div class="resource-reason">${this.stats.main.verified ? 'Cryptographically verified' : 'Verification failed'}</div>
      </div>
    `;
    resourceList.appendChild(mainItem);

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
  
  guessResourceType(url) {
    const ext = url.split('.').pop()?.toLowerCase();
    if (['js', 'mjs'].includes(ext)) return 'script';
    if (['css'].includes(ext)) return 'stylesheet';
    if (['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp'].includes(ext)) return 'image';
    if (['woff', 'woff2', 'ttf', 'otf'].includes(ext)) return 'font';
    return 'other';
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

  scanHtmlString(htmlContent) {
    console.log('[VIEWER] Scanning HTML string for resources...');
    
    // Use regex to find script sources
    const scriptRegex = /<script[^>]+src=["']([^"']+)["']/gi;
    let match;
    while ((match = scriptRegex.exec(htmlContent)) !== null) {
      const src = match[1];
      console.log('[VIEWER] Found script in HTML:', src);
      
      const fullUrl = this.resolveUrl(src);
      
      // Skip chrome-extension URLs (our proxy system)
      if (fullUrl.startsWith('chrome-extension:')) {
        console.log('[VIEWER] Skipping chrome-extension URL:', fullUrl);
        continue;
      }
      
      if (!this.resources.find(r => r.url === fullUrl)) {
        const isExternal = this.isExternalResource(fullUrl);
        console.log(`[VIEWER] Script ${fullUrl} is ${isExternal ? 'external' : 'Arweave'}`);
        this.addResource(fullUrl, 'script', isExternal ? 'skipped' : 'pending',
          isExternal ? 'External CDN resource' : null);
      }
    }

    // Use regex to find stylesheet links
    const linkRegex = /<link[^>]+rel=["']stylesheet["'][^>]+href=["']([^"']+)["']/gi;
    while ((match = linkRegex.exec(htmlContent)) !== null) {
      const href = match[1];
      console.log('[VIEWER] Found stylesheet in HTML:', href);
      
      const fullUrl = this.resolveUrl(href);
      
      // Skip chrome-extension URLs (our proxy system)
      if (fullUrl.startsWith('chrome-extension:')) {
        console.log('[VIEWER] Skipping chrome-extension URL:', fullUrl);
        continue;
      }
      
      if (!this.resources.find(r => r.url === fullUrl)) {
        const isExternal = this.isExternalResource(fullUrl);
        console.log(`[VIEWER] Stylesheet ${fullUrl} is ${isExternal ? 'external' : 'Arweave'}`);
        this.addResource(fullUrl, 'stylesheet', isExternal ? 'skipped' : 'pending',
          isExternal ? 'External CDN resource' : null);
      }
    }

    // Use regex to find images
    const imgRegex = /<img[^>]+src=["']([^"']+)["']/gi;
    while ((match = imgRegex.exec(htmlContent)) !== null) {
      const src = match[1];
      console.log('[VIEWER] Found image in HTML:', src);
      
      const fullUrl = this.resolveUrl(src);
      
      // Skip chrome-extension URLs (our proxy system)
      if (fullUrl.startsWith('chrome-extension:')) {
        console.log('[VIEWER] Skipping chrome-extension URL:', fullUrl);
        continue;
      }
      
      if (!this.resources.find(r => r.url === fullUrl)) {
        const isExternal = this.isExternalResource(fullUrl);
        console.log(`[VIEWER] Image ${fullUrl} is ${isExternal ? 'external' : 'Arweave'}`);
        this.addResource(fullUrl, 'image', isExternal ? 'skipped' : 'pending',
          isExternal ? 'External resource' : null);
      }
    }
  }

  resolveUrl(url) {
    // If it's already a full URL, return as-is
    if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('chrome-extension://') || url.startsWith('ar://')) {
      return url;
    }
    
    // For relative URLs, resolve against the current AR URL
    if (this.arUrl) {
      const baseId = this.arUrl.replace('ar://', '').split('/')[0];
      if (url.startsWith('/')) {
        // Root-relative URL
        return `ar://${baseId}${url}`;
      } else {
        // Document-relative URL
        const currentPath = this.arUrl.replace('ar://', '').split('/');
        currentPath.pop(); // Remove filename
        const basePath = currentPath.join('/');
        if (basePath) {
          return `ar://${baseId}/${basePath}/${url}`;
        } else {
          return `ar://${baseId}/${url}`;
        }
      }
    }
    
    return url;
  }

  isExternalResource(url) {
    if (url.startsWith('data:') || url.startsWith('blob:')) return false;
    if (url.startsWith('chrome-extension:')) return false;
    if (url.startsWith('ar://')) return false; // Arweave URLs are not external
    
    // Check if it's an Arweave gateway URL
    const gatewayPatterns = [
      /^https?:\/\/[^\/]*arweave\.[^\/]+\//,
      /^https?:\/\/[^\/]*ar\.io[^\/]*\//,
      /^https?:\/\/[^\/]*ar-io[^\/]*\//,
      /^https?:\/\/[^\/]*g8way[^\/]*\//,
    ];
    
    const isGatewayUrl = gatewayPatterns.some(pattern => pattern.test(url));
    
    return !isGatewayUrl;
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
    // Use the gateway URL from params if available, otherwise fallback to arweave.net
    const gatewayUrl = gatewayParam || arUrl.replace('ar://', 'https://arweave.net/');
    
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
};

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
