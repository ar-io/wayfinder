/**
 * WayFinder Popup
 * Modern homepage interface
 */

// Toast notification system
function showToast(message, type = 'success') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <div style="display: flex; align-items: center; gap: 8px;">
      <span>${type === 'success' ? '✓' : type === 'error' ? '✗' : '⚠'}</span>
      <span>${message}</span>
    </div>
  `;

  container.appendChild(toast);

  // Auto-remove after 3 seconds
  setTimeout(() => {
    if (toast.parentNode) {
      toast.parentNode.removeChild(toast);
    }
  }, 3000);
}

// Initialize popup
document.addEventListener('DOMContentLoaded', async () => {
  await initializePopup();
  setupEventHandlers();
  await loadStats();
  await loadCurrentStrategy();
  await loadCurrentVerification();
  updateConnectionStatus();
});

async function initializePopup() {
  // Apply saved theme
  await applyTheme();

  // Set dynamic version
  await setExtensionVersion();
}

async function setExtensionVersion() {
  try {
    const manifest = chrome.runtime.getManifest();
    const versionElement = document.getElementById('extensionVersion');
    if (versionElement) {
      versionElement.textContent = `v${manifest.version}`;
    }
  } catch (error) {
    console.error('Failed to set extension version:', error);
  }
}

function setupEventHandlers() {
  // Navigation cards
  document.getElementById('showGateways')?.addEventListener('click', () => {
    window.location.href = 'gateways.html';
  });

  document.getElementById('showHistory')?.addEventListener('click', () => {
    window.location.href = 'history.html';
  });

  document.getElementById('showSettings')?.addEventListener('click', () => {
    window.location.href = 'settings.html';
  });

  // Current strategy change
  document.getElementById('changeStrategy')?.addEventListener('click', () => {
    window.location.href = 'settings.html#routing';
  });

  // Current verification change
  document
    .getElementById('changeVerification')
    ?.addEventListener('click', () => {
      window.location.href = 'settings.html#verification';
    });
}

async function loadStats() {
  try {
    // Load gateway stats and daily stats
    const {
      localGatewayAddressRegistry = {},
      gatewayPerformance = {},
      dailyStats,
    } = await chrome.storage.local.get([
      'localGatewayAddressRegistry',
      'gatewayPerformance',
      'dailyStats',
    ]);

    const activeCount = Object.values(localGatewayAddressRegistry).filter(
      (gateway) => gateway.status === 'joined',
    ).length;

    document.getElementById('activeGatewayCount').textContent = activeCount;

    // Calculate average response time
    const performances = Object.values(gatewayPerformance);
    if (performances.length > 0) {
      const avgResponseTimes = performances
        .map((p) => p.avgResponseTime)
        .filter((time) => time !== undefined);

      const overallAvg =
        avgResponseTimes.length > 0
          ? avgResponseTimes.reduce((a, b) => a + b, 0) /
            avgResponseTimes.length
          : 0;

      document.getElementById('avgResponseTime').textContent =
        overallAvg > 0 ? `${Math.round(overallAvg)}ms` : '--';
    } else {
      document.getElementById('avgResponseTime').textContent = '--';
    }

    // Display actual requests today
    const today = new Date().toDateString();
    const requestsToday =
      dailyStats && dailyStats.date === today ? dailyStats.requestCount : 0;
    document.getElementById('requestsToday').textContent = requestsToday;
  } catch (error) {
    console.error('Error loading stats:', error);
  }
}

async function loadCurrentStrategy() {
  try {
    const { routingMethod = 'fastestPing' } = await chrome.storage.local.get([
      'routingMethod',
    ]);

    const strategyNames = {
      fastestPing: 'Fastest Ping',
      random: 'Random Selection',
      roundRobin: 'Round Robin',
      static: 'Static Gateway',
      // Legacy method fallbacks
      optimalGateway: 'Fastest Ping',
      weightedStake: 'Random Selection',
      topFiveStake: 'Random Selection',
      weightedOnchainPerformance: 'Fastest Ping',
      stakeRandom: 'Random Selection',
      highestStake: 'Random Selection',
    };

    const strategyName = strategyNames[routingMethod] || 'Fastest Ping';
    document.getElementById('currentStrategy').textContent = strategyName;
  } catch (error) {
    console.error('Error loading current strategy:', error);
  }
}

async function loadCurrentVerification() {
  try {
    const {
      verificationStrategy = 'hash',
      verificationStrict = false,
      verificationEnabled = true,
    } = await chrome.storage.local.get([
      'verificationStrategy',
      'verificationStrict',
      'verificationEnabled',
    ]);

    if (!verificationEnabled) {
      document.getElementById('currentVerification').textContent =
        'Verification Disabled';

      // Update the verification card appearance
      const verificationCard = document.querySelector('.verification-card');
      if (verificationCard) {
        verificationCard.classList.remove(
          'hash-mode',
          'dataroot-mode',
          'strict-mode',
          'background-mode',
        );
        verificationCard.classList.add('disabled-mode');
      }
      return;
    }

    const strategyNames = {
      hash: 'Hash Verification',
      dataRoot: 'Data Root Verification',
    };

    const strategyName =
      strategyNames[verificationStrategy] || 'Hash Verification';
    const modeName = verificationStrict ? 'Strict Mode' : 'Background Mode';

    document.getElementById('currentVerification').textContent =
      `${strategyName} (${modeName})`;

    // Update the border color based on strategy and mode
    const verificationCard = document.querySelector('.verification-card');
    if (verificationCard) {
      verificationCard.classList.remove(
        'hash-mode',
        'dataroot-mode',
        'strict-mode',
        'background-mode',
        'disabled-mode',
      );
      verificationCard.classList.add(`${verificationStrategy}-mode`);
      if (verificationStrict) {
        verificationCard.classList.add('strict-mode');
      } else {
        verificationCard.classList.add('background-mode');
      }
    }
  } catch (error) {
    console.error('Error loading current verification:', error);
  }
}

async function updateConnectionStatus() {
  try {
    // Test connection to a known gateway
    const isConnected = await testConnection();
    const statusElement = document.getElementById('connectionStatus');

    if (!statusElement) return;

    const statusText = statusElement.querySelector('.status-text');

    if (statusText) {
      if (isConnected) {
        statusText.textContent = 'Connected';
        statusElement.classList.remove('limited', 'offline');
        statusElement.classList.add('connected');
      } else {
        statusText.textContent = 'Limited';
        statusElement.classList.remove('connected', 'offline');
        statusElement.classList.add('limited');
      }
    }
  } catch (_error) {
    const statusElement = document.getElementById('connectionStatus');
    const statusText = statusElement?.querySelector('.status-text');

    if (statusText) {
      statusText.textContent = 'Offline';
      statusElement.classList.remove('connected', 'limited');
      statusElement.classList.add('offline');
    }
  }
}

async function testConnection() {
  try {
    const response = await fetch('https://arweave.net/info', {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function applyTheme() {
  try {
    const { theme = 'dark' } = await chrome.storage.local.get(['theme']);
    const body = document.body;

    body.classList.remove('light-mode', 'dark-mode');

    if (theme === 'light') {
      body.setAttribute('data-theme', 'light');
    } else if (theme === 'auto') {
      // Detect system preference
      const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      body.setAttribute('data-theme', isDark ? 'dark' : 'light');
    } else {
      body.setAttribute('data-theme', 'dark');
    }
  } catch (error) {
    console.error('Error applying theme:', error);
  }
}

// Listen for system theme changes when auto theme is selected
window
  .matchMedia('(prefers-color-scheme: dark)')
  .addEventListener('change', async (_e) => {
    const { theme } = await chrome.storage.local.get(['theme']);
    if (theme === 'auto') {
      applyTheme();
    }
  });
