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

    if (!this.arUrl) {
      this.showError('No URL provided');
      return;
    }

    // Display the AR URL in navigation input (without ar:// prefix)
    const urlInput = document.getElementById('urlInput');
    if (urlInput && this.arUrl) {
      // Remove ar:// prefix for display
      urlInput.value = this.arUrl.replace(/^ar:\/\//, '');
      // Focus the input for easy editing
      urlInput.focus();
      urlInput.select();
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
    console.log('[VIEWER] Resource verification will be handled by background script');
    
    // Set up message listener for resource verification updates from background
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'RESOURCE_VERIFICATION_UPDATE') {
        this.updateResourceStats(message.resourceType, message.verified);
      } else if (message.type === 'MAIN_CONTENT_VERIFICATION_UPDATE') {
        // Update main content verification status when it completes asynchronously
        console.log('[VIEWER] Main content verification update:', message.verified);
        this.stats.main.verified = message.verified;
        this.updateTrustIndicator();
        
        if (message.verified) {
          this.showToast(
            'Verification complete',
            'success',
            'Main content verified',
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

    // Show toast for failed verifications in strict mode
    chrome.storage.local.get(
      ['verificationStrict'],
      ({ verificationStrict }) => {
        if (!verified && verificationStrict) {
          this.showToast(
            'Resource blocked',
            'error',
            `Unverified ${resourceType}`,
          );
        }
      },
    );
  }

  setupEventHandlers() {
    // Minimize toggle
    const minimizeBtn = document.getElementById('minimizeToggle');
    minimizeBtn.addEventListener('click', () => this.toggleMinimize());

    // Floating badge click (restore from minimized)
    const floatingBadge = document.getElementById('floatingBadge');
    floatingBadge.addEventListener('click', () => this.toggleMinimize());

    // URL navigation button
    const urlGoBtn = document.getElementById('urlGoBtn');
    urlGoBtn?.addEventListener('click', () => navigateToUrl());

    // URL input enter key
    const urlInput = document.getElementById('urlInput');
    urlInput?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        navigateToUrl();
      }
    });

    // Reverify button
    const reverifyBtn = document.getElementById('reverifyBtn');
    reverifyBtn?.addEventListener('click', () => reverifyContent());

    // Error page buttons
    const goBackBtn = document.getElementById('goBackBtn');
    goBackBtn?.addEventListener('click', () => window.history.back());

    const proceedBtn = document.getElementById('proceedBtn');
    proceedBtn?.addEventListener('click', () => proceedAnyway());

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
    iframe.addEventListener('load', () => {
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
        console.log('[VIEWER] Iframe loaded, checking for navigation interception capability');
        
        // Check if we can access the iframe content
        try {
          const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
          if (iframeDoc) {
            // We have access - set up click handler directly
            iframeDoc.addEventListener('click', (e) => {
              let target = e.target;
              while (target && target.tagName !== 'A') {
                target = target.parentElement;
              }
              
              if (target && target.href) {
                const url = target.href;
                
                // Check if it's an Arweave URL
                if (url.includes('arweave.net/') || url.includes('ar.io/') || url.startsWith('ar://')) {
                  e.preventDefault();
                  
                  // Convert to ar:// URL
                  let arUrl = url;
                  if (url.includes('arweave.net/')) {
                    // Extract TX ID from arweave.net URLs
                    const txMatch = url.match(/arweave\.net\/([a-zA-Z0-9_-]{43})/);
                    if (txMatch) {
                      arUrl = 'ar://' + txMatch[1];
                    }
                  } else if (url.includes('.ar.io/') || url.includes('ar-io.')) {
                    // Handle ar.io gateway URLs
                    const match = url.match(/https?:\/\/[^\/]+\/(.*)/);
                    if (match) {
                      arUrl = 'ar://' + match[1];
                    }
                  }
                  
                  console.log('[VIEWER] Intercepted Arweave link click:', {
                    originalUrl: url,
                    convertedUrl: arUrl
                  });
                  
                  // Navigate to the new URL in the viewer
                  window.location.href = `viewer.html?url=${encodeURIComponent(arUrl)}`;
                }
              }
            }, true);
            
            console.log('[VIEWER] Navigation interceptor installed via direct access');
          }
        } catch (accessError) {
          // Can't access iframe content directly - this is expected for cross-origin content
          console.log('[VIEWER] Cannot access iframe content directly (cross-origin):', accessError.message);
        }
      }
    } catch (error) {
      console.log('[VIEWER] Error setting up navigation interception:', error.message);
    }

    // Note: Resource verification is limited without service worker support in extension pages
    console.log('[VIEWER] Iframe loaded - main content verification complete');
  }

  toggleMinimize() {
    this.isMinimized = !this.isMinimized;
    document.body.classList.toggle('minimized', this.isMinimized);
  }

  updateLoadingState(state, _details = '') {
    // Update trust indicator based on state
    if (state === 'COMPLETE' || state === 'ERROR') {
      this.updateTrustIndicator();
    }
  }

  async loadVerifiedContent() {
    try {
      this.updateLoadingState('FETCHING');
      
      console.log('[VIEWER] Fetching verified content for:', this.arUrl);

      // Request verified content from background
      const response = await chrome.runtime.sendMessage({
        type: 'FETCH_VERIFIED_CONTENT',
        url: this.arUrl,
      });
      
      console.log('[VIEWER] Received response:', response);

      if (!response) {
        throw new Error('No response from background script');
      }

      if (response.error) {
        throw new Error(response.error);
      }

      this.updateLoadingState('VERIFYING');

      // Update stats based on verification
      this.stats.main.verified = response.verified || false;
      this.stats.main.status = 'complete';
      
      console.log('[VIEWER] Main content verification status:', response.verified);
      console.log('[VIEWER] Verification info:', response.verificationInfo);
      
      if (response.verified) {
        this.updateLoadingState('COMPLETE');
        this.showToast(
          'Main content verified',
          'success',
        );
      } else {
        // Check if we should show content anyway
        const { verificationStrict } = await chrome.storage.local.get([
          'verificationStrict',
        ]);

        if (verificationStrict) {
          throw new Error('Content verification failed - strict mode enabled');
        } else {
          this.updateLoadingState('COMPLETE');
          this.showToast(
            'Verification pending',
            'warning',
            'Showing content while verification completes',
          );
        }
      }
      
      // Update trust indicator to show main content status
      this.updateTrustIndicator();

      // Load content into iframe
      await this.displayContent(response);

      // Hide loading overlay
      document.getElementById('loadingOverlay').style.display = 'none';
    } catch (error) {
      console.error('Verification error:', error);
      this.showError(error.message);
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
      const contentType = cachedResponse.headers.get('content-type');
      
      // Create blob URL for all content types
      const objectUrl = URL.createObjectURL(blob);
      
      // For HTML content, we need to ensure scripts can load
      if (contentType?.includes('text/html')) {
        // CRITICAL: Set sandbox to allow scripts but maintain security
        iframe.removeAttribute('sandbox');
        iframe.sandbox = 'allow-scripts allow-same-origin allow-forms allow-popups allow-downloads allow-modals';
        iframe.src = objectUrl;
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
      // Handle Arweave manifests by redirecting to index
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
          </style>
          <script>
            // Parse manifest and redirect to index
            fetch('${url}')
              .then(res => res.json())
              .then(manifest => {
                if (manifest.index && manifest.index.path) {
                  // Redirect to the index path
                  const currentUrl = new URL(window.location.href);
                  const arUrl = currentUrl.searchParams.get('url');
                  const baseUrl = arUrl.replace(/\\/[^\\/]*$/, ''); // Remove any path
                  const indexUrl = baseUrl + '/' + manifest.index.path;
                  window.location.href = 'viewer.html?url=' + encodeURIComponent(indexUrl);
                } else {
                  document.querySelector('.loading').textContent = 'No index file found in manifest';
                }
              })
              .catch(err => {
                document.querySelector('.loading').textContent = 'Error loading manifest: ' + err.message;
              });
          </script>
        </head>
        <body>
          <div class="manifest-container">
            <div class="manifest-icon">📂</div>
            <h2>Arweave Manifest</h2>
            <p class="loading">Loading manifest index...</p>
          </div>
        </body>
        </html>
      `;
    } else if (
      type.startsWith('text/plain') || 
      type.startsWith('text/csv') ||
      type.startsWith('application/json') ||
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
    const mainIncluded = this.stats.main.status === 'complete' || this.stats.main.status === 'error';
    const totalResources = scripts.total + styles.total + media.total + api.total + (mainIncluded ? 1 : 0);
    const verifiedResources = scripts.verified + styles.verified + media.verified + api.verified + 
                             (mainIncluded && this.stats.main.verified ? 1 : 0);
    const unverifiedResources = totalResources - verifiedResources;
    
    // Calculate trust percentage
    const trustPercentage = totalResources > 0 ? Math.round((verifiedResources / totalResources) * 100) : 0;
    
    // Update trust icon and status
    const trustIcon = document.getElementById('trustIcon');
    const trustLabel = document.getElementById('trustLabel');
    const trustDetails = document.getElementById('trustDetails');
    const trustIndicator = document.getElementById('trustIndicator');
    const checkmark = trustIcon?.querySelector('.checkmark');
    
    // Show progress until we have some resources
    if (totalResources === 0) {
      trustIcon.className = 'trust-icon';
      trustIndicator.className = 'trust-indicator';
      trustLabel.textContent = 'Loading';
      trustDetails.textContent = 'Fetching content...';
      if (checkmark) checkmark.style.display = 'none';
    } else if (totalResources === 1 && this.stats.main.verified) {
      // Only main page loaded and verified
      trustIcon.className = 'trust-icon verified';
      trustIndicator.className = 'trust-indicator complete';
      trustLabel.textContent = 'Page Verified';
      trustDetails.textContent = 'Content integrity confirmed';
      if (checkmark) checkmark.style.display = 'block';
    } else if (totalResources > 1 && unverifiedResources === 0) {
      // All resources verified
      trustIcon.className = 'trust-icon verified';
      trustIndicator.className = 'trust-indicator complete';
      trustLabel.textContent = 'Fully Verified';
      trustDetails.textContent = `All ${totalResources} resources checked`;
      if (checkmark) checkmark.style.display = 'block';
    } else if (unverifiedResources > 0) {
      // Some resources not verified
      const verifiedCount = totalResources - unverifiedResources;
      trustIcon.className = 'trust-icon warning';
      trustIndicator.className = 'trust-indicator warning';
      trustLabel.textContent = 'Partially Verified';
      trustDetails.textContent = `${verifiedCount} of ${totalResources} resources verified`;
      if (checkmark) checkmark.style.display = 'none';
    } else {
      // Main page not verified
      trustIcon.className = 'trust-icon error';
      trustIndicator.className = 'trust-indicator error';
      trustLabel.textContent = 'Not Verified';
      trustDetails.textContent = 'Content could not be verified';
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
    document.getElementById('errorMessage').textContent = message;

    // Show error overlay
    document.getElementById('loadingOverlay').style.display = 'none';
    document.getElementById('errorOverlay').style.display = 'flex';

    // Show error toast
    this.showToast('Verification Error', 'error', message);
  }

  displayUrl() {
    // Removed - URL now displayed in navigation input
  }
}

// Global function for navigation
window.navigateToUrl = function() {
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
window.reverifyContent = async function() {
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
  iframe.src = 'about:blank';

  // Show loading overlay
  document.getElementById('loadingOverlay').style.display = 'flex';
  document.getElementById('errorOverlay').style.display = 'none';

  // Update loading state
  browser.updateLoadingState('INITIALIZING');

  // Clear any existing toasts
  document.getElementById('toastContainer').innerHTML = '';

  // Show reverification toast
  browser.showToast('Reverifying content', 'info', 'Running integrity checks...');

  try {
    // Re-run verification process
    await browser.loadVerifiedContent();
    
    // Remove loading state from button
    reverifyBtn?.classList.remove('loading');
  } catch (error) {
    console.error('Reverification error:', error);
    reverifyBtn?.classList.remove('loading');
    browser.showError(error.message);
  }
};

// Remove duplicate event listener - now handled in setupEventHandlers

// Global function for "Proceed Anyway" button
window.proceedAnyway = async function () {
  // Hide error overlay
  document.getElementById('errorOverlay').style.display = 'none';

  // Get the URL and load without verification
  const params = new URLSearchParams(window.location.search);
  const arUrl = params.get('url');

  if (arUrl) {
    // Convert to regular gateway URL
    const gatewayUrl = arUrl.replace('ar://', 'https://arweave.net/');
    document.getElementById('verified-content').src = gatewayUrl;

    // Update UI to show unverified state
    const browser = window.verifiedBrowser;
    browser.showToast(
      'Loading unverified content',
      'warning',
      'Proceed with caution',
    );
    browser.updateLoadingState('COMPLETE');
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
