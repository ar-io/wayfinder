/**
 * WayFinder
 * Copyright (C) 2022-2025 Permanent Data Solutions, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// Import wayfinder-core modules for gateway discovery
import { ARIO } from '@ar.io/sdk/web';
import { NetworkGatewaysProvider } from '@ar.io/wayfinder-core';
import { setExtensionVersion } from './utils/version';

// Toast notification system
function showToast(
  message: string,
  type: 'warning' | 'info' | 'success' | 'error' = 'success',
) {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <div style="display: flex; align-items: center; gap: 8px;">
      <span>${type === 'success' ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' : type === 'error' ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>'}</span>
      <span>${message}</span>
    </div>
  `;

  container?.appendChild(toast);

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
      // Advanced settings expansion logic removed - no longer needed

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
}

function setupEventHandlers() {
  // Back button
  document.getElementById('backToMain')?.addEventListener('click', () => {
    // Use relative path for Chrome extension navigation
    window.location.href = './popup.html';
  });

  // Quick actions
  document
    .getElementById('resetSettings')
    ?.addEventListener('click', resetSettings);

  // Data management
  document
    .getElementById('clearCache')
    ?.addEventListener('click', clearAllCache);
  document
    .getElementById('resetExtension')
    ?.addEventListener('click', resetAllData);

  // Advanced settings toggle
  // Advanced toggle functionality removed - no longer needed

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
  document
    .getElementById('applyStaticGateway')
    ?.addEventListener('click', applyStaticGateway);
  document
    .getElementById('gatewayDropdown')
    ?.addEventListener('change', handleGatewayDropdownChange);

  // Switches
  // Verification toasts for remote verification status
  document
    .getElementById('showVerificationToasts')
    ?.addEventListener('change', saveVerificationToasts);
  document
    .getElementById('ensResolution')
    ?.addEventListener('change', saveEnsResolution);

  // Advanced settings are now saved automatically on change
  document
    .getElementById('processId')
    ?.addEventListener('change', handleProcessIdChange);
  document
    .getElementById('aoCuUrl')
    ?.addEventListener('change', handleAoCuUrlChange);

  // Performance actions moved to performance.js

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

  // Gateway provider settings
  document
    .getElementById('gatewaySortBy')
    ?.addEventListener('change', handleGatewaySortByChange);
  document
    .getElementById('gatewaySortOrder')
    ?.addEventListener('change', handleGatewaySortOrderChange);
  document
    .getElementById('gatewayCacheTTL')
    ?.addEventListener('input', handleGatewayCacheTTLChange);

  // Telemetry toggle
  document
    .getElementById('telemetryToggle')
    ?.addEventListener('change', handleTelemetryToggle);
}

function setupExpandableSections() {
  document.querySelectorAll('.expandable .config-header').forEach((header) => {
    header.addEventListener('click', (e: any) => {
      // Prevent clicks on interactive elements within the header
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') {
        return;
      }

      const section = header.closest('.expandable');
      section?.classList.toggle('expanded');
    });
  });
}

// toggleAdvancedSettings function removed - no longer needed

function setupRoutingStrategyDetails() {
  // Only select strategy options within the routing section
  document
    .querySelectorAll('.routing-strategy-selector .strategy-option')
    .forEach((option) => {
      const radio = option.querySelector(
        'input[type="radio"]',
      ) as HTMLInputElement;
      const header = option.querySelector('.strategy-header');

      header?.addEventListener('click', () => {
        if (!radio.checked) {
          // Only trigger if not already selected
          radio.checked = true;
          // Create a synthetic event that will trigger saving
          handleRoutingStrategyChange({ target: radio, isTrusted: true });
        }
      });
    });
}

async function loadCurrentSettings() {
  try {
    const settings = await chrome.storage.local.get([
      'routingMethod',
      'staticGateway',
      'ensResolutionEnabled',
      'theme',
      'processId',
      'aoCuUrl',
      'gatewaySortBy',
      'gatewaySortOrder',
      'gatewayCacheTTL',
      'advancedSettingsExpanded',
      'telemetryEnabled',
      'showVerificationToasts',
    ]);

    // Load static gateway URL if set
    if (settings.staticGateway) {
      const { protocol, fqdn, port } = settings.staticGateway.settings;
      const staticUrl = `${protocol}://${fqdn}${port !== (protocol === 'https' ? 443 : 80) ? `:${port}` : ''}`;
      const staticGatewayUrlEl = document.getElementById(
        'staticGatewayUrl',
      ) as HTMLInputElement;
      if (staticGatewayUrlEl) {
        staticGatewayUrlEl.value = staticUrl;
      }
    }

    // Load routing strategy
    const routingMethod = settings.routingMethod || 'fastestPing';

    // Ensure a valid radio button is selected
    const routingRadio = document.querySelector<HTMLInputElement>(
      `input[name="routingStrategy"][value="${routingMethod}"]`,
    );
    if (routingRadio) {
      routingRadio.checked = true;
      // Update UI without triggering change event
      handleRoutingStrategyChange({ target: routingRadio, isTrusted: false });
    } else {
      // Fallback to fastestPing if the saved method is invalid
      const fallbackRadio = document.querySelector<HTMLInputElement>(
        'input[name="routingStrategy"][value="fastestPing"]',
      );
      if (fallbackRadio) {
        fallbackRadio.checked = true;
        handleRoutingStrategyChange({
          target: fallbackRadio,
          isTrusted: false,
        });
      }
    }

    const ensEnabled = settings.ensResolutionEnabled !== false;
    const ensEl = document.getElementById('ensResolution') as HTMLInputElement;
    if (ensEl) {
      ensEl.checked = ensEnabled;
    }

    // Load verification toast setting
    const showToasts = settings.showVerificationToasts !== false; // Default to false
    const toastsEl = document.getElementById(
      'showVerificationToasts',
    ) as HTMLInputElement;
    if (toastsEl) {
      toastsEl.checked = showToasts;
    }

    // Load theme
    const theme = settings.theme || 'dark';
    const themeRadio = document.querySelector<HTMLInputElement>(
      `input[name="theme"][value="${theme}"]`,
    );
    if (themeRadio) {
      themeRadio.checked = true;
      applyTheme(theme);
    }

    // Load advanced settings
    if (settings.processId) {
      const processIdEl = document.getElementById(
        'processId',
      ) as HTMLInputElement;
      if (processIdEl) {
        processIdEl.value = settings.processId;
      }
    }
    if (settings.aoCuUrl) {
      const aoCuUrlEl = document.getElementById('aoCuUrl') as HTMLInputElement;
      if (aoCuUrlEl) {
        aoCuUrlEl.value = settings.aoCuUrl;
      }
    }

    // Load gateway provider settings
    const gatewaySortBy = settings.gatewaySortBy || 'operatorStake';
    const gatewaySortByEl = document.getElementById(
      'gatewaySortBy',
    ) as HTMLInputElement;
    if (gatewaySortByEl) {
      gatewaySortByEl.value = gatewaySortBy;
    }

    const gatewaySortOrder = settings.gatewaySortOrder || 'desc';
    const gatewaySortOrderEl = document.getElementById(
      'gatewaySortOrder',
    ) as HTMLInputElement;
    if (gatewaySortOrderEl) {
      gatewaySortOrderEl.value = gatewaySortOrder;
    }

    const gatewayCacheTTL = settings.gatewayCacheTTL || 3600;
    const gatewayCacheTTLEl = document.getElementById(
      'gatewayCacheTTL',
    ) as HTMLInputElement;
    if (gatewayCacheTTLEl) {
      gatewayCacheTTLEl.value = gatewayCacheTTL;
    }
    const gatewayCacheTTLValueEl = document.getElementById(
      'gatewayCacheTTLValue',
    ) as HTMLInputElement;
    if (gatewayCacheTTLValueEl) {
      gatewayCacheTTLValueEl.textContent = gatewayCacheTTL;
    }

    // Load telemetry settings
    const telemetryEnabled = settings.telemetryEnabled || false;
    const telemetryToggle = document.getElementById(
      'telemetryToggle',
    ) as HTMLInputElement;
    if (telemetryToggle) {
      telemetryToggle.checked = telemetryEnabled;
      // Update details visibility
      const telemetryDetails = document.getElementById('telemetryDetails');
      if (telemetryDetails) {
        telemetryDetails.style.display = telemetryEnabled ? 'block' : 'none';
      }
    }
  } catch (error) {
    console.error('Error loading settings:', error);
    showToast('Error loading settings', 'error');
  }
}

async function updateConnectionStatus() {
  // Show static "Connected" status (connection testing removed)
  const statusIndicator = document.getElementById('connectionStatus');

  if (!statusIndicator) return;

  const statusDot =
    statusIndicator.querySelector<HTMLDivElement>('.status-dot');
  const statusText = statusIndicator.querySelector<HTMLSpanElement>('span');

  if (statusDot && statusText) {
    statusDot.style.background = 'var(--success)';
    statusText.textContent = 'Connected';
  }
}

async function handleRoutingStrategyChange(event: any) {
  const strategy = event.target.value;
  console.log(
    `[SETTINGS] Routing strategy changed to: ${strategy}, isTrusted: ${event.isTrusted}`,
  );

  // Show/hide static gateway configuration
  const staticConfig = document.querySelector<HTMLDivElement>(
    '.static-gateway-config',
  );
  const applyContainer = document.getElementById(
    'applyStaticGatewayContainer',
  ) as HTMLDivElement;

  if (staticConfig) {
    if (strategy === 'static') {
      staticConfig.style.display = 'block';
      // Populate the gateway dropdown when static is selected
      await populateGatewayDropdown();

      // Don't save yet for static - user needs to configure and apply
      if (event.isTrusted) {
        showToast(
          'Please configure and test a gateway, then click Apply',
          'info',
        );
      }
      return; // Exit early for static
    } else {
      staticConfig.style.display = 'none';
      // Hide apply button when switching away
      if (applyContainer) {
        applyContainer.style.display = 'none';
      }
    }
  }

  // Only save if this is a real user change (not initialization) and not static
  if (event.isTrusted && strategy !== 'static') {
    // Save the routing strategy
    await chrome.storage.local.set({ routingMethod: strategy });

    // Send message to background script to update routing
    try {
      const response = await chrome.runtime.sendMessage({
        message: 'updateRoutingStrategy',
        strategy,
      });

      if (response && response.success) {
        // Show success feedback
        showToast('Routing strategy updated', 'success');

        // Update the current value display if it exists
        const currentValueEl = document.getElementById(
          'currentRoutingStrategy',
        );
        if (currentValueEl) {
          const strategyNames = {
            fastestPing: 'Fastest Ping',
            random: 'Balanced',
            static: 'Static Gateway',
          };
          currentValueEl.textContent =
            strategyNames[strategy as keyof typeof strategyNames] || strategy;
        }
      } else {
        throw new Error(
          response?.error || 'No response from background script',
        );
      }
    } catch (error) {
      console.error('Error updating routing strategy:', error);
      showToast('Failed to update routing strategy', 'error');
    }
  } else {
    console.log(`[SETTINGS] Skipping save for untrusted event`);
  }
}

// Store the tested gateway configuration temporarily
let pendingStaticGateway: {
  settings: { protocol: string; fqdn: string; port: number };
} | null = null;

async function testStaticGateway() {
  const url = document.getElementById('staticGatewayUrl') as HTMLInputElement;
  const testButton = document.getElementById(
    'testStaticGateway',
  ) as HTMLButtonElement;
  const applyContainer = document.getElementById(
    'applyStaticGatewayContainer',
  ) as HTMLDivElement;

  testButton.disabled = true;
  testButton.textContent = 'Testing...';

  try {
    const response = await fetch(`${url.value}/ar-io/info`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });

    if (response.ok) {
      showToast(
        'Gateway is reachable! Click Apply to use this gateway.',
        'success',
      );

      // Store the gateway configuration for applying later
      const urlObj = new URL(url.value);
      pendingStaticGateway = {
        settings: {
          protocol: urlObj.protocol.replace(':', ''),
          fqdn: urlObj.hostname,
          port: parseInt(
            urlObj.port || (urlObj.protocol === 'https:' ? '443' : '80'),
          ),
        },
      };

      // Show the apply button
      if (applyContainer) {
        applyContainer.style.display = 'block';
      }
    } else {
      showToast(
        `Gateway responded with status ${response.status}. Please verify this is a valid Arweave gateway.`,
        'warning',
      );
      // Hide apply button on failed test
      if (applyContainer) {
        applyContainer.style.display = 'none';
      }
      pendingStaticGateway = null;
    }
  } catch {
    showToast('Gateway is not reachable', 'error');
    // Hide apply button on failed test
    if (applyContainer) {
      applyContainer.style.display = 'none';
    }
    pendingStaticGateway = null;
  } finally {
    testButton.disabled = false;
    testButton.textContent = 'Test';
  }
}

// Apply the tested static gateway configuration
async function applyStaticGateway() {
  if (!pendingStaticGateway) {
    showToast('No gateway configuration to apply', 'error');
    return;
  }

  try {
    // Save the static gateway configuration
    await chrome.storage.local.set({
      staticGateway: pendingStaticGateway,
      routingMethod: 'static',
    });

    // Send message to background script to update routing
    const response = await chrome.runtime.sendMessage({
      message: 'updateRoutingStrategy',
      strategy: 'static',
    });

    if (response && response.success) {
      showToast('Static gateway applied successfully!', 'success');

      // Update the current value display
      const currentValueEl = document.getElementById('currentRoutingStrategy');
      if (currentValueEl) {
        currentValueEl.textContent = 'Static Gateway';
      }

      // Hide the apply button after successful application
      const applyContainer = document.getElementById(
        'applyStaticGatewayContainer',
      );
      if (applyContainer) {
        applyContainer.style.display = 'none';
      }

      // Clear the pending configuration
      pendingStaticGateway = null;
    } else {
      throw new Error(response?.error || 'Failed to apply static gateway');
    }
  } catch (error) {
    console.error('Error applying static gateway:', error);
    showToast('Failed to apply static gateway', 'error');
  }
}

// Get available gateways from existing synced registry
async function fetchAvailableGateways() {
  try {
    const { localGatewayAddressRegistry = {} } = await chrome.storage.local.get(
      ['localGatewayAddressRegistry'],
    );

    // Convert to array format with stake information
    const gateways = Object.entries(localGatewayAddressRegistry)
      .map(([address, gateway]: [string, any]) => ({
        address,
        fqdn: gateway.settings?.fqdn,
        protocol: gateway.settings?.protocol || 'https',
        port: gateway.settings?.port,
        operatorStake: gateway.operatorStake || 0,
        totalDelegatedStake: gateway.totalDelegatedStake || 0,
        status: gateway.status,
      }))
      .filter((gateway) => gateway.status === 'joined' && gateway.fqdn) // Only joined gateways
      .sort((a, b) => {
        // Sort by total stake (operator + delegated)
        const stakeA = a.operatorStake + a.totalDelegatedStake;
        const stakeB = b.operatorStake + b.totalDelegatedStake;
        return stakeB - stakeA;
      })
      .slice(0, 25); // Top 25 by stake

    return gateways;
  } catch (error) {
    console.error('Error fetching gateways from local registry:', error);
    // Try to fetch from AR.IO network as fallback
    try {
      const networkProvider = new NetworkGatewaysProvider({
        ario: ARIO.mainnet(),
      });
      const networkGateways = await networkProvider.getGateways();

      if (networkGateways.length > 0) {
        // Convert network gateways to the expected format
        return networkGateways.slice(0, 10).map((url, index) => ({
          fqdn: url.hostname,
          protocol: url.protocol.slice(0, -1), // Remove trailing ':'
          operatorStake: 1000 - index * 100, // Fake stake for sorting
          totalDelegatedStake: 0,
        }));
      }
    } catch (networkError) {
      console.error('Failed to fetch from AR.IO network:', networkError);
    }

    // Absolute last resort - return arweave.net
    return [
      {
        fqdn: 'arweave.net',
        protocol: 'https',
        operatorStake: 1,
        totalDelegatedStake: 0,
      },
    ];
  }
}

// Populate the gateway dropdown with available options
async function populateGatewayDropdown() {
  const dropdown = document.getElementById(
    'gatewayDropdown',
  ) as HTMLSelectElement;
  if (!dropdown) return;

  // Show loading state
  dropdown.innerHTML =
    '<option value="">Loading available gateways...</option>';
  dropdown.disabled = true;

  try {
    const gateways = await fetchAvailableGateways();

    // Clear and populate dropdown
    dropdown.innerHTML = '';

    // Add a default "select gateway" option
    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = 'Select a gateway...';
    dropdown.appendChild(defaultOption);

    // Add gateway options with stake information
    gateways.forEach((gateway: any) => {
      const option = document.createElement('option');
      const url = `${gateway.protocol}://${gateway.fqdn}${gateway.port && gateway.port !== (gateway.protocol === 'https' ? 443 : 80) ? `:${gateway.port}` : ''}`;
      option.value = url;

      // Format stake for display (convert from millio units to readable format)
      const totalStake = gateway.operatorStake + gateway.totalDelegatedStake;
      const stakeDisplay =
        totalStake > 0 ? formatStake(totalStake) : 'No stake';

      // Display format: "gateway.com (4.7M)"
      option.textContent = `${gateway.fqdn} (${stakeDisplay})`;
      dropdown.appendChild(option);
    });

    // Set a random gateway as the default placeholder
    if (gateways.length > 0) {
      const randomIndex = Math.floor(
        Math.random() * Math.min(5, gateways.length),
      ); // Pick from top 5
      const customInput = document.getElementById(
        'staticGatewayUrl',
      ) as HTMLInputElement;
      if (customInput && !customInput.value) {
        const randomGateway = gateways[randomIndex];
        const randomUrl = `${randomGateway.protocol}://${randomGateway.fqdn}`;
        customInput.placeholder = randomUrl;
      }
    }

    dropdown.disabled = false;
  } catch (error) {
    console.error('Error populating gateway dropdown:', error);
    dropdown.innerHTML = '<option value="">Error loading gateways</option>';
    dropdown.disabled = true;
  }
}

// Helper function to format stake amounts
function formatStake(stake: number) {
  // Assuming stake is in milli-units, convert to actual units first
  const actualStake = stake / 1000000; // Convert from milli to regular units

  if (actualStake >= 1000000) {
    return (actualStake / 1000000).toFixed(1) + 'M';
  } else if (actualStake >= 1000) {
    return (actualStake / 1000).toFixed(1) + 'K';
  } else if (actualStake >= 1) {
    return actualStake.toFixed(1);
  } else {
    return '0';
  }
}

// Handle gateway dropdown selection
function handleGatewayDropdownChange(event: any) {
  const selectedGateway = event.target.value;
  const customInput = document.getElementById(
    'staticGatewayUrl',
  ) as HTMLInputElement;

  if (selectedGateway && customInput) {
    customInput.value = selectedGateway;

    // Trigger validation
    validateStaticGateway();

    // Auto-test the selected gateway
    if (customInput.value) {
      testStaticGateway();
    }
  }
}

// Enhanced validation that also handles dropdown state
async function validateStaticGateway() {
  const url = document.getElementById('staticGatewayUrl') as HTMLInputElement;
  const testButton = document.getElementById(
    'testStaticGateway',
  ) as HTMLButtonElement;
  const dropdown = document.getElementById(
    'gatewayDropdown',
  ) as HTMLSelectElement;

  try {
    if (url) {
      new URL(url.value);
      testButton.disabled = false;

      // Update dropdown to show selected value if it matches
      if (dropdown) {
        const matchingOption = Array.from(dropdown.options).find(
          (option: any) => option.value === url.value,
        );
        if (matchingOption) {
          dropdown.value = url.value;
        } else {
          dropdown.value = ''; // Reset dropdown if custom URL doesn't match any option
        }
      }
    } else {
      testButton.disabled = true;
      if (dropdown) {
        dropdown.value = '';
      }
    }
  } catch {
    testButton.disabled = true;
    if (dropdown) {
      dropdown.value = '';
    }
  }
}

// Save verification toasts preference
async function saveVerificationToasts(event: any) {
  const enabled = event.target.checked;
  chrome.runtime.sendMessage({
    message: 'updateShowVerificationToasts',
    enabled,
  });
  showToast(
    `Verification notifications ${enabled ? 'enabled' : 'disabled'}`,
    'success',
  );
}

async function saveEnsResolution(event: any) {
  const enabled = event.target.checked;
  await chrome.storage.local.set({ ensResolutionEnabled: enabled });
}

async function handleThemeChange(event: any) {
  const theme = event.target.value;
  await chrome.storage.local.set({ theme });
  applyTheme(theme);
  showToast(`Theme changed to ${theme}`, 'success');
}

function applyTheme(theme: string) {
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
      // 'verificationMode', // Removed - no longer used
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

async function handleProcessIdChange(event: any) {
  const processId = event.target.value.trim();

  try {
    if (processId) {
      await chrome.storage.local.set({ processId });
    } else {
      await chrome.storage.local.remove(['processId']);
    }

    // Notify background script
    await chrome.runtime.sendMessage({
      message: 'updateAdvancedSettings',
      settings: { processId },
    });

    showToast('Process ID updated', 'success');
  } catch (error) {
    console.error('Error updating process ID:', error);
    showToast('Failed to update process ID', 'error');
  }
}

async function handleAoCuUrlChange(event: any) {
  const aoCuUrl = event.target.value.trim();

  try {
    if (aoCuUrl) {
      // Validate URL
      new URL(aoCuUrl);
      await chrome.storage.local.set({ aoCuUrl });
    } else {
      await chrome.storage.local.remove(['aoCuUrl']);
    }

    // Notify background script
    await chrome.runtime.sendMessage({
      message: 'updateAdvancedSettings',
      settings: { aoCuUrl },
    });

    showToast('AO CU URL updated', 'success');
  } catch (error: any) {
    console.error('Error updating AO CU URL:', error);
    if (aoCuUrl && error.message.includes('URL')) {
      showToast('Invalid URL format', 'error');
    } else {
      showToast('Failed to update AO CU URL', 'error');
    }
  }
}

// Advanced settings reset functionality removed - settings now save automatically on change

// Clear functions moved to performance.js

// Removed: saveVerificationCacheToggle - verification cache removed

function viewLogs() {
  // Open browser console for now - in future could open dedicated logs page
  showToast('Open browser console (F12) to view extension logs', 'info');
}

async function updateGatewayCounts() {
  try {
    const { localGatewayAddressRegistry = {} } = await chrome.storage.local.get(
      ['localGatewayAddressRegistry'],
    );

    const gateways = Object.values(localGatewayAddressRegistry) as any[];
    const totalCount = gateways.length;
    const activeCount = gateways.filter(
      (gateway) => gateway.status === 'joined',
    ).length;

    const totalElement = document.getElementById(
      'totalGateways',
    ) as HTMLSpanElement;
    if (totalElement) {
      totalElement.textContent = `${totalCount}`;
    }

    const activeElement = document.getElementById(
      'activeGateways',
    ) as HTMLSpanElement;
    if (activeElement) {
      activeElement.textContent = `${activeCount}`;
    }

    // Update registry status based on gateway count
    const statusElement = document.getElementById('registryStatus');
    if (statusElement) {
      const statusDot =
        statusElement.querySelector<HTMLDivElement>('.status-dot');
      const statusText =
        statusElement.querySelector<HTMLSpanElement>('span:last-child');

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
  const button = document.getElementById(
    'syncGatewayRegistry',
  ) as HTMLButtonElement;
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
  .addEventListener('change', async () => {
    const { theme } = await chrome.storage.local.get(['theme']);
    if (theme === 'auto') {
      applyTheme('auto');
    }
  });

// Removed: Trusted Gateway Settings Functions - verification features removed

// Gateway provider settings handlers
async function handleGatewaySortByChange(event: any) {
  const sortBy = event.target.value;
  await chrome.storage.local.set({ gatewaySortBy: sortBy });

  try {
    await chrome.runtime.sendMessage({ message: 'resetWayfinder' });
    showToast('Gateway sorting updated', 'success');
  } catch (error) {
    console.error('Error updating gateway sort by:', error);
    showToast('Failed to update gateway sorting', 'error');
  }
}

async function handleGatewaySortOrderChange(event: any) {
  const sortOrder = event.target.value;
  await chrome.storage.local.set({ gatewaySortOrder: sortOrder });

  try {
    await chrome.runtime.sendMessage({ message: 'resetWayfinder' });
    showToast('Gateway sort order updated', 'success');
  } catch (error) {
    console.error('Error updating gateway sort order:', error);
    showToast('Failed to update gateway sort order', 'error');
  }
}

async function handleGatewayCacheTTLChange(event: any) {
  const ttl = parseInt(event.target.value);
  await chrome.storage.local.set({ gatewayCacheTTL: ttl });

  // Update the display value
  const valueEl = document.getElementById(
    'gatewayCacheTTLValue',
  ) as HTMLSpanElement;
  if (valueEl) {
    valueEl.textContent = `${ttl}`;
  }

  try {
    await chrome.runtime.sendMessage({ message: 'resetWayfinder' });
    showToast(`Gateway cache TTL set to ${ttl} seconds`, 'success');
  } catch (error) {
    console.error('Error updating gateway cache TTL:', error);
    showToast('Failed to update gateway cache TTL', 'error');
  }
}

// Removed: Verified Browsing handlers - verification features removed

// Telemetry handler
async function handleTelemetryToggle(event: any) {
  const enabled = event.target.checked;

  await chrome.storage.local.set({ telemetryEnabled: enabled });

  // Reset wayfinder to apply telemetry changes
  chrome.runtime.sendMessage({ message: 'resetWayfinder' });

  // Update telemetry details visibility
  const details = document.getElementById('telemetryDetails');
  if (details) {
    details.style.display = enabled ? 'block' : 'none';
  }

  showToast(
    enabled
      ? 'Telemetry enabled - Reload extension to apply changes'
      : 'Telemetry disabled - Reload extension to apply changes',
    'info',
  );
}

// Data Management Functions
async function clearAllCache() {
  if (
    !confirm('Clear all cached gateway performance data and usage history?')
  ) {
    return;
  }

  try {
    // Get all storage keys
    const allData = await chrome.storage.local.get();
    const keysToRemove = [];

    // Add specific cache-related keys
    keysToRemove.push(
      'gatewayPerformance',
      'gatewayUsageHistory',
      'dailyStats',
    );

    // Add all DNS cache entries (they start with 'dnsCache_')
    Object.keys(allData).forEach((key) => {
      if (key.startsWith('dnsCache_') || key.startsWith('arns:')) {
        keysToRemove.push(key);
      }
    });

    await chrome.storage.local.remove(keysToRemove);

    showToast('Cache cleared successfully', 'success');
  } catch (error) {
    console.error('Error clearing cache:', error);
    showToast('Failed to clear cache', 'error');
  }
}

async function resetAllData() {
  if (
    !confirm(
      'Reset ALL extension data including settings, gateways, and cache? This cannot be undone.',
    )
  ) {
    return;
  }

  try {
    // Get all keys
    const allData = await chrome.storage.local.get();
    const allKeys = Object.keys(allData);

    // Define protected keys that should never be removed
    const protectedKeys = ['extension_id', 'install_date'];

    // Remove all non-protected keys
    const keysToRemove = allKeys.filter((key) => !protectedKeys.includes(key));

    await chrome.storage.local.remove(keysToRemove);

    showToast('Extension reset to factory defaults', 'success');

    // Reload extension after a delay
    setTimeout(() => {
      chrome.runtime.reload();
    }, 1500);
  } catch (error) {
    console.error('Error resetting extension:', error);
    showToast('Failed to reset extension', 'error');
  }
}
