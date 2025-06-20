/**
 * WayFinder Warning Page
 * Handles verification warnings and user bypass decisions
 */

// Parse URL parameters
const params = new URLSearchParams(window.location.search);
const arUrl = params.get('url') || 'ar://unknown';
const strategy = params.get('strategy') || 'unknown';
const error = params.get('error') || 'Verification failed';
const gateway = params.get('gateway') || 'Unknown gateway';
const txId = params.get('txId') || extractTxId(arUrl);

// Storage keys
const BYPASS_STORAGE_KEY = 'verificationBypasses';
const BYPASS_SESSION_KEY = 'verificationBypassSession';

// Initialize page
document.addEventListener('DOMContentLoaded', () => {
  // Set URL display
  document.getElementById('requestedUrl').textContent = arUrl;
  
  // Set technical details
  document.getElementById('verificationStrategy').textContent = strategy;
  document.getElementById('verificationError').textContent = error;
  document.getElementById('gatewayInfo').textContent = gateway;
  document.getElementById('txId').textContent = txId || 'N/A';
  
  // Initialize buttons
  const goBackButton = document.getElementById('goBackButton');
  const proceedButton = document.getElementById('proceedButton');
  const rememberCheckbox = document.getElementById('rememberChoice');
  const proceedTimer = document.getElementById('proceedTimer');
  
  // Go back button
  goBackButton.addEventListener('click', () => {
    history.back();
  });
  
  // Countdown timer for proceed button
  let countdown = 3;
  const timerInterval = setInterval(() => {
    countdown--;
    if (countdown > 0) {
      proceedTimer.textContent = `(${countdown})`;
    } else {
      proceedButton.disabled = false;
      proceedTimer.style.display = 'none';
      clearInterval(timerInterval);
    }
  }, 1000);
  
  // Proceed button
  proceedButton.addEventListener('click', async () => {
    // Save bypass decision
    await saveBypassDecision(arUrl, rememberCheckbox.checked);
    
    // Redirect to original URL
    // We need to tell the background script to allow this specific navigation
    chrome.runtime.sendMessage({
      type: 'proceedWithBypass',
      url: arUrl,
      permanent: rememberCheckbox.checked
    }, (response) => {
      if (response && response.success) {
        // Navigate to the URL
        window.location.href = response.redirectUrl;
      } else {
        showError('Failed to proceed. Please try again.');
      }
    });
  });
  
  // Report issue link
  document.getElementById('reportIssue').addEventListener('click', (e) => {
    e.preventDefault();
    const issueUrl = `https://github.com/ar-io/wayfinder/issues/new?title=False%20Positive%20Verification%20Warning&body=URL:%20${encodeURIComponent(arUrl)}%0AError:%20${encodeURIComponent(error)}%0AStrategy:%20${encodeURIComponent(strategy)}`;
    window.open(issueUrl, '_blank');
  });
  
  // Theme detection
  applyTheme();
});

/**
 * Extract transaction ID from ar:// URL
 */
function extractTxId(url) {
  const match = url.match(/^ar:\/\/([a-zA-Z0-9_-]{43})/);
  return match ? match[1] : null;
}

/**
 * Save bypass decision
 */
async function saveBypassDecision(url, permanent) {
  if (permanent) {
    // Save to permanent storage
    const { [BYPASS_STORAGE_KEY]: bypasses = {} } = await chrome.storage.local.get(BYPASS_STORAGE_KEY);
    bypasses[url] = {
      timestamp: Date.now(),
      permanent: true
    };
    await chrome.storage.local.set({ [BYPASS_STORAGE_KEY]: bypasses });
  } else {
    // Save to session storage
    const { [BYPASS_SESSION_KEY]: sessionBypasses = {} } = await chrome.storage.session.get(BYPASS_SESSION_KEY);
    sessionBypasses[url] = {
      timestamp: Date.now(),
      permanent: false
    };
    await chrome.storage.session.set({ [BYPASS_SESSION_KEY]: sessionBypasses });
  }
}

/**
 * Show error message
 */
function showError(message) {
  const errorDiv = document.createElement('div');
  errorDiv.className = 'error-message';
  errorDiv.textContent = message;
  errorDiv.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: var(--error);
    color: white;
    padding: var(--spacing-md) var(--spacing-lg);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-lg);
    z-index: 1000;
  `;
  document.body.appendChild(errorDiv);
  
  setTimeout(() => {
    errorDiv.remove();
  }, 5000);
}

/**
 * Apply theme based on user preference
 */
function applyTheme() {
  chrome.storage.local.get(['theme'], ({ theme = 'dark' }) => {
    document.documentElement.setAttribute('data-theme', theme);
  });
}