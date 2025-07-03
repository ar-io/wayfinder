/**
 * Progress Manager
 * 
 * Handles all progress tracking, loading states, and trust indicators.
 * Consolidates the multiple progress update methods into a single manager.
 */

/**
 * Loading states for different verification phases
 */
export const LOADING_STATES = {
  INITIALIZING: 'Initializing secure environment...',
  FETCHING: 'Fetching content from gateway...',
  VERIFYING: 'Verifying content integrity...',
  LOADING: 'Loading verified content...',
  COMPLETE: 'All content verified',
  ERROR: 'Verification failed'
};

/**
 * ProgressManager class handles all progress and loading state updates
 */
export class ProgressManager {
  constructor() {
    this.currentState = 'INITIALIZING';
    this.progressShown = false;
    this.stats = {
      main: { status: 'pending', verified: false },
      resources: {
        scripts: { total: 0, verified: 0 },
        styles: { total: 0, verified: 0 },
        media: { total: 0, verified: 0 },
        api: { total: 0, verified: 0 }
      }
    };
  }

  /**
   * Update overall loading state and UI
   * @param {string} state - Loading state key
   * @param {string} details - Additional details (optional)
   */
  updateLoadingState(state, details = '') {
    this.currentState = state;
    
    // Update loading text
    const loadingText = document.getElementById('loadingText');
    if (loadingText) {
      loadingText.textContent = LOADING_STATES[state] || 'Loading...';
    }

    // Update status text and brand status in header
    const statusText = document.getElementById('statusText');
    const brandStatus = document.getElementById('brandStatus');
    const statusDot = document.querySelector('.status-dot');
    
    if (statusText && brandStatus) {
      // Reset all status classes
      brandStatus.classList.remove('verified', 'warning', 'error');
      
      if (state === 'INITIALIZING') {
        statusText.textContent = 'Initializing';
      } else if (state === 'FETCHING') {
        statusText.textContent = 'Fetching';
      } else if (state === 'VERIFYING') {
        statusText.textContent = 'Verifying';
      } else if (state === 'COMPLETE') {
        // Determine verification status and update accordingly
        if (this.stats.main.verified) {
          statusText.textContent = '✓ Verified';
          brandStatus.classList.add('verified');
          // Remove pulsing animation for verified state
          if (statusDot) {
            statusDot.style.animation = 'none';
          }
        } else {
          statusText.textContent = '⚠ Unverified';
          brandStatus.classList.add('warning');
          if (statusDot) {
            statusDot.style.animation = 'none';
          }
        }
      } else if (state === 'ERROR') {
        statusText.textContent = '✗ Failed';
        brandStatus.classList.add('error');
        if (statusDot) {
          statusDot.style.animation = 'none';
        }
      }
    }

    // Update trust indicator based on state
    if (state === 'COMPLETE' || state === 'ERROR') {
      this.updateTrustIndicator();
    }
  }

  /**
   * Update loading progress with percentage and data transfer info
   * @param {number} percentage - Progress percentage (0-100)
   * @param {number} processedMB - Processed data in MB
   * @param {number} totalMB - Total data in MB
   */
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

  /**
   * Update manifest verification progress
   * @param {Object} progress - Progress object with total, completed, verified, failed
   */
  updateManifestProgress(progress) {
    const percentageEl = document.getElementById('prefetchPercentage');
    if (percentageEl) {
      const percentage = Math.round((progress.completed / progress.total) * 100);
      percentageEl.textContent = `${percentage}%`;
    }
    
    const progressBar = document.getElementById('prefetchProgress');
    if (progressBar) {
      const percentage = Math.round((progress.completed / progress.total) * 100);
      progressBar.style.width = `${percentage}%`;
    }
    
    const verifiedEl = document.getElementById('prefetchVerified');
    if (verifiedEl) {
      verifiedEl.textContent = progress.verified;
    }
    
    const skippedEl = document.getElementById('prefetchSkipped');
    if (skippedEl) {
      skippedEl.textContent = '0'; // Manifests don't skip resources
    }
    
    const failedEl = document.getElementById('prefetchFailed');
    if (failedEl) {
      failedEl.textContent = progress.failed;
    }
    
    const currentEl = document.getElementById('prefetchCurrent');
    if (currentEl) {
      currentEl.textContent = `Verifying resource ${progress.completed + 1} of ${progress.total}`;
    }
  }

  /**
   * Update pre-fetch verification progress
   * @param {Object} progress - Progress object with percentage, verified, skipped, failed
   */
  updatePreFetchProgress(progress) {
    // Update percentage
    const percentageEl = document.getElementById('prefetchPercentage');
    if (percentageEl) {
      percentageEl.textContent = `${progress.percentage}%`;
    }
    
    // Update progress bar
    const progressBar = document.getElementById('prefetchProgress');
    if (progressBar) {
      progressBar.style.width = `${progress.percentage}%`;
    }
    
    // Update stats
    const verifiedEl = document.getElementById('prefetchVerified');
    const skippedEl = document.getElementById('prefetchSkipped');
    const failedEl = document.getElementById('prefetchFailed');
    
    if (verifiedEl) verifiedEl.textContent = progress.verified;
    if (skippedEl) skippedEl.textContent = progress.skipped;
    if (failedEl) failedEl.textContent = progress.failed;
    
    // Update current resource
    const currentEl = document.getElementById('prefetchCurrent');
    if (currentEl && progress.currentResource) {
      currentEl.textContent = `Verifying: ${progress.currentResource}`;
    }
  }

  /**
   * Update trust indicator based on verification stats
   */
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

    // Show completion message
    if (totalResources > 1 && unverifiedResources === 0) {
      this.updateLoadingState('COMPLETE');
    }
  }

  /**
   * Update resource statistics
   * @param {string} resourceType - Type of resource (scripts, styles, media, api)
   * @param {boolean} verified - Whether the resource was verified
   */
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
  }

  /**
   * Set main content verification status
   * @param {boolean} verified - Whether main content is verified
   * @param {string} status - Status (complete, error, pending)
   */
  setMainContentStatus(verified, status = 'complete') {
    this.stats.main.verified = verified;
    this.stats.main.status = status;
    this.updateTrustIndicator();
  }

  /**
   * Reset all progress and statistics
   */
  reset() {
    this.currentState = 'INITIALIZING';
    this.progressShown = false;
    
    // Reset stats
    this.stats.main = { status: 'pending', verified: false };
    Object.keys(this.stats.resources).forEach((type) => {
      this.stats.resources[type] = { total: 0, verified: 0 };
    });

    // Reset UI elements
    const progressEl = document.getElementById('loadingProgress');
    if (progressEl) {
      progressEl.style.display = 'none';
    }

    const percentEl = document.getElementById('loadingPercent');
    const mbEl = document.getElementById('loadingMB');
    if (percentEl) percentEl.textContent = '0%';
    if (mbEl) mbEl.textContent = '';

    this.updateTrustIndicator();
  }

  /**
   * Get current verification statistics
   * @returns {Object} Current stats object
   */
  getStats() {
    return { ...this.stats };
  }

  /**
   * Check if main content is verified
   * @returns {boolean} True if main content is verified
   */
  isMainContentVerified() {
    return this.stats.main.verified;
  }

  /**
   * Get current loading state
   * @returns {string} Current loading state
   */
  getCurrentState() {
    return this.currentState;
  }

  /**
   * Check if progress is currently shown
   * @returns {boolean} Whether progress is visible
   */
  isProgressShown() {
    return this.progressShown;
  }
}