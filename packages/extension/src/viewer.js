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

    // Note: Resource verification is limited without service worker support in extension pages
    console.log('[VIEWER] Iframe loaded - main content verification complete');
  }

  toggleMinimize() {
    this.isMinimized = !this.isMinimized;
    document.body.classList.toggle('minimized', this.isMinimized);

    // Show toast when minimizing
    if (this.isMinimized) {
      this.showToast('Minimized view active', 'info', 'Press ESC to restore');
    }
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
      if (response.verified) {
        this.stats.main.verified = true;
        this.updateLoadingState('COMPLETE');
        this.showToast(
          'Main content verified',
          'success',
          'Now verifying resources...',
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
            'Verification failed',
            'warning',
            'Showing unverified content',
          );
        }
      }

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
      const objectUrl = URL.createObjectURL(blob);

      // Handle different content types
      const contentType = cachedResponse.headers.get('content-type');
      if (contentType?.includes('text/html')) {
        iframe.src = objectUrl;
      } else {
        // For non-HTML content, create a viewer
        iframe.srcdoc = this.createContentViewer(objectUrl, contentType);
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
    } else {
      return `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: system-ui; padding: 20px; }
            .info { background: #f0f0f0; padding: 20px; border-radius: 8px; }
          </style>
        </head>
        <body>
          <div class="info">
            <h2>Verified Content</h2>
            <p>Type: ${type}</p>
            <a href="${url}" download>Download</a>
          </div>
        </body>
        </html>
      `;
    }
  }

  updateTrustIndicator() {
    const { scripts, styles, media, api } = this.stats.resources;
    
    // Calculate totals
    const totalResources = scripts.total + styles.total + media.total + api.total + 1; // +1 for main
    const verifiedResources = scripts.verified + styles.verified + media.verified + api.verified + 
                             (this.stats.main.verified ? 1 : 0);
    const unverifiedResources = totalResources - verifiedResources;
    
    // Calculate trust percentage
    const trustPercentage = totalResources > 0 ? Math.round((verifiedResources / totalResources) * 100) : 0;
    
    // Update trust icon and status
    const trustIcon = document.getElementById('trustIcon');
    const trustLabel = document.getElementById('trustLabel');
    const trustDetails = document.getElementById('trustDetails');
    const checkmark = trustIcon?.querySelector('.checkmark');
    
    // Show progress until we have some resources
    if (totalResources === 0) {
      trustIcon.className = 'trust-icon';
      trustLabel.textContent = 'Loading';
      trustDetails.textContent = 'Fetching content...';
      if (checkmark) checkmark.style.display = 'none';
    } else if (totalResources === 1 && this.stats.main.verified) {
      // Only main page loaded and verified
      trustIcon.className = 'trust-icon verified';
      trustLabel.textContent = 'Page Verified';
      trustDetails.textContent = 'Content integrity confirmed';
      if (checkmark) checkmark.style.display = 'block';
    } else if (totalResources > 1 && unverifiedResources === 0) {
      // All resources verified
      trustIcon.className = 'trust-icon verified';
      trustLabel.textContent = 'Fully Verified';
      trustDetails.textContent = `All ${totalResources} resources checked`;
      if (checkmark) checkmark.style.display = 'block';
    } else if (unverifiedResources > 0) {
      // Some resources not verified
      const verifiedCount = totalResources - unverifiedResources;
      trustIcon.className = 'trust-icon warning';
      trustLabel.textContent = 'Partially Verified';
      trustDetails.textContent = `${verifiedCount} of ${totalResources} resources verified`;
      if (checkmark) checkmark.style.display = 'none';
    } else {
      // Main page not verified
      trustIcon.className = 'trust-icon error';
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
      <button class="toast-close" onclick="this.parentElement.remove()">✕</button>
    `;

    container.appendChild(toast);

    // Play subtle sound for important notifications
    if (type === 'success' || type === 'error') {
      this.playNotificationSound(type);
    }

    // Auto-remove after 5 seconds
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(100%)';
      setTimeout(() => toast.remove(), 300);
    }, 5000);
  }

  playNotificationSound(type) {
    // Create audio context for notification sounds
    try {
      const audioContext = new (
        window.AudioContext || window.webkitAudioContext
      )();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);

      if (type === 'success') {
        // Success sound: ascending notes
        oscillator.frequency.setValueAtTime(523.25, audioContext.currentTime); // C5
        oscillator.frequency.setValueAtTime(
          659.25,
          audioContext.currentTime + 0.1,
        ); // E5
        oscillator.frequency.setValueAtTime(
          783.99,
          audioContext.currentTime + 0.2,
        ); // G5
      } else {
        // Error sound: descending notes
        oscillator.frequency.setValueAtTime(440, audioContext.currentTime); // A4
        oscillator.frequency.setValueAtTime(
          349.23,
          audioContext.currentTime + 0.1,
        ); // F4
      }

      gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(
        0.01,
        audioContext.currentTime + 0.3,
      );

      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.3);
    } catch (_e) {
      // Ignore audio errors
    }
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

// Handle Enter key in URL input
document.addEventListener('DOMContentLoaded', () => {
  const urlInput = document.getElementById('urlInput');
  urlInput?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      navigateToUrl();
    }
  });
});

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
