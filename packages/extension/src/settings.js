/**
 * WayFinder Settings
 * Modern settings interface for routing and verification configuration
 */

// Import wayfinder-core modules for gateway discovery
import { NetworkGatewaysProvider } from '@ar.io/wayfinder-core';

// Toast notification system
function showToast(message, type = 'success') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <div style="display: flex; align-items: center; gap: 8px;">
      <span>${type === 'success' ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' : type === 'error' ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>'}</span>
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
  console.log('[DEBUG] DOMContentLoaded fired');
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
    
    // Debug: Check if Advanced Settings section exists
    const advancedSection = document.getElementById('advanced');
    const advancedToggle = document.getElementById('advancedToggle');
    const advancedContent = document.getElementById('advancedContent');
    console.log('[DEBUG] Advanced Settings elements check:', {
      advancedSection: !!advancedSection,
      advancedToggle: !!advancedToggle,
      advancedContent: !!advancedContent,
      advancedToggleTagName: advancedToggle?.tagName,
      advancedToggleClasses: advancedToggle?.className
    });
  }, 50);
});

// Handle navigation from popup with hash
function handleHashNavigation() {
  const hash = window.location.hash;
  if (hash) {
    const targetElement = document.querySelector(hash);
    if (targetElement) {
      // If the target is within advanced settings, expand it first
      const advancedContent = document.getElementById('advancedContent');
      const advancedToggle = document.getElementById('advancedToggle');
      if (advancedContent && advancedContent.contains(targetElement)) {
        // Expand advanced settings
        if (advancedToggle) {
          advancedToggle.classList.add('expanded');
        }
        chrome.storage.local.set({ advancedSettingsExpanded: true });
      }
      
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

  // Advanced settings toggle
  const advancedToggle = document.getElementById('advancedToggle');
  if (advancedToggle) {
    console.log('[DEBUG] Attaching click handler to advancedToggle');
    advancedToggle.addEventListener('click', (e) => {
      console.log('[DEBUG] Click event triggered on advancedToggle', e);
      toggleAdvancedSettings();
    });
    
    // Also check if the element is actually clickable
    const computedStyle = window.getComputedStyle(advancedToggle);
    console.log('[DEBUG] advancedToggle computed styles:', {
      display: computedStyle.display,
      visibility: computedStyle.visibility,
      pointerEvents: computedStyle.pointerEvents,
      cursor: computedStyle.cursor,
      zIndex: computedStyle.zIndex
    });
  } else {
    console.error('[ERROR] advancedToggle element not found');
  }

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
    .getElementById('gatewayDropdown')
    ?.addEventListener('change', handleGatewayDropdownChange);

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

  // Advanced settings are now saved automatically on change
  document
    .getElementById('processId')
    ?.addEventListener('change', handleProcessIdChange);
  document
    .getElementById('aoCuUrl')
    ?.addEventListener('change', handleAoCuUrlChange);

  // Performance actions moved to performance.js

  // Cache toggle
  document
    .getElementById('enableVerificationCache')
    ?.addEventListener('change', saveVerificationCacheToggle);

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

  // Trusted gateway settings
  document
    .querySelectorAll('input[name="verificationGatewayMode"]')
    .forEach((radio) => {
      radio.addEventListener('change', handleVerificationGatewayModeChange);
    });

  document
    .getElementById('verificationGatewayCount')
    ?.addEventListener('input', handleGatewayCountChange);

  // Setup trusted gateway settings on load
  setupTrustedGatewaySettings();

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

  // Verified Browsing settings
  document
    .getElementById('verifiedBrowsingToggle')
    ?.addEventListener('change', handleVerifiedBrowsingToggle);

  document
    .querySelectorAll('input[name="verifiedBrowsingStrict"]')
    .forEach((radio) => {
      radio.addEventListener('change', handleVerifiedBrowsingStrictChange);
    });

  document
    .getElementById('manageExceptions')
    ?.addEventListener('click', toggleExceptionsList);

  document
    .getElementById('addException')
    ?.addEventListener('click', addException);

  // Initialize Verified Browsing UI
  setupVerifiedBrowsingUI();
}

function setupExpandableSections() {
  document.querySelectorAll('.expandable .config-header').forEach((header) => {
    header.addEventListener('click', (e) => {
      // Prevent clicks on interactive elements within the header
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') {
        return;
      }
      
      const section = header.closest('.expandable');
      section.classList.toggle('expanded');
    });
  });
}

function toggleAdvancedSettings() {
  console.log('[DEBUG] toggleAdvancedSettings called');
  const advancedSection = document.getElementById('advanced');
  const advancedContent = document.getElementById('advancedContent');
  const advancedToggle = document.getElementById('advancedToggle');
  const expandIcon = advancedToggle?.querySelector('.expand-icon');
  
  console.log('[DEBUG] Elements found:', {
    advancedSection: !!advancedSection,
    advancedContent: !!advancedContent,
    advancedToggle: !!advancedToggle,
    expandIcon: !!expandIcon
  });
  
  if (!advancedContent || !advancedToggle) {
    console.error('[ERROR] Required elements not found');
    return;
  }
  
  // Check if section is currently expanded by checking the toggle's class
  const isExpanded = advancedToggle.classList.contains('expanded');
  
  if (isExpanded) {
    // Collapse
    advancedToggle.classList.remove('expanded');
    // Let CSS handle the animation
  } else {
    // Expand
    advancedToggle.classList.add('expanded');
    // Let CSS handle the animation
  }
  
  // Save preference
  chrome.storage.local.set({ advancedSettingsExpanded: !isExpanded });
}

function setupRoutingStrategyDetails() {
  // Only select strategy options within the routing section
  document
    .querySelectorAll('.routing-strategy-selector .strategy-option')
    .forEach((option) => {
      const radio = option.querySelector('input[type="radio"]');
      const header = option.querySelector('.strategy-header');

      header.addEventListener('click', () => {
        radio.checked = true;
        // Create a synthetic event that will trigger saving
        handleRoutingStrategyChange({ target: radio, isTrusted: true });
      });
    });

  // Setup click handlers for verification strategy options separately
  document
    .querySelectorAll('.verification-strategy-selector .strategy-option')
    .forEach((option) => {
      const radio = option.querySelector('input[type="radio"]');
      const header = option.querySelector('.strategy-header');

      header.addEventListener('click', () => {
        radio.checked = true;
        // Create a synthetic event that will trigger saving
        handleVerificationStrategyChange({ target: radio, isTrusted: true });
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
      'verifiedBrowsing',
      'verifiedBrowsingExceptions',
      'showVerificationIndicators',
      'showVerificationToasts',
      'ensResolutionEnabled',
      'theme',
      'processId',
      'aoCuUrl',
      'enableVerificationCache',
      'gatewaySortBy',
      'gatewaySortOrder',
      'gatewayCacheTTL',
      'advancedSettingsExpanded',
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

    // Load routing strategy
    const routingMethod = settings.routingMethod || 'fastestPing';

    // Ensure a valid radio button is selected
    const routingRadio = document.querySelector(
      `input[name="routingStrategy"][value="${routingMethod}"]`,
    );
    if (routingRadio) {
      routingRadio.checked = true;
      // Update UI without triggering change event
      handleRoutingStrategyChange({ target: routingRadio, isTrusted: false });
    } else {
      // Fallback to fastestPing if the saved method is invalid
      const fallbackRadio = document.querySelector(
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

    // Load verification settings
    const verificationStrategy = settings.verificationStrategy || 'hash';
    const verificationStrategyRadio = document.querySelector(
      `input[name="verificationStrategy"][value="${verificationStrategy}"]`,
    );
    if (verificationStrategyRadio) {
      verificationStrategyRadio.checked = true;
      // No need to trigger change event during initialization
    }

    // Verification mode is now controlled by Verified Browsing toggle
    // verificationEnabled is synced with verifiedBrowsing
    // verificationStrict is controlled by the strictness selector in Verified Browsing section

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

    // Load Verified Browsing settings
    const verifiedBrowsing = settings.verifiedBrowsing || false;
    const verifiedBrowsingToggle = document.getElementById(
      'verifiedBrowsingToggle',
    );
    if (verifiedBrowsingToggle) {
      verifiedBrowsingToggle.checked = verifiedBrowsing;
      updateVerifiedBrowsingUI(verifiedBrowsing);
    }
    
    // Restore advanced settings expanded state
    if (settings.advancedSettingsExpanded) {
      const advancedToggle = document.getElementById('advancedToggle');
      if (advancedToggle) {
        advancedToggle.classList.add('expanded');
      }
    }
    
    // Load strictness setting
    const strict = settings.verificationStrict || false;
    const strictnessRadio = document.querySelector(
      `input[name="verifiedBrowsingStrict"][value="${strict}"]`
    );
    if (strictnessRadio) {
      strictnessRadio.checked = true;
      updateStrictnessDescription(strict);
    }

    // Load exceptions
    const verifiedBrowsingExceptions =
      settings.verifiedBrowsingExceptions || [];
    loadExceptions(verifiedBrowsingExceptions);

    // Load cache settings
    const cacheEnabled = settings.enableVerificationCache !== false; // Default true
    const cacheEnabledEl = document.getElementById('enableVerificationCache');
    if (cacheEnabledEl) {
      cacheEnabledEl.checked = cacheEnabled;
    }

    // Load gateway provider settings
    const gatewaySortBy = settings.gatewaySortBy || 'operatorStake';
    const gatewaySortByEl = document.getElementById('gatewaySortBy');
    if (gatewaySortByEl) {
      gatewaySortByEl.value = gatewaySortBy;
    }

    const gatewaySortOrder = settings.gatewaySortOrder || 'desc';
    const gatewaySortOrderEl = document.getElementById('gatewaySortOrder');
    if (gatewaySortOrderEl) {
      gatewaySortOrderEl.value = gatewaySortOrder;
    }

    const gatewayCacheTTL = settings.gatewayCacheTTL || 3600;
    const gatewayCacheTTLEl = document.getElementById('gatewayCacheTTL');
    if (gatewayCacheTTLEl) {
      gatewayCacheTTLEl.value = gatewayCacheTTL;
    }
    const gatewayCacheTTLValueEl = document.getElementById(
      'gatewayCacheTTLValue',
    );
    if (gatewayCacheTTLValueEl) {
      gatewayCacheTTLValueEl.textContent = gatewayCacheTTL;
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
    // Try to get a gateway from local registry first
    const { localGatewayAddressRegistry = {} } = await chrome.storage.local.get(
      ['localGatewayAddressRegistry'],
    );
    const gateways = Object.values(localGatewayAddressRegistry)
      .filter((g) => g.status === 'joined' && g.settings?.fqdn)
      .sort((a, b) => (b.operatorStake || 0) - (a.operatorStake || 0));

    if (gateways.length > 0) {
      // Use the top gateway from registry
      const gateway = gateways[0];
      const url = `${gateway.settings.protocol || 'https'}://${gateway.settings.fqdn}/info`;
      const response = await fetch(url, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } else {
      // Fallback to arweave.net as last resort
      const response = await fetch('https://arweave.net/info', {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    }
  } catch {
    return false;
  }
}

// Performance functions moved to performance.js

async function handleRoutingStrategyChange(event) {
  const strategy = event.target.value;
  console.log(
    `[SETTINGS] Routing strategy changed to: ${strategy}, isTrusted: ${event.isTrusted}`,
  );

  // Show/hide static gateway configuration
  const staticConfig = document.querySelector('.static-gateway-config');
  if (staticConfig) {
    if (strategy === 'static') {
      staticConfig.style.display = 'block';
      // Populate the gateway dropdown when static is selected
      await populateGatewayDropdown();
    } else {
      staticConfig.style.display = 'none';
    }
  }

  // Only save if this is a real user change (not initialization)
  if (event.isTrusted) {
    console.log(`[SETTINGS] Saving routing strategy: ${strategy}`);

    // Save the routing strategy
    await chrome.storage.local.set({ routingMethod: strategy });

    // Send message to background script to update routing
    try {
      console.log(`[SETTINGS] Sending routing strategy update: ${strategy}`);
      const response = await chrome.runtime.sendMessage({
        message: 'updateRoutingStrategy',
        strategy,
      });

      console.log('[SETTINGS] Response from background:', response);

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
            random: 'Random',
            roundRobin: 'Round Robin',
            static: 'Static Gateway',
          };
          currentValueEl.textContent = strategyNames[strategy] || strategy;
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
      showToast('Gateway is reachable and configured!', 'success');

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
        `Gateway responded with status ${response.status}. Please verify this is a valid Arweave gateway.`,
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

// Get available gateways from existing synced registry
async function fetchAvailableGateways() {
  try {
    const { localGatewayAddressRegistry = {} } = await chrome.storage.local.get(
      ['localGatewayAddressRegistry'],
    );

    // Convert to array format with stake information
    const gateways = Object.entries(localGatewayAddressRegistry)
      .map(([address, gateway]) => ({
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
      const networkProvider = new NetworkGatewaysProvider();
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
  const dropdown = document.getElementById('gatewayDropdown');
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
    gateways.forEach((gateway) => {
      const option = document.createElement('option');
      const url = `${gateway.protocol}://${gateway.fqdn}${gateway.port && gateway.port !== (gateway.protocol === 'https' ? 443 : 80) ? `:${gateway.port}` : ''}`;
      option.value = url;

      // Format stake for display (convert from millio units to readable format)
      const totalStake = gateway.operatorStake + gateway.totalDelegatedStake;
      const stakeDisplay =
        totalStake > 0 ? formatStake(totalStake) : 'No stake';

      // Display format: "gateway.com • 1.2M IO"
      option.textContent = `${gateway.fqdn} • ${stakeDisplay}`;
      dropdown.appendChild(option);
    });

    // Set a random gateway as the default placeholder
    if (gateways.length > 0) {
      const randomIndex = Math.floor(
        Math.random() * Math.min(5, gateways.length),
      ); // Pick from top 5
      const customInput = document.getElementById('staticGatewayUrl');
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
function formatStake(stake) {
  if (stake >= 1000000) {
    return (stake / 1000000).toFixed(1) + 'M IO';
  } else if (stake >= 1000) {
    return (stake / 1000).toFixed(1) + 'K IO';
  } else {
    return stake.toFixed(0) + ' IO';
  }
}

// Handle gateway dropdown selection
function handleGatewayDropdownChange(event) {
  const selectedGateway = event.target.value;
  const customInput = document.getElementById('staticGatewayUrl');

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
  const url = document.getElementById('staticGatewayUrl').value;
  const testButton = document.getElementById('testStaticGateway');
  const dropdown = document.getElementById('gatewayDropdown');

  try {
    if (url) {
      new URL(url);
      testButton.disabled = false;

      // Update dropdown to show selected value if it matches
      if (dropdown) {
        const matchingOption = Array.from(dropdown.options).find(
          (option) => option.value === url,
        );
        if (matchingOption) {
          dropdown.value = url;
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

async function handleVerificationStrategyChange(event) {
  const strategy = event.target.value;
  await chrome.storage.local.set({ verificationStrategy: strategy });

  try {
    await chrome.runtime.sendMessage({ message: 'resetWayfinder' });

    // Only show toast for user-initiated changes
    if (event.isTrusted) {
      // Show success feedback
      const strategyNames = {
        hash: 'Hash (SHA-256)',
        dataRoot: 'Data Root',
      };
      showToast(
        `Verification strategy changed to ${strategyNames[strategy] || strategy}`,
        'success',
      );
    }
  } catch (error) {
    console.error('Error updating verification strategy:', error);
    if (event.isTrusted) {
      showToast('Failed to update verification strategy', 'error');
    }
  }
}

async function handleVerificationModeChange(event) {
  if (!event.isTrusted) return; // Skip programmatic changes

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

  // Show success feedback
  const modeNames = {
    off: 'Off',
    background: 'Background (Non-blocking)',
    strict: 'Strict (Blocking)',
  };
  showToast(`Verification mode changed to ${modeNames[mode]}`, 'success');

  // Update current value display
  const currentValueEl = document.getElementById('currentVerificationMode');
  if (currentValueEl) {
    currentValueEl.textContent = modeNames[mode].split(' ')[0]; // Just show "Off", "Background", or "Strict"
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

async function handleProcessIdChange(event) {
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

async function handleAoCuUrlChange(event) {
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
  } catch (error) {
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

async function saveVerificationCacheToggle(event) {
  const enabled = event.target.checked;

  try {
    await chrome.storage.local.set({ enableVerificationCache: enabled });
    showToast(
      enabled ? 'Verification cache enabled' : 'Verification cache disabled',
      'success',
    );

    // If disabling, optionally clear the cache
    if (!enabled) {
      const shouldClear = confirm(
        'Would you like to clear the existing cache data?',
      );
      if (shouldClear) {
        // Send message to background script to clear cache
        try {
          const response = await chrome.runtime.sendMessage({
            message: 'clearVerificationCache',
          });
          if (response && response.success) {
            showToast('Verification cache cleared', 'success');
          }
        } catch (error) {
          console.error('Error clearing verification cache:', error);
          showToast('Failed to clear verification cache', 'error');
        }
      }
    }
  } catch (error) {
    console.error('Error saving cache toggle:', error);
    showToast('Failed to update cache setting', 'error');
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

// Trusted Gateway Settings Functions
async function setupTrustedGatewaySettings() {
  // Load current settings
  const {
    verificationGatewayMode = 'automatic',
    verificationGatewayCount = 3,
    verificationTrustedGateways = [],
  } = await chrome.storage.local.get([
    'verificationGatewayMode',
    'verificationGatewayCount',
    'verificationTrustedGateways',
  ]);

  // Set mode
  const modeRadio = document.querySelector(
    `input[name="verificationGatewayMode"][value="${verificationGatewayMode}"]`,
  );
  if (modeRadio) {
    modeRadio.checked = true;
  }

  // Set gateway count
  const countSlider = document.getElementById('verificationGatewayCount');
  const countValue = document.getElementById('gatewayCountValue');
  if (countSlider && countValue) {
    countSlider.value = verificationGatewayCount;
    countValue.textContent = verificationGatewayCount;
  }

  // Update UI based on mode
  updateGatewayModeUI(verificationGatewayMode);

  // Populate gateway list for manual selection
  await populateGatewaySelectionList(verificationTrustedGateways);

  // Update preview
  await updateTrustedGatewaysPreview();
}

async function handleVerificationGatewayModeChange(event) {
  const mode = event.target.value;

  await chrome.storage.local.set({ verificationGatewayMode: mode });

  updateGatewayModeUI(mode);
  await updateTrustedGatewaysPreview();

  // Reset wayfinder to apply changes
  await chrome.runtime.sendMessage({ message: 'resetWayfinder' });

  showToast(`Verification gateway mode changed to ${mode}`, 'success');
}

function updateGatewayModeUI(mode) {
  const automaticSettings = document.getElementById('automaticGatewaySettings');
  const manualSettings = document.getElementById('manualGatewaySettings');

  if (mode === 'automatic') {
    automaticSettings.style.display = 'block';
    manualSettings.style.display = 'none';
  } else {
    automaticSettings.style.display = 'none';
    manualSettings.style.display = 'block';
  }

  // Update active state on mode options
  document
    .querySelectorAll('.gateway-mode-selector .mode-option')
    .forEach((option) => {
      if (option.dataset.mode === mode) {
        option.classList.add('active');
      } else {
        option.classList.remove('active');
      }
    });
}

async function handleGatewayCountChange(event) {
  const count = parseInt(event.target.value);
  document.getElementById('gatewayCountValue').textContent = count;

  await chrome.storage.local.set({ verificationGatewayCount: count });
  await updateTrustedGatewaysPreview();

  // Reset wayfinder to apply changes
  await chrome.runtime.sendMessage({ message: 'resetWayfinder' });
}

async function populateGatewaySelectionList(selectedGateways) {
  const listEl = document.getElementById('gatewaySelectionList');
  if (!listEl) return;

  // Get gateways from registry
  const { localGatewayAddressRegistry = {} } = await chrome.storage.local.get([
    'localGatewayAddressRegistry',
  ]);

  const gateways = Object.entries(localGatewayAddressRegistry)
    .map(([address, gateway]) => ({
      address,
      fqdn: gateway.settings?.fqdn,
      protocol: gateway.settings?.protocol || 'https',
      port: gateway.settings?.port,
      operatorStake: gateway.operatorStake || 0,
      totalDelegatedStake: gateway.totalDelegatedStake || 0,
      status: gateway.status,
    }))
    .filter((gateway) => gateway.status === 'joined' && gateway.fqdn)
    .sort((a, b) => {
      const stakeA = a.operatorStake + a.totalDelegatedStake;
      const stakeB = b.operatorStake + b.totalDelegatedStake;
      return stakeB - stakeA;
    })
    .slice(0, 50); // Show top 50

  listEl.innerHTML = '';

  gateways.forEach((gateway) => {
    const port =
      gateway.port && gateway.port !== (gateway.protocol === 'https' ? 443 : 80)
        ? `:${gateway.port}`
        : '';
    const url = `${gateway.protocol}://${gateway.fqdn}${port}`;
    const totalStake = gateway.operatorStake + gateway.totalDelegatedStake;

    const checkboxDiv = document.createElement('div');
    checkboxDiv.className = 'gateway-checkbox';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = `gateway-${gateway.address}`;
    checkbox.value = url;
    checkbox.checked = selectedGateways.includes(url);
    checkbox.addEventListener('change', handleGatewaySelectionChange);

    const label = document.createElement('label');
    label.htmlFor = `gateway-${gateway.address}`;
    label.innerHTML = `
      <span class="gateway-name">${gateway.fqdn}</span>
      <span class="gateway-stake">${formatStake(totalStake)}</span>
    `;

    checkboxDiv.appendChild(checkbox);
    checkboxDiv.appendChild(label);
    listEl.appendChild(checkboxDiv);
  });
}

async function handleGatewaySelectionChange() {
  const checkboxes = document.querySelectorAll(
    '#gatewaySelectionList input[type="checkbox"]:checked',
  );
  const selectedGateways = Array.from(checkboxes).map((cb) => cb.value);

  await chrome.storage.local.set({
    verificationTrustedGateways: selectedGateways,
  });
  await updateTrustedGatewaysPreview();

  // Reset wayfinder to apply changes
  await chrome.runtime.sendMessage({ message: 'resetWayfinder' });
}

async function updateTrustedGatewaysPreview() {
  const previewEl = document.getElementById('trustedGatewaysList');
  if (!previewEl) return;

  const {
    verificationGatewayMode = 'automatic',
    verificationGatewayCount = 3,
    verificationTrustedGateways = [],
    localGatewayAddressRegistry = {},
  } = await chrome.storage.local.get([
    'verificationGatewayMode',
    'verificationGatewayCount',
    'verificationTrustedGateways',
    'localGatewayAddressRegistry',
  ]);

  let trustedGateways = [];

  if (verificationGatewayMode === 'automatic') {
    // Get top N gateways by stake
    trustedGateways = Object.entries(localGatewayAddressRegistry)
      .map(([_address, gateway]) => ({
        fqdn: gateway.settings?.fqdn,
        protocol: gateway.settings?.protocol || 'https',
        port: gateway.settings?.port,
        operatorStake: gateway.operatorStake || 0,
        totalDelegatedStake: gateway.totalDelegatedStake || 0,
        status: gateway.status,
      }))
      .filter((gateway) => gateway.status === 'joined' && gateway.fqdn)
      .sort((a, b) => {
        const stakeA = a.operatorStake + a.totalDelegatedStake;
        const stakeB = b.operatorStake + b.totalDelegatedStake;
        return stakeB - stakeA;
      })
      .slice(0, verificationGatewayCount);
  } else {
    // Use manually selected gateways
    trustedGateways = verificationTrustedGateways
      .map((url) => {
        try {
          const urlObj = new URL(url);
          // Find the gateway info from registry
          const gatewayInfo = Object.values(localGatewayAddressRegistry).find(
            (g) => g.settings?.fqdn === urlObj.hostname,
          );
          return {
            fqdn: urlObj.hostname,
            operatorStake: gatewayInfo?.operatorStake || 0,
            totalDelegatedStake: gatewayInfo?.totalDelegatedStake || 0,
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }

  // Update preview
  previewEl.innerHTML = '';

  if (trustedGateways.length === 0) {
    previewEl.innerHTML =
      '<div class="gateway-preview-item"><span class="gateway-name">No gateways selected</span></div>';
    return;
  }

  trustedGateways.forEach((gateway) => {
    const totalStake = gateway.operatorStake + gateway.totalDelegatedStake;
    const item = document.createElement('div');
    item.className = 'gateway-preview-item';
    item.innerHTML = `
      <span class="gateway-name">${gateway.fqdn}</span>
      <span class="gateway-stake">${formatStake(totalStake)}</span>
    `;
    previewEl.appendChild(item);
  });
}

// Gateway provider settings handlers
async function handleGatewaySortByChange(event) {
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

async function handleGatewaySortOrderChange(event) {
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

async function handleGatewayCacheTTLChange(event) {
  const ttl = parseInt(event.target.value);
  await chrome.storage.local.set({ gatewayCacheTTL: ttl });

  // Update the display value
  const valueEl = document.getElementById('gatewayCacheTTLValue');
  if (valueEl) {
    valueEl.textContent = ttl;
  }

  try {
    await chrome.runtime.sendMessage({ message: 'resetWayfinder' });
    showToast(`Gateway cache TTL set to ${ttl} seconds`, 'success');
  } catch (error) {
    console.error('Error updating gateway cache TTL:', error);
    showToast('Failed to update gateway cache TTL', 'error');
  }
}

// Verified Browsing handlers
function setupVerifiedBrowsingUI() {
  // Set up strictness selector UI
  document
    .querySelectorAll('.strictness-selector .mode-option')
    .forEach((option) => {
      option.addEventListener('click', (e) => {
        if (e.target.tagName !== 'INPUT') {
          const radio = option.querySelector('input[type="radio"]');
          radio.checked = true;
          radio.dispatchEvent(new Event('change'));
        }
      });
    });
}

async function handleVerifiedBrowsingToggle(event) {
  const enabled = event.target.checked;
  
  // Sync both settings
  await chrome.storage.local.set({ 
    verifiedBrowsing: enabled,
    verificationEnabled: enabled 
  });
  
  // Reset wayfinder to apply new verification setting
  try {
    await chrome.runtime.sendMessage({ message: 'resetWayfinder' });
  } catch (error) {
    console.error('Error resetting wayfinder:', error);
  }
  
  updateVerifiedBrowsingUI(enabled);

  showToast(
    enabled ? 'Verified Browsing enabled - all content will be cryptographically verified' : 'Verified Browsing disabled',
    'success',
  );
}

function updateVerifiedBrowsingUI(enabled) {
  const details = document.getElementById('verifiedBrowsingDetails');
  const options = document.getElementById('verifiedBrowsingOptions');
  const exceptions = document.getElementById('verifiedBrowsingExceptions');

  if (details) details.style.display = enabled ? 'block' : 'none';
  if (options) options.style.display = enabled ? 'block' : 'none';
  if (exceptions) exceptions.style.display = enabled ? 'block' : 'none';
  
  // The verification section is now always within advanced settings,
  // so we don't need to hide/show it based on verified browsing toggle
}

async function handleVerifiedBrowsingStrictChange(event) {
  const strict = event.target.value === 'true';
  await chrome.storage.local.set({ verificationStrict: strict });
  updateStrictnessDescription(strict);

  showToast(
    strict
      ? 'Strict mode enabled - unverified resources will be blocked'
      : 'Warn mode enabled - unverified resources will show warnings',
    'success',
  );
}

function updateStrictnessDescription(strict) {
  const desc = document.getElementById('strictnessDesc');
  if (desc) {
    desc.textContent = strict
      ? 'Blocks unverified resources from loading (most secure)'
      : 'Shows warnings for unverified resources but allows them to load';
  }
}

function toggleExceptionsList() {
  const list = document.getElementById('exceptionsList');
  if (list) {
    list.style.display = list.style.display === 'none' ? 'block' : 'none';
  }
}

async function addException() {
  const input = document.getElementById('newException');
  if (!input || !input.value.trim()) return;

  const exception = input.value.trim();

  // Validate format
  if (!exception.startsWith('ar://') && !exception.includes('.')) {
    showToast('Invalid format. Use ar://app-name or domain.com', 'error');
    return;
  }

  // Get current exceptions
  const { verifiedBrowsingExceptions = [] } = await chrome.storage.local.get([
    'verifiedBrowsingExceptions',
  ]);

  // Check if already exists
  if (verifiedBrowsingExceptions.includes(exception)) {
    showToast('Exception already exists', 'warning');
    return;
  }

  // Add new exception
  verifiedBrowsingExceptions.push(exception);
  await chrome.storage.local.set({ verifiedBrowsingExceptions });

  // Update UI
  loadExceptions(verifiedBrowsingExceptions);
  input.value = '';

  showToast('Exception added', 'success');
}

function loadExceptions(exceptions) {
  const container = document.getElementById('exceptionsItems');
  if (!container) return;

  container.innerHTML = '';

  if (exceptions.length === 0) {
    container.innerHTML =
      '<p class="no-exceptions">No exceptions configured</p>';
    return;
  }

  exceptions.forEach((exception, index) => {
    const item = document.createElement('div');
    item.className = 'exception-item';
    item.innerHTML = `
      <span class="exception-value">${exception}</span>
      <button class="remove-exception" data-index="${index}">✕</button>
    `;

    item.querySelector('.remove-exception').addEventListener('click', () => {
      removeException(index);
    });

    container.appendChild(item);
  });
}

async function removeException(index) {
  const { verifiedBrowsingExceptions = [] } = await chrome.storage.local.get([
    'verifiedBrowsingExceptions',
  ]);

  verifiedBrowsingExceptions.splice(index, 1);
  await chrome.storage.local.set({ verifiedBrowsingExceptions });

  loadExceptions(verifiedBrowsingExceptions);
  showToast('Exception removed', 'success');
}
