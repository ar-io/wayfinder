/**
 * WayFinder Settings
 * Modern settings interface for routing and verification configuration
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

// Initialize settings page
document.addEventListener('DOMContentLoaded', async () => {
  await initializeSettings();
  setupEventHandlers();
  // Small delay to ensure DOM is fully ready
  setTimeout(async () => {
    await loadCurrentSettings();
    await updatePerformanceStats();
    await updateGatewayCounts();
    updateLastSyncTime();
    await setExtensionVersion();

    // Handle hash navigation
    handleHashNavigation();
  }, 50);
});

// Handle navigation from popup with hash
function handleHashNavigation() {
  const hash = window.location.hash;
  if (hash) {
    const targetElement = document.querySelector(hash);
    if (targetElement) {
      // Scroll to the element with a small offset for better visibility
      targetElement.scrollIntoView({ behavior: 'smooth', block: 'start' });

      // Add a highlight effect
      targetElement.classList.add('highlight');
      setTimeout(() => {
        targetElement.classList.remove('highlight');
      }, 2000);
    }
  }
}

async function initializeSettings() {
  // Update connection status
  updateConnectionStatus();

  // Setup expandable sections
  setupExpandableSections();

  // Initialize routing strategy explanations
  setupRoutingStrategyDetails();

  // Initialize verification mode explanations
  setupVerificationModeExplanations();
}

function setupEventHandlers() {
  // Back button
  document.getElementById('backToMain')?.addEventListener('click', () => {
    window.location.href = 'popup.html';
  });

  // Quick actions
  document
    .getElementById('resetSettings')
    ?.addEventListener('click', resetSettings);

  // Routing strategy selection
  document
    .querySelectorAll('input[name="routingStrategy"]')
    .forEach((radio) => {
      radio.addEventListener('change', handleRoutingStrategyChange);
    });

  // Static gateway configuration
  document
    .getElementById('staticGatewayUrl')
    ?.addEventListener('input', validateStaticGateway);
  document
    .getElementById('testStaticGateway')
    ?.addEventListener('click', testStaticGateway);

  // Verification settings
  document
    .querySelectorAll('input[name="verificationStrategy"]')
    .forEach((radio) => {
      radio.addEventListener('change', handleVerificationStrategyChange);
    });

  // Verification mode handlers
  document
    .querySelectorAll('input[name="verificationMode"]')
    .forEach((radio) => {
      radio.addEventListener('change', handleVerificationModeChange);
    });

  // Switches
  document
    .getElementById('showVerificationIndicators')
    ?.addEventListener('change', saveVerificationIndicators);
  document
    .getElementById('showVerificationToasts')
    ?.addEventListener('change', saveVerificationToasts);
  document
    .getElementById('ensResolution')
    ?.addEventListener('change', saveEnsResolution);

  // Advanced settings
  document
    .getElementById('saveAdvancedSettings')
    ?.addEventListener('click', saveAdvancedSettings);
  document
    .getElementById('resetToDefaults')
    ?.addEventListener('click', resetAdvancedToDefaults);

  // Performance actions
  document
    .getElementById('clearPerformanceData')
    ?.addEventListener('click', clearPerformanceData);

  // Gateway registry sync
  document
    .getElementById('syncGatewayRegistry')
    ?.addEventListener('click', syncGatewayRegistry);

  // Theme selection
  document.querySelectorAll('input[name="theme"]').forEach((radio) => {
    radio.addEventListener('change', handleThemeChange);
  });

  // View logs
  document.getElementById('viewLogs')?.addEventListener('click', viewLogs);
}

function setupExpandableSections() {
  document.querySelectorAll('.expandable .config-header').forEach((header) => {
    header.addEventListener('click', () => {
      const section = header.closest('.expandable');
      section.classList.toggle('expanded');
    });
  });
}

function setupRoutingStrategyDetails() {
  document.querySelectorAll('.strategy-option').forEach((option) => {
    const radio = option.querySelector('input[type="radio"]');
    const header = option.querySelector('.strategy-header');

    header.addEventListener('click', () => {
      radio.checked = true;
      handleRoutingStrategyChange({ target: radio });
    });
  });
}

function setupVerificationModeExplanations() {
  document
    .querySelectorAll('input[name="verificationMode"]')
    .forEach((radio) => {
      radio.addEventListener('change', () => {
        // Hide all descriptions
        document.querySelectorAll('.mode-description').forEach((desc) => {
          desc.style.display = 'none';
        });

        // Show selected description
        const selectedDesc = document.querySelector(
          `[data-mode="${radio.value}"]`,
        );
        if (selectedDesc) {
          selectedDesc.style.display = 'block';
        }
      });
    });
}

async function loadCurrentSettings() {
  try {
    const settings = await chrome.storage.local.get([
      'routingMethod',
      'staticGateway',
      'verificationStrategy',
      'verificationStrict',
      'showVerificationIndicators',
      'showVerificationToasts',
      'ensResolutionEnabled',
      'theme',
      'processId',
      'aoCuUrl',
    ]);

    // Load static gateway URL if set
    if (settings.staticGateway) {
      const { protocol, fqdn, port } = settings.staticGateway.settings;
      const staticUrl = `${protocol}://${fqdn}${port !== (protocol === 'https' ? 443 : 80) ? `:${port}` : ''}`;
      const staticGatewayUrlEl = document.getElementById('staticGatewayUrl');
      if (staticGatewayUrlEl) {
        staticGatewayUrlEl.value = staticUrl;
      }
    }

    // Load routing strategy - if static gateway exists and routing is static, use static
    let routingMethod = settings.routingMethod || 'fastestPing';
    if (settings.staticGateway && routingMethod === 'static') {
      routingMethod = 'static';
    }

    // Ensure a valid radio button is selected
    const routingRadio = document.querySelector(
      `input[name="routingStrategy"][value="${routingMethod}"]`,
    );
    if (routingRadio) {
      routingRadio.checked = true;
      // Force visual update
      routingRadio.dispatchEvent(new Event('change', { bubbles: true }));
      handleRoutingStrategyChange({ target: routingRadio });
    } else {
      // Fallback to fastestPing if the saved method is invalid
      const fallbackRadio = document.querySelector(
        'input[name="routingStrategy"][value="fastestPing"]',
      );
      if (fallbackRadio) {
        fallbackRadio.checked = true;
        fallbackRadio.dispatchEvent(new Event('change', { bubbles: true }));
        handleRoutingStrategyChange({ target: fallbackRadio });
      }
    }

    // Load verification settings
    const verificationStrategy = settings.verificationStrategy || 'hash';
    const verificationStrategyRadio = document.querySelector(
      `input[name="verificationStrategy"][value="${verificationStrategy}"]`,
    );
    if (verificationStrategyRadio) {
      verificationStrategyRadio.checked = true;
      // Force visual update
      verificationStrategyRadio.dispatchEvent(
        new Event('change', { bubbles: true }),
      );
    }

    // Load verification mode
    const verificationEnabled = settings.verificationEnabled !== false; // Default to true
    const verificationStrict = settings.verificationStrict || false;

    let verificationMode;
    if (!verificationEnabled) {
      verificationMode = 'off';
    } else if (verificationStrict) {
      verificationMode = 'strict';
    } else {
      verificationMode = 'background';
    }

    // Select the appropriate radio button
    const verificationModeRadio = document.querySelector(
      `input[name="verificationMode"][value="${verificationMode}"]`,
    );
    if (verificationModeRadio) {
      verificationModeRadio.checked = true;
      // Trigger change event to update UI
      verificationModeRadio.dispatchEvent(
        new Event('change', { bubbles: true }),
      );
    }

    // Load switches
    const showIndicators = settings.showVerificationIndicators !== false;
    const showIndicatorsEl = document.getElementById(
      'showVerificationIndicators',
    );
    if (showIndicatorsEl) {
      showIndicatorsEl.checked = showIndicators;
    }

    const showToasts = settings.showVerificationToasts === true; // Default false to avoid spam
    const showToastsEl = document.getElementById('showVerificationToasts');
    if (showToastsEl) {
      showToastsEl.checked = showToasts;
    }

    const ensEnabled = settings.ensResolutionEnabled !== false;
    const ensEl = document.getElementById('ensResolution');
    if (ensEl) {
      ensEl.checked = ensEnabled;
    }

    // Load theme
    const theme = settings.theme || 'dark';
    const themeRadio = document.querySelector(
      `input[name="theme"][value="${theme}"]`,
    );
    if (themeRadio) {
      themeRadio.checked = true;
      applyTheme(theme);
    }

    // Load advanced settings
    if (settings.processId) {
      const processIdEl = document.getElementById('processId');
      if (processIdEl) {
        processIdEl.value = settings.processId;
      }
    }
    if (settings.aoCuUrl) {
      const aoCuUrlEl = document.getElementById('aoCuUrl');
      if (aoCuUrlEl) {
        aoCuUrlEl.value = settings.aoCuUrl;
      }
    }
  } catch (error) {
    console.error('Error loading settings:', error);
    showToast('Error loading settings', 'error');
  }
}

async function updateConnectionStatus() {
  try {
    // Check if we can connect to a gateway
    const isConnected = await testConnection();
    const statusIndicator = document.getElementById('connectionStatus');

    if (!statusIndicator) return;

    const statusDot = statusIndicator.querySelector('.status-dot');
    const statusText = statusIndicator.querySelector('span');

    if (statusDot && statusText) {
      if (isConnected) {
        statusDot.style.background = 'var(--success)';
        statusText.textContent = 'Connected';
      } else {
        statusDot.style.background = 'var(--warning)';
        statusText.textContent = 'Limited';
      }
    }
  } catch (_error) {
    const statusIndicator = document.getElementById('connectionStatus');

    if (!statusIndicator) return;

    const statusDot = statusIndicator.querySelector('.status-dot');
    const statusText = statusIndicator.querySelector('span');

    if (statusDot && statusText) {
      statusDot.style.background = 'var(--error)';
      statusText.textContent = 'Offline';
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

async function updatePerformanceStats() {
  try {
    const { gatewayPerformance = {} } = await chrome.storage.local.get([
      'gatewayPerformance',
    ]);

    const performances = Object.values(gatewayPerformance);
    if (performances.length > 0) {
      // Calculate average response time
      const avgResponseTimes = performances
        .map((p) => p.avgResponseTime)
        .filter((time) => time !== undefined);

      const overallAvg =
        avgResponseTimes.length > 0
          ? avgResponseTimes.reduce((a, b) => a + b, 0) /
            avgResponseTimes.length
          : 0;

      const avgResponseTimeEl = document.getElementById('avgResponseTime');
      if (avgResponseTimeEl) {
        avgResponseTimeEl.textContent =
          overallAvg > 0 ? `${Math.round(overallAvg)}ms` : '--';
      }

      // Calculate success rate
      const successRates = performances.map((p) => {
        const total = p.successCount + p.failures;
        return total > 0 ? (p.successCount / total) * 100 : 0;
      });

      const avgSuccessRate =
        successRates.length > 0
          ? successRates.reduce((a, b) => a + b, 0) / successRates.length
          : 0;

      const successRateEl = document.getElementById('successRate');
      if (successRateEl) {
        successRateEl.textContent =
          avgSuccessRate > 0 ? `${Math.round(avgSuccessRate)}%` : '--';
      }
    }

    // Get request count from daily stats
    const { dailyStats } = await chrome.storage.local.get(['dailyStats']);
    const today = new Date().toDateString();
    const todayRequests =
      dailyStats && dailyStats.date === today ? dailyStats.requestCount : 0;

    const requestsTodayEl = document.getElementById('requestsToday');
    if (requestsTodayEl) {
      requestsTodayEl.textContent = todayRequests;
    }

    // Verification stats from daily stats
    const verifiedCount =
      dailyStats && dailyStats.date === today ? dailyStats.verifiedCount : 0;
    const failedCount =
      dailyStats && dailyStats.date === today ? dailyStats.failedCount : 0;
    const totalVerificationAttempts = verifiedCount + failedCount;
    const verificationSuccessRate =
      totalVerificationAttempts > 0
        ? Math.round((verifiedCount / totalVerificationAttempts) * 100)
        : 0;

    const verifiedTransactionsEl = document.getElementById(
      'verifiedTransactions',
    );
    if (verifiedTransactionsEl) {
      verifiedTransactionsEl.textContent =
        verifiedCount > 0 ? verifiedCount : '--';
    }

    const verificationSuccessRateEl = document.getElementById(
      'verificationSuccessRate',
    );
    if (verificationSuccessRateEl) {
      verificationSuccessRateEl.textContent =
        verificationSuccessRate > 0 ? `${verificationSuccessRate}%` : '--';
    }
  } catch (error) {
    console.error('Error updating performance stats:', error);
  }
}

async function handleRoutingStrategyChange(event) {
  const strategy = event.target.value;

  // Show/hide static gateway configuration
  const staticConfig = document.querySelector('.static-gateway-config');
  if (staticConfig) {
    if (strategy === 'static') {
      staticConfig.style.display = 'block';
    } else {
      staticConfig.style.display = 'none';
    }
  }

  // Only save if this is a real user change (not initialization)
  if (event.isTrusted) {
    // Save the routing strategy
    await chrome.storage.local.set({ routingMethod: strategy });

    // Send message to background script to update routing
    try {
      await chrome.runtime.sendMessage({
        message: 'updateRoutingStrategy',
        strategy,
      });
    } catch (error) {
      console.error('Error updating routing strategy:', error);
    }
  }
}

async function validateStaticGateway() {
  const url = document.getElementById('staticGatewayUrl').value;
  const testButton = document.getElementById('testStaticGateway');

  try {
    new URL(url);
    testButton.disabled = false;
  } catch {
    testButton.disabled = true;
  }
}

async function testStaticGateway() {
  const url = document.getElementById('staticGatewayUrl').value;
  const testButton = document.getElementById('testStaticGateway');

  testButton.disabled = true;
  testButton.textContent = 'Testing...';

  try {
    const response = await fetch(`${url}/info`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });

    if (response.ok) {
      showToast('Gateway is reachable!', 'success');

      // Save the static gateway
      const urlObj = new URL(url);
      const staticGateway = {
        settings: {
          protocol: urlObj.protocol.replace(':', ''),
          fqdn: urlObj.hostname,
          port: parseInt(
            urlObj.port || (urlObj.protocol === 'https:' ? '443' : '80'),
          ),
        },
      };

      await chrome.storage.local.set({ staticGateway });
    } else {
      showToast(
        'Gateway responded but may not be an Arweave gateway',
        'warning',
      );
    }
  } catch (_error) {
    showToast('Gateway is not reachable', 'error');
  } finally {
    testButton.disabled = false;
    testButton.textContent = 'Test';
  }
}

async function handleVerificationStrategyChange(event) {
  const strategy = event.target.value;
  await chrome.storage.local.set({ verificationStrategy: strategy });

  try {
    await chrome.runtime.sendMessage({ message: 'resetWayfinder' });
  } catch (error) {
    console.error('Error updating verification strategy:', error);
  }
}

async function handleVerificationModeChange(event) {
  const mode = event.target.value;

  // Update storage based on mode
  if (mode === 'off') {
    await chrome.storage.local.set({
      verificationEnabled: false,
      verificationStrict: false,
    });
  } else if (mode === 'background') {
    await chrome.storage.local.set({
      verificationEnabled: true,
      verificationStrict: false,
    });
  } else if (mode === 'strict') {
    await chrome.storage.local.set({
      verificationEnabled: true,
      verificationStrict: true,
    });
  }

  // Update description
  const descriptions = {
    off: 'Verification is disabled - data will not be verified',
    background:
      'Verifies data in the background without blocking requests (recommended)',
    strict:
      'Blocks requests until verification completes - slower but more secure',
  };

  const descElement = document.getElementById('verificationModeDesc');
  if (descElement) {
    descElement.textContent = descriptions[mode] || descriptions.background;
  }

  // Show/hide verification strategy options
  const strategyWrapper = document.getElementById(
    'verificationStrategyWrapper',
  );
  if (strategyWrapper) {
    if (mode === 'off') {
      strategyWrapper.classList.add('hidden');
    } else {
      strategyWrapper.classList.remove('hidden');
    }
  }

  try {
    await chrome.runtime.sendMessage({ message: 'resetWayfinder' });
  } catch (error) {
    console.error('Error updating verification mode:', error);
  }
}

async function saveVerificationIndicators(event) {
  const enabled = event.target.checked;
  await chrome.storage.local.set({ showVerificationIndicators: enabled });
}

async function saveVerificationToasts(event) {
  const enabled = event.target.checked;
  await chrome.storage.local.set({ showVerificationToasts: enabled });
}

async function saveEnsResolution(event) {
  const enabled = event.target.checked;
  await chrome.storage.local.set({ ensResolutionEnabled: enabled });
}

async function handleThemeChange(event) {
  const theme = event.target.value;
  await chrome.storage.local.set({ theme });
  applyTheme(theme);
  showToast(`Theme changed to ${theme}`, 'success');
}

function applyTheme(theme) {
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
}

async function resetSettings() {
  if (
    !confirm(
      'Are you sure you want to reset all Wayfinder settings to defaults? This cannot be undone.',
    )
  ) {
    return;
  }

  try {
    // Clear specific settings
    await chrome.storage.local.remove([
      'routingMethod',
      'staticGateway',
      'verificationMode',
      'processId',
      'aoCuUrl',
      'theme',
    ]);

    showToast('Settings reset to defaults', 'success');

    // Reload the page to show default values
    setTimeout(() => {
      window.location.reload();
    }, 1000);
  } catch (error) {
    console.error('Error resetting settings:', error);
    showToast('Failed to reset settings', 'error');
  }
}

async function saveAdvancedSettings() {
  const processIdEl = document.getElementById('processId');
  const aoCuUrlEl = document.getElementById('aoCuUrl');

  const processId = processIdEl ? processIdEl.value.trim() : '';
  const aoCuUrl = aoCuUrlEl ? aoCuUrlEl.value.trim() : '';

  try {
    const settings = {};

    if (processId) {
      settings.processId = processId;
    }

    if (aoCuUrl) {
      // Validate URL
      new URL(aoCuUrl);
      settings.aoCuUrl = aoCuUrl;
    }

    await chrome.storage.local.set(settings);

    // Notify background script
    await chrome.runtime.sendMessage({
      message: 'updateAdvancedSettings',
      settings,
    });

    showToast('Advanced settings saved', 'success');
  } catch (error) {
    console.error('Error saving advanced settings:', error);
    showToast('Invalid settings provided', 'error');
  }
}

async function resetAdvancedToDefaults() {
  try {
    await chrome.storage.local.remove(['processId', 'aoCuUrl']);

    const processIdEl = document.getElementById('processId');
    if (processIdEl) {
      processIdEl.value = '';
    }

    const aoCuUrlEl = document.getElementById('aoCuUrl');
    if (aoCuUrlEl) {
      aoCuUrlEl.value = '';
    }

    await chrome.runtime.sendMessage({ message: 'resetAdvancedSettings' });

    showToast('Advanced settings reset to defaults', 'success');
  } catch (error) {
    console.error('Error resetting advanced settings:', error);
    showToast('Failed to reset advanced settings', 'error');
  }
}

async function clearPerformanceData() {
  if (
    !confirm(
      'Clear all performance data? This will reset gateway performance metrics and daily statistics.',
    )
  ) {
    return;
  }

  try {
    await chrome.storage.local.remove(['gatewayPerformance', 'dailyStats']);
    showToast('Performance data cleared', 'success');
    await updatePerformanceStats();
  } catch (error) {
    console.error('Error clearing performance data:', error);
    showToast('Failed to clear performance data', 'error');
  }
}

function viewLogs() {
  // Open browser console for now - in future could open dedicated logs page
  showToast('Open browser console (F12) to view extension logs', 'info');
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

async function updateGatewayCounts() {
  try {
    const { localGatewayAddressRegistry = {} } = await chrome.storage.local.get(
      ['localGatewayAddressRegistry'],
    );

    const gateways = Object.values(localGatewayAddressRegistry);
    const totalCount = gateways.length;
    const activeCount = gateways.filter(
      (gateway) => gateway.status === 'joined',
    ).length;

    const totalElement = document.getElementById('totalGateways');
    if (totalElement) {
      totalElement.textContent = totalCount;
    }

    const activeElement = document.getElementById('activeGateways');
    if (activeElement) {
      activeElement.textContent = activeCount;
    }

    // Update registry status based on gateway count
    const statusElement = document.getElementById('registryStatus');
    if (statusElement) {
      const statusDot = statusElement.querySelector('.status-dot');
      const statusText = statusElement.querySelector('span:last-child');

      if (totalCount > 0) {
        statusElement.classList.add('connected');
        statusElement.classList.remove('offline');
        if (statusText) statusText.textContent = 'Active';
        if (statusDot) statusDot.style.backgroundColor = '#10b981';
      } else {
        statusElement.classList.add('offline');
        statusElement.classList.remove('connected');
        if (statusText) statusText.textContent = 'Empty';
        if (statusDot) statusDot.style.backgroundColor = '#ef4444';
      }
    }
  } catch (error) {
    console.error('Error updating gateway counts:', error);
  }
}

async function updateLastSyncTime() {
  try {
    const { lastSyncTime } = await chrome.storage.local.get(['lastSyncTime']);
    const lastUpdatedElement = document.getElementById('lastUpdated');

    if (lastUpdatedElement) {
      if (lastSyncTime) {
        const date = new Date(lastSyncTime);
        lastUpdatedElement.textContent = date.toLocaleString();
      } else {
        lastUpdatedElement.textContent = 'Never';
      }
    }
  } catch (error) {
    console.error('Error updating last sync time:', error);
  }
}

async function syncGatewayRegistry() {
  const button = document.getElementById('syncGatewayRegistry');
  const originalContent = button.innerHTML;

  try {
    // Update button state
    button.disabled = true;
    button.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation: spin 1s linear infinite;">
        <path d="M21 2v6h-6M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8M3 22v-6h6M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/>
      </svg>
      <span>Syncing...</span>
    `;

    // Send sync message to background script
    const response = await chrome.runtime.sendMessage({
      message: 'syncGatewayAddressRegistry',
    });

    if (response && response.success) {
      // Update counts and timestamp
      await updateGatewayCounts();
      updateLastSyncTime();
      showToast('Gateway registry synced successfully', 'success');
    } else {
      throw new Error(response?.error || 'Unknown error occurred');
    }
  } catch (error) {
    console.error('Error syncing gateway registry:', error);
    showToast('Failed to sync gateway registry', 'error');
  } finally {
    // Restore button state
    button.disabled = false;
    button.innerHTML = originalContent;
  }
}

// Listen for system theme changes when auto theme is selected
window
  .matchMedia('(prefers-color-scheme: dark)')
  .addEventListener('change', async (_e) => {
    const { theme } = await chrome.storage.local.get(['theme']);
    if (theme === 'auto') {
      applyTheme('auto');
    }
  });
