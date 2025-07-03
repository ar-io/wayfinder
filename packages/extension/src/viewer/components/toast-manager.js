/**
 * Toast Notification Manager
 * 
 * Provides a centralized system for showing toast notifications with:
 * - Multiple types (success, warning, error, info)
 * - Auto-dismiss functionality
 * - Manual dismiss controls
 * - Accessibility features
 * - Position and animation management
 */

/**
 * Toast types with their corresponding icons and colors
 */
export const TOAST_TYPES = {
  SUCCESS: 'success',
  WARNING: 'warning', 
  ERROR: 'error',
  INFO: 'info'
};

/**
 * Default configuration for toast behavior
 */
const DEFAULT_CONFIG = {
  autoRemoveDelay: 5000,     // Auto-remove after 5 seconds
  animationDuration: 300,    // Animation duration in ms
  maxToasts: 5,              // Maximum number of toasts to show
  position: 'bottom-right'   // Toast container position
};

/**
 * Toast Manager Class
 * Handles creation, display, and removal of toast notifications
 */
export class ToastManager {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.container = null;
    this.activeToasts = new Set();
    this.toastId = 0;
    
    this.icons = {
      [TOAST_TYPES.SUCCESS]: '✓',
      [TOAST_TYPES.WARNING]: '⚠',
      [TOAST_TYPES.ERROR]: '✗',
      [TOAST_TYPES.INFO]: 'ℹ'
    };
  }

  /**
   * Initialize the toast system
   * Creates the container element if it doesn't exist
   */
  initialize() {
    this.container = document.getElementById('toastContainer');
    
    if (!this.container) {
      console.warn('[TOAST] Toast container not found in DOM');
      return false;
    }
    
    return true;
  }

  /**
   * Show a toast notification
   * @param {string} title - Toast title
   * @param {string} type - Toast type (success, warning, error, info)
   * @param {string} message - Optional additional message
   * @param {Object} options - Additional options
   * @returns {string} Toast ID for manual removal
   */
  show(title, type = TOAST_TYPES.INFO, message = '', options = {}) {
    if (!this.initialize()) {
      console.warn('[TOAST] Cannot show toast - container not available');
      return null;
    }

    // Remove oldest toast if we've reached the limit
    if (this.activeToasts.size >= this.config.maxToasts) {
      this.removeOldestToast();
    }

    const toastId = `toast-${++this.toastId}`;
    const config = { ...this.config, ...options };
    
    // Create toast element
    const toast = this.createToastElement(toastId, title, type, message, config);
    
    // Add to container
    this.container.appendChild(toast);
    this.activeToasts.add(toastId);

    // Set up auto-removal
    if (config.autoRemoveDelay > 0) {
      setTimeout(() => {
        this.remove(toastId);
      }, config.autoRemoveDelay);
    }

    // Add entrance animation
    requestAnimationFrame(() => {
      toast.classList.add('toast-show');
    });

    return toastId;
  }

  /**
   * Create the DOM element for a toast
   * @param {string} id - Unique toast ID
   * @param {string} title - Toast title
   * @param {string} type - Toast type
   * @param {string} message - Toast message
   * @param {Object} config - Toast configuration
   * @returns {HTMLElement} Toast element
   */
  createToastElement(id, title, type, message, config) {
    const toast = document.createElement('div');
    toast.id = id;
    toast.className = `toast ${type}`;
    toast.setAttribute('role', 'alert');
    toast.setAttribute('aria-live', 'assertive');

    const icon = this.icons[type] || this.icons[TOAST_TYPES.INFO];

    toast.innerHTML = `
      <div class="toast-icon" aria-hidden="true">${icon}</div>
      <div class="toast-content">
        <div class="toast-title">${this.escapeHtml(title)}</div>
        ${message ? `<div class="toast-message">${this.escapeHtml(message)}</div>` : ''}
      </div>
      <button class="toast-close" aria-label="Close notification" title="Close">✕</button>
    `;

    // Add close button handler
    const closeBtn = toast.querySelector('.toast-close');
    closeBtn.addEventListener('click', () => {
      this.remove(id);
    });

    // Add keyboard support
    toast.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.remove(id);
      }
    });

    return toast;
  }

  /**
   * Remove a specific toast by ID
   * @param {string} toastId - ID of toast to remove
   */
  remove(toastId) {
    const toast = document.getElementById(toastId);
    if (!toast || !this.activeToasts.has(toastId)) {
      return;
    }

    // Add exit animation
    toast.classList.add('toast-hide');
    
    // Remove from DOM after animation
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
      this.activeToasts.delete(toastId);
    }, this.config.animationDuration);
  }

  /**
   * Remove the oldest toast to make room for new ones
   */
  removeOldestToast() {
    const firstToastId = this.activeToasts.values().next().value;
    if (firstToastId) {
      this.remove(firstToastId);
    }
  }

  /**
   * Remove all active toasts
   */
  removeAll() {
    const toastIds = Array.from(this.activeToasts);
    toastIds.forEach(id => this.remove(id));
  }

  /**
   * Show a success toast
   * @param {string} title - Toast title
   * @param {string} message - Optional message
   * @param {Object} options - Additional options
   * @returns {string} Toast ID
   */
  success(title, message = '', options = {}) {
    return this.show(title, TOAST_TYPES.SUCCESS, message, options);
  }

  /**
   * Show a warning toast
   * @param {string} title - Toast title
   * @param {string} message - Optional message
   * @param {Object} options - Additional options
   * @returns {string} Toast ID
   */
  warning(title, message = '', options = {}) {
    return this.show(title, TOAST_TYPES.WARNING, message, options);
  }

  /**
   * Show an error toast
   * @param {string} title - Toast title
   * @param {string} message - Optional message
   * @param {Object} options - Additional options
   * @returns {string} Toast ID
   */
  error(title, message = '', options = {}) {
    return this.show(title, TOAST_TYPES.ERROR, message, {
      autoRemoveDelay: 8000, // Errors stay longer by default
      ...options
    });
  }

  /**
   * Show an info toast
   * @param {string} title - Toast title
   * @param {string} message - Optional message
   * @param {Object} options - Additional options
   * @returns {string} Toast ID
   */
  info(title, message = '', options = {}) {
    return this.show(title, TOAST_TYPES.INFO, message, options);
  }

  /**
   * Escape HTML to prevent XSS
   * @param {string} unsafe - Unsafe string
   * @returns {string} Safe HTML string
   */
  escapeHtml(unsafe) {
    return unsafe
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  /**
   * Get count of active toasts
   * @returns {number} Number of active toasts
   */
  getActiveCount() {
    return this.activeToasts.size;
  }

  /**
   * Check if a specific toast is active
   * @param {string} toastId - Toast ID to check
   * @returns {boolean} True if toast is active
   */
  isActive(toastId) {
    return this.activeToasts.has(toastId);
  }
}

// Create a global instance for easy use
export const toastManager = new ToastManager();

// Convenience functions that use the global instance
export const showToast = (title, type, message, options) => 
  toastManager.show(title, type, message, options);

export const showSuccess = (title, message, options) => 
  toastManager.success(title, message, options);

export const showWarning = (title, message, options) => 
  toastManager.warning(title, message, options);

export const showError = (title, message, options) => 
  toastManager.error(title, message, options);

export const showInfo = (title, message, options) => 
  toastManager.info(title, message, options);

export const removeToast = (toastId) => 
  toastManager.remove(toastId);

export const removeAllToasts = () => 
  toastManager.removeAll();