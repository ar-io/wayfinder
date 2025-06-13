/**
 * WayFinder Gateways
 * Modern gateway management interface
 */

let allGateways = [];
let filteredGateways = [];
let currentFilter = 'all';
let searchQuery = '';

// Toast notification system (same as settings)
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

// Initialize gateways page
document.addEventListener('DOMContentLoaded', async () => {
  setupEventHandlers();
  await loadGateways();
  updateStats();
  await setExtensionVersion();
});

function setupEventHandlers() {
  // Back button
  document.getElementById('backToMain')?.addEventListener('click', () => {
    window.location.href = 'popup.html';
  });

  // Sync button
  document
    .getElementById('syncGateways')
    ?.addEventListener('click', syncGateways);
  document
    .getElementById('syncEmptyState')
    ?.addEventListener('click', syncGateways);

  // Search functionality
  document
    .getElementById('searchGateways')
    ?.addEventListener('input', handleSearch);

  // Filter buttons
  document.querySelectorAll('.filter-btn').forEach((btn) => {
    btn.addEventListener('click', handleFilter);
  });

  // Modal close
  document.getElementById('closeModal')?.addEventListener('click', closeModal);

  // Close modal when clicking outside
  document.getElementById('gatewayModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'gatewayModal') {
      closeModal();
    }
  });
}

async function loadGateways() {
  try {
    showLoadingState();

    const {
      localGatewayAddressRegistry = {},
      gatewayPerformance = {},
      blacklistedGateways = [],
    } = await chrome.storage.local.get([
      'localGatewayAddressRegistry',
      'gatewayPerformance',
      'blacklistedGateways',
    ]);

    if (Object.keys(localGatewayAddressRegistry).length === 0) {
      showEmptyState();
      return;
    }

    // Convert to array format with additional data
    allGateways = Object.entries(localGatewayAddressRegistry).map(
      ([address, gateway]) => ({
        address,
        data: gateway,
        performance: gatewayPerformance[gateway.settings?.fqdn] || {},
        isBlacklisted: blacklistedGateways.includes(address),
      }),
    );

    // Sort by total stake (descending)
    allGateways.sort((a, b) => {
      const stakeA =
        (a.data.operatorStake || 0) + (a.data.totalDelegatedStake || 0);
      const stakeB =
        (b.data.operatorStake || 0) + (b.data.totalDelegatedStake || 0);
      return stakeB - stakeA;
    });

    applyFiltersAndSearch();
    hideLoadingState();
  } catch (error) {
    console.error('Error loading gateways:', error);
    showToast('Failed to load gateways', 'error');
    showEmptyState();
  }
}

function applyFiltersAndSearch() {
  let filtered = [...allGateways];

  // Apply search filter
  if (searchQuery) {
    const query = searchQuery.toLowerCase();
    filtered = filtered.filter(
      (gateway) =>
        gateway.data.settings?.fqdn?.toLowerCase().includes(query) ||
        gateway.address.toLowerCase().includes(query),
    );
  }

  // Apply status filter
  switch (currentFilter) {
    case 'joined':
      filtered = filtered.filter((gateway) => gateway.data.status === 'joined');
      break;
    case 'fast':
      filtered = filtered.filter((gateway) => {
        const avgTime = gateway.performance.avgResponseTime;
        return avgTime !== undefined && avgTime <= 500;
      });
      break;
    case 'blacklisted':
      filtered = filtered.filter((gateway) => gateway.isBlacklisted);
      break;
    case 'all':
    default:
      // No additional filtering
      break;
  }

  filteredGateways = filtered;
  renderGateways();
}

function renderGateways() {
  const container = document.getElementById('gatewaysList');

  if (filteredGateways.length === 0) {
    showEmptyState();
    return;
  }

  container.innerHTML = '';

  filteredGateways.forEach((gateway) => {
    const card = createGatewayCard(gateway);
    container.appendChild(card);
  });
}

function createGatewayCard(gateway) {
  const { address, data, performance, isBlacklisted } = gateway;
  const { settings } = data;
  const totalStake = Math.floor(
    ((data.operatorStake || 0) + (data.totalDelegatedStake || 0)) / 1000000,
  );

  // Determine status
  let statusClass = 'unknown';
  let statusText = 'Unknown';
  let performanceBadge = '';

  if (performance.avgResponseTime !== undefined) {
    const avgTime = performance.avgResponseTime;
    if (performance.failures > 10) {
      statusClass = 'offline';
      statusText = 'Offline';
    } else if (avgTime <= 150) {
      statusClass = 'online';
      statusText = 'Fastest';
      performanceBadge =
        '<div class="performance-badge fastest">🔥 Fastest</div>';
    } else if (avgTime <= 500) {
      statusClass = 'online';
      statusText = 'Fast';
      performanceBadge = '<div class="performance-badge fast">⚡ Fast</div>';
    } else if (avgTime <= 2000) {
      statusClass = 'online';
      statusText = 'Good';
    } else {
      statusClass = 'slow';
      statusText = 'Slow';
      performanceBadge = '<div class="performance-badge slow">🐢 Slow</div>';
    }
  }

  const card = document.createElement('div');
  card.className = `gateway-card ${isBlacklisted ? 'blacklisted' : ''}`;
  card.setAttribute('data-address', address);

  card.innerHTML = `
    <div class="gateway-header">
      <div class="gateway-url">${settings?.fqdn || 'Unknown'}</div>
      <div class="gateway-status">
        <div class="status-indicator ${statusClass}"></div>
        <span class="status-text">${statusText}</span>
      </div>
    </div>
    
    <div class="gateway-info">
      <div class="info-item">
        <div class="info-label">Total Stake</div>
        <div class="info-value stake">${totalStake.toLocaleString()} ARIO</div>
      </div>
      <div class="info-item">
        <div class="info-label">Response Time</div>
        <div class="info-value response-time">
          ${performance.avgResponseTime ? Math.round(performance.avgResponseTime) + 'ms' : 'N/A'}
        </div>
      </div>
    </div>
    
    ${performanceBadge}
  `;

  card.addEventListener('click', () => showGatewayDetails(gateway));

  return card;
}

async function showGatewayDetails(gateway) {
  const modal = document.getElementById('gatewayModal');
  const { address, data, performance, isBlacklisted } = gateway;
  const { settings } = data;

  // Determine status for status badge
  let statusClass = 'unknown';
  let statusText = 'Unknown';

  if (performance.avgResponseTime !== undefined) {
    const avgTime = performance.avgResponseTime;
    if (performance.failures > 10) {
      statusClass = 'offline';
      statusText = 'Offline';
    } else if (avgTime <= 150) {
      statusClass = 'online';
      statusText = 'Fastest';
    } else if (avgTime <= 500) {
      statusClass = 'online';
      statusText = 'Fast';
    } else if (avgTime <= 2000) {
      statusClass = 'online';
      statusText = 'Good';
    } else {
      statusClass = 'slow';
      statusText = 'Slow';
    }
  }

  // Update status badge
  const statusBadge = document.getElementById('modalStatusBadge');
  statusBadge.className = `gateway-status-badge ${statusClass}`;
  statusBadge.querySelector('span').textContent = statusText;

  // Populate URL link
  const urlElement = document.getElementById('modal-gateway-url');
  const urlSpan = urlElement.querySelector('span');
  urlSpan.textContent = `${settings.protocol}://${settings.fqdn}`;
  urlElement.href = `${settings.protocol}://${settings.fqdn}:${settings.port}`;

  // Populate address link
  const addressElement = document.getElementById('modal-gateway-wallet');
  const addressSpan = addressElement.querySelector('span');
  addressSpan.textContent = `${address.slice(0, 6)}...${address.slice(-4)}`;
  addressElement.href = `https://viewblock.io/arweave/address/${address}`;

  // Populate stake value
  const totalStake = Math.floor(
    ((data.operatorStake || 0) + (data.totalDelegatedStake || 0)) / 1000000,
  );
  document.getElementById('modal-total-stake').textContent =
    `${totalStake.toLocaleString()} ARIO`;

  // Populate response time
  const avgResponseTime = performance.avgResponseTime;
  document.getElementById('modal-gateway-avg-response-time').textContent =
    avgResponseTime !== undefined ? `${Math.round(avgResponseTime)}ms` : 'N/A';

  // Populate join date
  document.getElementById('modal-start').textContent = new Date(
    data.startTimestamp,
  ).toLocaleDateString();

  // Populate operator note
  document.getElementById('modal-note').textContent =
    settings.note || 'No note provided';

  // Update more info link
  const moreInfoElement = document.getElementById('modal-gateway-more-info');
  moreInfoElement.href = `${settings.protocol}://gateways.${settings.fqdn}:${settings.port}/#/gateways/${address}`;

  // Update blacklist button
  const blacklistButton = document.getElementById('blacklistButton');
  const blacklistSpan = blacklistButton.querySelector('span');
  blacklistSpan.textContent = isBlacklisted
    ? 'Unblacklist Gateway'
    : 'Blacklist Gateway';
  blacklistButton.onclick = () => toggleBlacklist(address);

  // Setup ping test
  setupPingTest(gateway);

  // Load gateway information
  loadGatewayInfo(gateway);

  modal.style.display = 'block';
}

function closeModal() {
  document.getElementById('gatewayModal').style.display = 'none';
}

async function toggleBlacklist(address) {
  try {
    let { blacklistedGateways = [] } = await chrome.storage.local.get([
      'blacklistedGateways',
    ]);

    if (blacklistedGateways.includes(address)) {
      blacklistedGateways = blacklistedGateways.filter(
        (addr) => addr !== address,
      );
      showToast('Gateway removed from blacklist', 'success');
    } else {
      blacklistedGateways.push(address);
      showToast('Gateway added to blacklist', 'warning');
    }

    await chrome.storage.local.set({ blacklistedGateways });

    // Update local data and re-render
    allGateways.forEach((gateway) => {
      if (gateway.address === address) {
        gateway.isBlacklisted = blacklistedGateways.includes(address);
      }
    });

    applyFiltersAndSearch();
    closeModal();
  } catch (error) {
    console.error('Error toggling blacklist:', error);
    showToast('Failed to update blacklist', 'error');
  }
}

function handleSearch(event) {
  searchQuery = event.target.value.trim();
  applyFiltersAndSearch();
}

function handleFilter(event) {
  // Update active filter button
  document
    .querySelectorAll('.filter-btn')
    .forEach((btn) => btn.classList.remove('active'));
  event.target.classList.add('active');

  currentFilter = event.target.dataset.filter;
  applyFiltersAndSearch();
}

async function syncGateways() {
  const syncBtn = document.getElementById('syncGateways');
  const originalContent = syncBtn.innerHTML;

  try {
    // Update button state
    syncBtn.classList.add('syncing');
    syncBtn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
        <path d="M21 2v6h-6M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8M3 22v-6h6M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <span>Syncing...</span>
    `;

    showLoadingState();

    // Call background script to sync
    await chrome.runtime.sendMessage({ message: 'syncGatewayAddressRegistry' });

    // Reload gateways
    await loadGateways();
    updateStats();

    // Update last sync time
    await chrome.storage.local.set({ lastSyncTime: Date.now() });
    updateLastSyncTime();

    showToast('Gateway registry updated successfully', 'success');
  } catch (error) {
    console.error('Error syncing gateways:', error);
    showToast('Failed to sync gateway registry', 'error');
    showEmptyState();
  } finally {
    // Restore button state
    syncBtn.classList.remove('syncing');
    syncBtn.innerHTML = originalContent;
    hideLoadingState();
  }
}

function updateStats() {
  const totalCount = allGateways.length;
  const activeCount = allGateways.filter(
    (g) => g.data.status === 'joined',
  ).length;

  // Find fastest gateway
  let fastestGateway = '--';
  const fastGateways = allGateways
    .filter((g) => g.performance.avgResponseTime !== undefined)
    .sort(
      (a, b) => a.performance.avgResponseTime - b.performance.avgResponseTime,
    );

  if (fastGateways.length > 0) {
    const fastest = fastGateways[0];
    fastestGateway = `${fastest.data.settings?.fqdn || 'Unknown'} (${Math.round(fastest.performance.avgResponseTime)}ms)`;
  }

  document.getElementById('totalGateways').textContent = totalCount;
  document.getElementById('activeGateways').textContent = activeCount;
  document.getElementById('fastestGateway').textContent = fastestGateway;
}

async function updateLastSyncTime() {
  try {
    const { lastSyncTime } = await chrome.storage.local.get(['lastSyncTime']);
    if (lastSyncTime) {
      document.getElementById('lastSyncTime').textContent = new Date(
        lastSyncTime,
      ).toLocaleString();
    }
  } catch (error) {
    console.error('Error updating last sync time:', error);
  }
}

function showLoadingState() {
  document.getElementById('loadingState').style.display = 'flex';
  document.getElementById('gatewaysList').style.display = 'none';
  document.getElementById('emptyState').style.display = 'none';
}

function hideLoadingState() {
  document.getElementById('loadingState').style.display = 'none';
  document.getElementById('gatewaysList').style.display = 'block';
}

function showEmptyState() {
  document.getElementById('emptyState').style.display = 'flex';
  document.getElementById('gatewaysList').style.display = 'none';
  document.getElementById('loadingState').style.display = 'none';
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

// Initialize last sync time on load
updateLastSyncTime();

// Check if we need to highlight a specific gateway
checkForHighlightGateway();

// Ping test functionality
function setupPingTest(gateway) {
  const pingButton = document.getElementById('pingTestButton');
  const pingResults = document.getElementById('pingResults');
  const pingLoading = document.getElementById('pingLoading');

  // Reset display
  pingResults.style.display = 'none';
  pingLoading.style.display = 'none';
  pingButton.disabled = false;
  pingButton.classList.remove('testing');
  pingButton.querySelector('span').textContent = 'Run Test';

  pingButton.onclick = async () => {
    await runPingTest(gateway);
  };
}

async function runPingTest(gateway) {
  const pingButton = document.getElementById('pingTestButton');
  const pingResults = document.getElementById('pingResults');
  const pingLoading = document.getElementById('pingLoading');
  const { settings } = gateway.data;

  // Update UI state
  pingButton.disabled = true;
  pingButton.classList.add('testing');
  pingButton.querySelector('span').textContent = 'Testing...';
  pingResults.style.display = 'none';
  pingLoading.style.display = 'flex';

  try {
    const gatewayUrl = `${settings.protocol}://${settings.fqdn}:${settings.port}`;

    // Test 1: Basic connectivity and response time
    const startTime = performance.now();
    const response = await fetch(`${gatewayUrl}/info`, {
      signal: AbortSignal.timeout(10000), // 10 second timeout
    });
    const endTime = performance.now();
    const responseTime = endTime - startTime;

    // Update response time
    const responseTimeEl = document.getElementById('pingResponseTime');
    responseTimeEl.textContent = `${Math.round(responseTime)}ms`;
    if (responseTime < 200) {
      responseTimeEl.className = 'ping-result-value good';
    } else if (responseTime < 1000) {
      responseTimeEl.className = 'ping-result-value warning';
    } else {
      responseTimeEl.className = 'ping-result-value bad';
    }

    // Update status code
    const statusCodeEl = document.getElementById('pingStatusCode');
    statusCodeEl.textContent = response.status;
    statusCodeEl.className = response.ok
      ? 'ping-result-value good'
      : 'ping-result-value bad';

    // Test 2: Health check
    let healthStatus = 'Unknown';
    let healthClass = 'ping-result-value';

    if (response.ok) {
      try {
        const info = await response.json();
        if (info.network === 'arweave.N.1' && info.blocks) {
          healthStatus = 'Healthy';
          healthClass = 'ping-result-value good';
        } else {
          healthStatus = 'Partial';
          healthClass = 'ping-result-value warning';
        }
      } catch {
        healthStatus = 'Error';
        healthClass = 'ping-result-value bad';
      }
    } else {
      healthStatus = 'Unhealthy';
      healthClass = 'ping-result-value bad';
    }

    const healthCheckEl = document.getElementById('pingHealthCheck');
    healthCheckEl.textContent = healthStatus;
    healthCheckEl.className = healthClass;
  } catch (_error) {
    // Handle errors
    document.getElementById('pingResponseTime').textContent = 'Timeout';
    document.getElementById('pingResponseTime').className =
      'ping-result-value bad';
    document.getElementById('pingStatusCode').textContent = 'Failed';
    document.getElementById('pingStatusCode').className =
      'ping-result-value bad';
    document.getElementById('pingHealthCheck').textContent = 'Offline';
    document.getElementById('pingHealthCheck').className =
      'ping-result-value bad';
  } finally {
    // Show results
    pingLoading.style.display = 'none';
    pingResults.style.display = 'block';
    pingButton.disabled = false;
    pingButton.classList.remove('testing');
    pingButton.querySelector('span').textContent = 'Run Again';
  }
}

// Gateway information functionality
async function loadGatewayInfo(gateway) {
  const { settings } = gateway.data;
  const _gatewayUrl = `${settings.protocol}://${settings.fqdn}`;

  // Reset values
  document.getElementById('gatewayLocation').textContent = 'Detecting...';
  document.getElementById('gatewayIP').textContent = 'Resolving...';
  document.getElementById('gatewayUptime').textContent = 'Calculating...';

  try {
    // Try to get IP and location info
    // Note: In a real implementation, you might want to use a proper IP geolocation service
    // For now, we'll show the FQDN and estimate location based on domain
    const fqdn = settings.fqdn;

    // Simple IP resolution simulation (in real app, would need backend API)
    document.getElementById('gatewayIP').textContent = fqdn;

    // Location estimation based on common patterns
    let location = 'Global';
    if (fqdn.includes('.us.') || fqdn.includes('-us-')) {
      location = 'United States';
    } else if (fqdn.includes('.eu.') || fqdn.includes('-eu-')) {
      location = 'Europe';
    } else if (fqdn.includes('.asia.') || fqdn.includes('-asia-')) {
      location = 'Asia';
    } else if (fqdn.includes('arweave.net')) {
      location = 'Global (Official)';
    }
    document.getElementById('gatewayLocation').textContent = location;

    // Calculate uptime (time since join)
    const startDate = new Date(gateway.data.startTimestamp);
    const now = new Date();
    const uptimeDays = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));

    let uptimeText;
    if (uptimeDays > 365) {
      const years = Math.floor(uptimeDays / 365);
      uptimeText = `${years} year${years > 1 ? 's' : ''}`;
    } else if (uptimeDays > 30) {
      const months = Math.floor(uptimeDays / 30);
      uptimeText = `${months} month${months > 1 ? 's' : ''}`;
    } else {
      uptimeText = `${uptimeDays} day${uptimeDays !== 1 ? 's' : ''}`;
    }

    document.getElementById('gatewayUptime').textContent = uptimeText;
  } catch (error) {
    console.error('Error loading gateway info:', error);
    document.getElementById('gatewayLocation').textContent = 'Unknown';
    document.getElementById('gatewayIP').textContent = 'Unknown';
    document.getElementById('gatewayUptime').textContent = 'Unknown';
  }
}

// Highlight gateway functionality
async function checkForHighlightGateway() {
  const { highlightGateway } = await chrome.storage.local.get([
    'highlightGateway',
  ]);

  if (highlightGateway) {
    // Clear the flag
    await chrome.storage.local.remove(['highlightGateway']);

    // Wait for gateways to load and then highlight
    setTimeout(() => {
      const gatewayCards = document.querySelectorAll('.gateway-card');
      for (const card of gatewayCards) {
        const gatewayName = card.querySelector('.gateway-name');
        if (gatewayName && gatewayName.textContent.includes(highlightGateway)) {
          card.style.border = '2px solid var(--accent-primary)';
          card.style.background = 'var(--bg-tertiary)';
          card.scrollIntoView({ behavior: 'smooth', block: 'center' });

          // Remove highlight after 3 seconds
          setTimeout(() => {
            card.style.border = '';
            card.style.background = '';
          }, 3000);
          break;
        }
      }
    }, 1000);
  }
}
