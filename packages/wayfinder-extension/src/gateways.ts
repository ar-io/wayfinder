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

import { getRelativeTime } from './utils/time';
import { setExtensionVersion } from './utils/version';

let allGateways: any[] = [];
let filteredGateways: any[] = [];
let currentFilter = 'all';
let searchQuery = '';

// Toast notification system (same as settings)
function showToast(message: string, type = 'success') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <div style="display: flex; align-items: center; gap: 8px;">
      <span>${type === 'success' ? '✓' : type === 'error' ? '✗' : '⚠'}</span>
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
  document
    .getElementById('gatewayModal')
    ?.addEventListener('click', (e: any) => {
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
      ([address, gateway]: [string, any]) => ({
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

  if (!container) {
    return;
  }

  if (allGateways.length === 0) {
    // No gateways at all - show sync message
    showEmptyState();
    return;
  }

  if (filteredGateways.length === 0) {
    // Have gateways but no matches - show different message
    container.innerHTML = `
      <div class="no-results-state">
        <svg class="empty-icon" width="48" height="48" viewBox="0 0 36 36" fill="none" stroke="var(--colors-icons-iconMid)" stroke-width="2" opacity="0.5">
          <circle cx="18" cy="18" r="8.25" stroke-dasharray="2 2"/>
          <path d="M21.75 21.75L27.75 27.75" stroke-linecap="round"/>
        </svg>
        <h3>No gateways match current filters</h3>
        <p>Try selecting "All" or adjusting your search criteria</p>
      </div>
    `;
    container.style.display = 'grid';

    const emptyState = document.getElementById('emptyState');
    const loadingState = document.getElementById('loadingState');

    if (emptyState) {
      emptyState.style.display = 'none';
    }

    if (loadingState) {
      loadingState.style.display = 'none';
    }
    return;
  }

  // Show the gateway list
  container.style.display = 'grid';
  const emptyState = document.getElementById('emptyState');
  const loadingState = document.getElementById('loadingState');

  if (emptyState) {
    emptyState.style.display = 'none';
  }

  if (loadingState) {
    loadingState.style.display = 'none';
  }
  container.innerHTML = '';

  filteredGateways.forEach((gateway) => {
    const card = createGatewayCard(gateway);
    container.appendChild(card);
  });
}

function createGatewayCard(gateway: any) {
  const { address, data, performance, isBlacklisted } = gateway;
  const { settings, stats } = data;
  const totalStake = Math.floor(
    ((data.operatorStake || 0) + (data.totalDelegatedStake || 0)) / 1000000,
  );

  // Calculate current streak
  let streakBadge = '';
  if (stats) {
    if (stats.failedConsecutiveEpochs > 0) {
      // Show failure streak
      streakBadge = `<div class="streak-badge failure">
        <span>↓ ${stats.failedConsecutiveEpochs}</span>
      </div>`;
    } else if (stats.passedConsecutiveEpochs > 0) {
      // Show success streak
      streakBadge = `<div class="streak-badge success">
        <span>↑ ${stats.passedConsecutiveEpochs}</span>
      </div>`;
    }
  }

  // Determine status
  let statusBadge = '';

  if (performance.avgResponseTime !== undefined) {
    const avgTime = performance.avgResponseTime;
    if (performance.failures > 10) {
      statusBadge =
        '<div class="performance-badge offline"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display: inline-block; vertical-align: middle; margin-right: 4px;"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg> Offline</div>';
    } else if (avgTime <= 150) {
      statusBadge =
        '<div class="performance-badge fastest"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display: inline-block; vertical-align: middle; margin-right: 4px;"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg> Fastest</div>';
    } else if (avgTime <= 500) {
      statusBadge =
        '<div class="performance-badge fast"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display: inline-block; vertical-align: middle; margin-right: 4px;"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> Fast</div>';
    } else if (avgTime <= 2000) {
      statusBadge =
        '<div class="performance-badge good"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display: inline-block; vertical-align: middle; margin-right: 4px;"><polyline points="20 6 9 17 4 12"/></svg> Good</div>';
    } else {
      statusBadge =
        '<div class="performance-badge slow"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display: inline-block; vertical-align: middle; margin-right: 4px;"><path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/></svg> Slow</div>';
    }
  } else {
    statusBadge =
      '<div class="performance-badge unknown"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display: inline-block; vertical-align: middle; margin-right: 4px;"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> Unknown</div>';
  }

  const card = document.createElement('div');
  card.className = `gateway-card ${isBlacklisted ? 'blacklisted' : ''}`;
  card.setAttribute('data-address', address);

  card.innerHTML = `
    <div class="gateway-header">
      <div class="gateway-url">${settings?.fqdn || 'Unknown'}</div>
      <div class="gateway-badges">
        ${statusBadge}
        ${streakBadge}
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
  `;

  card.addEventListener('click', () => showGatewayDetails(gateway));

  return card;
}

async function showGatewayDetails(gateway: any) {
  const modal = document.getElementById('gatewayModal');

  if (!modal) {
    return;
  }

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
  const statusBadge = document.getElementById(
    'modalStatusBadge',
  ) as HTMLDivElement;
  statusBadge.className = `gateway-status-badge ${statusClass}`;
  statusBadge.querySelector('span')!.textContent = statusText;

  // Populate URL link
  const urlElement = document.getElementById(
    'modal-gateway-url',
  ) as HTMLAnchorElement;
  const urlSpan = urlElement.querySelector<HTMLSpanElement>('span');
  urlSpan!.textContent = `${settings.protocol}://${settings.fqdn}`;
  urlElement.href = `${settings.protocol}://${settings.fqdn}:${settings.port}`;

  // Populate address link
  const addressElement = document.getElementById(
    'modal-gateway-wallet',
  ) as HTMLAnchorElement;
  const addressSpan = addressElement.querySelector<HTMLSpanElement>('span');
  addressSpan!.textContent = `${address.slice(0, 6)}...${address.slice(-4)}`;
  addressElement.href = `https://viewblock.io/arweave/address/${address}`;

  // Populate stake value
  const totalStake = Math.floor(
    ((data.operatorStake || 0) + (data.totalDelegatedStake || 0)) / 1000000,
  );

  const totalStakeElement = document.getElementById(
    'modal-total-stake',
  ) as HTMLSpanElement;
  totalStakeElement.textContent = `${totalStake.toLocaleString()} ARIO`;

  // Populate response time
  const avgResponseTime = performance.avgResponseTime;
  const avgResponseTimeElement = document.getElementById(
    'modal-gateway-avg-response-time',
  ) as HTMLSpanElement;
  avgResponseTimeElement.textContent =
    avgResponseTime !== undefined ? `${Math.round(avgResponseTime)}ms` : 'N/A';

  // Populate join date
  const startElement = document.getElementById(
    'modal-start',
  ) as HTMLSpanElement;
  startElement.textContent = new Date(data.startTimestamp).toLocaleDateString();

  // Populate operator note
  const noteElement = document.getElementById('modal-note') as HTMLSpanElement;
  noteElement.textContent = settings.note || 'No note provided';

  // Update more info link
  const moreInfoElement = document.getElementById(
    'modal-gateway-more-info',
  ) as HTMLAnchorElement;
  moreInfoElement.href = `${settings.protocol}://gateways.${settings.fqdn}:${settings.port}/#/gateways/${address}`;

  // Update blacklist button
  const blacklistButton = document.getElementById(
    'blacklistButton',
  ) as HTMLButtonElement;
  const blacklistSpan = blacklistButton.querySelector<HTMLSpanElement>('span');
  blacklistSpan!.textContent = isBlacklisted
    ? 'Unblacklist Gateway'
    : 'Blacklist Gateway';
  blacklistButton.addEventListener('click', () => toggleBlacklist(address));

  // Get usage history for this gateway
  const { gatewayUsageHistory = {} } = await chrome.storage.local.get([
    'gatewayUsageHistory',
  ]);
  const usageData = gatewayUsageHistory[settings.fqdn] || {};

  // Update usage metrics
  const usageCountElement = document.getElementById(
    'modal-usage-count',
  ) as HTMLSpanElement;
  usageCountElement.textContent = usageData.requestCount
    ? usageData.requestCount.toString()
    : '0';

  const lastUsedElement = document.getElementById(
    'modal-last-used',
  ) as HTMLSpanElement;
  lastUsedElement.textContent = usageData.lastUsed
    ? getRelativeTime(new Date(usageData.lastUsed))
    : 'Never';

  // Calculate request success rate from performance data
  const requestSuccessRate =
    performance.successCount + performance.failures > 0
      ? Math.round(
          (performance.successCount /
            (performance.successCount + performance.failures)) *
            100,
        )
      : 0;
  const requestSuccessRateElement = document.getElementById(
    'modal-request-success-rate',
  ) as HTMLSpanElement;
  requestSuccessRateElement.textContent = `${requestSuccessRate}%`;

  const failedRequestsElement = document.getElementById(
    'modal-failed-requests',
  ) as HTMLSpanElement;
  failedRequestsElement.textContent = performance.failures
    ? performance.failures.toString()
    : '0';

  // Update network performance stats
  if (data.stats) {
    const stats = data.stats;

    // Display reliability streak
    const streakElement = document.getElementById('modal-current-streak');

    if (!streakElement) {
      return;
    }

    const streakSpan = streakElement.querySelector<HTMLSpanElement>('span');

    if (!streakSpan) {
      return;
    }
    if (stats.failedConsecutiveEpochs > 0) {
      // Show failure streak
      streakSpan.innerHTML = `↓ ${stats.failedConsecutiveEpochs}`;
      streakSpan.style.color = '#ef4444'; // red
    } else if (stats.passedConsecutiveEpochs > 0) {
      // Show success streak
      streakSpan.innerHTML = `↑ ${stats.passedConsecutiveEpochs}`;
      streakSpan.style.color = '#10b981'; // green
    } else {
      streakSpan.textContent = 'No streak';
      streakSpan.style.color = '#6b7280'; // gray
    }

    // Success rate
    const successRate =
      stats.totalEpochCount > 0
        ? Math.round((stats.passedEpochCount / stats.totalEpochCount) * 100)
        : 0;
    const successRateElement = document.getElementById(
      'modal-epoch-success-rate',
    ) as HTMLSpanElement;
    successRateElement.textContent = `${successRate}%`;

    // Total epochs (passed/total)
    const totalEpochsElement = document.getElementById(
      'modal-total-epochs',
    ) as HTMLSpanElement;
    totalEpochsElement.textContent = `${stats.passedEpochCount}/${stats.totalEpochCount}`;

    // Failed epochs
    const failedEpochs = stats.totalEpochCount - stats.passedEpochCount;
    const failedEpochsElement = document.getElementById(
      'modal-failed-epochs',
    ) as HTMLSpanElement;
    failedEpochsElement.textContent = failedEpochs.toString();
  } else {
    // No stats available
    const streakElement = document.getElementById(
      'modal-current-streak',
    ) as HTMLSpanElement;
    streakElement.textContent = 'No data';
    const successRateElement = document.getElementById(
      'modal-epoch-success-rate',
    ) as HTMLSpanElement;
    successRateElement.textContent = '--';
    const totalEpochsElement = document.getElementById(
      'modal-total-epochs',
    ) as HTMLSpanElement;
    totalEpochsElement.textContent = '--';
    const failedEpochsElement = document.getElementById(
      'modal-failed-epochs',
    ) as HTMLSpanElement;
    failedEpochsElement.textContent = '--';
  }

  // Setup ping test
  setupPingTest(gateway);

  // Load gateway information
  loadGatewayInfo(gateway);

  modal.style.display = 'block';
}

function closeModal() {
  const modal = document.getElementById('gatewayModal');

  if (modal) {
    modal.style.display = 'none';
  }
}

async function toggleBlacklist(address: string) {
  try {
    let { blacklistedGateways = [] } = await chrome.storage.local.get([
      'blacklistedGateways',
    ]);

    if (blacklistedGateways.includes(address)) {
      blacklistedGateways = blacklistedGateways.filter(
        (addr: string) => addr !== address,
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

function handleSearch(event: any) {
  searchQuery = event.target.value.trim();
  applyFiltersAndSearch();
}

function handleFilter(event: any) {
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

  if (!syncBtn) {
    return;
  }

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

  // Calculate healthy gateways - joined gateways with 0 consecutive failed epochs
  const healthyCount = allGateways.filter((g) => {
    return (
      g.data.status === 'joined' &&
      (!g.data.stats || g.data.stats.failedConsecutiveEpochs === 0)
    );
  }).length;

  // Calculate total network stake
  let totalNetworkStake = 0;
  allGateways.forEach((gateway) => {
    const operatorStake = gateway.data.operatorStake || 0;
    const delegatedStake = gateway.data.totalDelegatedStake || 0;
    totalNetworkStake += operatorStake + delegatedStake;
  });

  // Convert from smallest unit to ARIO (divide by 1 million)
  const stakeInARIO = totalNetworkStake / 1000000;

  // Format the display
  let displayValue;
  if (stakeInARIO >= 1000000) {
    displayValue = `${(stakeInARIO / 1000000).toFixed(1)}M`;
  } else if (stakeInARIO >= 1000) {
    displayValue = `${(stakeInARIO / 1000).toFixed(1)}K`;
  } else {
    displayValue = Math.floor(stakeInARIO).toLocaleString();
  }

  const totalGatewaysElement = document.getElementById(
    'totalGateways',
  ) as HTMLSpanElement;
  totalGatewaysElement.textContent = totalCount.toString();

  const activeGatewaysElement = document.getElementById(
    'activeGateways',
  ) as HTMLSpanElement;
  activeGatewaysElement.textContent = activeCount.toString();

  const healthyGatewaysElement = document.getElementById(
    'healthyGateways',
  ) as HTMLSpanElement;
  healthyGatewaysElement.textContent = healthyCount.toString();

  const networkStakeElement = document.getElementById(
    'networkStake',
  ) as HTMLSpanElement;
  networkStakeElement.textContent = displayValue;
}

async function updateLastSyncTime() {
  try {
    const { lastSyncTime } = await chrome.storage.local.get(['lastSyncTime']);
    if (lastSyncTime) {
      const lastSyncTimeElement = document.getElementById(
        'lastSyncTime',
      ) as HTMLSpanElement;
      lastSyncTimeElement.textContent = new Date(lastSyncTime).toLocaleString();
    }
  } catch (error) {
    console.error('Error updating last sync time:', error);
  }
}

function showLoadingState() {
  const loadingState = document.getElementById('loadingState');
  const gatewaysList = document.getElementById('gatewaysList');
  const emptyState = document.getElementById('emptyState');

  if (loadingState) {
    loadingState.style.display = 'flex';
  }
  if (gatewaysList) {
    gatewaysList.style.display = 'none';
  }
  if (emptyState) {
    emptyState.style.display = 'none';
  }
}

function hideLoadingState() {
  const loadingState = document.getElementById('loadingState');
  const gatewaysList = document.getElementById('gatewaysList');

  if (loadingState) {
    loadingState.style.display = 'none';
  }
  if (gatewaysList) {
    gatewaysList.style.display = 'block';
  }
}

function showEmptyState() {
  const emptyState = document.getElementById('emptyState');
  const gatewaysList = document.getElementById('gatewaysList');
  const loadingState = document.getElementById('loadingState');

  if (emptyState) {
    emptyState.style.display = 'flex';
  }
  if (gatewaysList) {
    gatewaysList.style.display = 'none';
  }
  if (loadingState) {
    loadingState.style.display = 'none';
  }
}

// Initialize last sync time on load
updateLastSyncTime();

// Check if we need to highlight a specific gateway
checkForHighlightGateway();

// Ping test functionality
function setupPingTest(gateway: any) {
  const pingButton = document.getElementById(
    'pingTestButton',
  ) as HTMLButtonElement;
  const pingResults = document.getElementById('pingResults') as HTMLDivElement;
  const pingLoading = document.getElementById('pingLoading') as HTMLDivElement;

  if (!pingButton || !pingResults || !pingLoading) {
    return;
  }

  // Reset display
  pingResults.style.display = 'none';
  pingLoading.style.display = 'none';
  pingButton.disabled = false;
  pingButton.classList.remove('testing');
  pingButton.querySelector<HTMLSpanElement>('span')!.textContent = 'Run Test';

  pingButton.addEventListener('click', async () => {
    await runPingTest(gateway);
  });
}

async function runPingTest(gateway: any) {
  const pingButton = document.getElementById(
    'pingTestButton',
  ) as HTMLButtonElement;
  const pingResults = document.getElementById('pingResults') as HTMLDivElement;
  const pingLoading = document.getElementById('pingLoading') as HTMLDivElement;

  if (!pingButton || !pingResults || !pingLoading) {
    return;
  }

  const { settings } = gateway.data;

  // Update UI state
  pingButton.disabled = true;
  pingButton.classList.add('testing');
  pingButton.querySelector<HTMLSpanElement>('span')!.textContent = 'Testing...';
  pingResults.style.display = 'none';
  pingLoading.style.display = 'flex';

  try {
    const gatewayUrl = `${settings.protocol}://${settings.fqdn}:${settings.port}`;

    // Test 1: Basic connectivity and response time
    const startTime = performance.now();
    const response = await fetch(`${gatewayUrl}/ar-io/info`, {
      signal: AbortSignal.timeout(10000), // 10 second timeout
    });
    const endTime = performance.now();
    const responseTime = endTime - startTime;

    // Update response time
    const responseTimeEl = document.getElementById(
      'pingResponseTime',
    ) as HTMLSpanElement;
    responseTimeEl.textContent = `${Math.round(responseTime)}ms`;

    if (!responseTimeEl) {
      return;
    }

    if (responseTime < 200) {
      responseTimeEl.className = 'ping-result-value good';
    } else if (responseTime < 1000) {
      responseTimeEl.className = 'ping-result-value warning';
    } else {
      responseTimeEl.className = 'ping-result-value bad';
    }

    // Update status code
    const statusCodeEl = document.getElementById(
      'pingStatusCode',
    ) as HTMLSpanElement;
    statusCodeEl.textContent = response.status.toString();
    statusCodeEl.className = response.ok
      ? 'ping-result-value good'
      : 'ping-result-value bad';

    // Test 2: Health check
    let healthStatus = 'Unknown';
    let healthClass = 'ping-result-value';

    if (response.ok) {
      try {
        const info = await response.json();

        // Check for required fields based on actual ar-io/info response
        const hasWallet = info.wallet && typeof info.wallet === 'string';
        const hasProcessId =
          info.processId && typeof info.processId === 'string';
        const hasRelease = info.release && typeof info.release === 'string';

        // Check for manifest support
        const hasManifests =
          Array.isArray(info.supportedManifestVersions) &&
          info.supportedManifestVersions.length > 0;

        // Check for ANS-104 configuration
        // const hasANS104Config = 'ans104UnbundleFilter' in info && 'ans104IndexFilter' in info;

        if (hasWallet && hasProcessId && hasRelease && hasManifests) {
          healthStatus = 'Healthy';
          healthClass = 'ping-result-value good';
        } else if (hasWallet && hasProcessId) {
          healthStatus = 'Partial';
          healthClass = 'ping-result-value warning';
        } else {
          healthStatus = 'Degraded';
          healthClass = 'ping-result-value warning';
        }
      } catch {
        healthStatus = 'Invalid Response';
        healthClass = 'ping-result-value bad';
      }
    } else {
      healthStatus = 'Unhealthy';
      healthClass = 'ping-result-value bad';
    }

    const healthCheckEl = document.getElementById('pingHealthCheck');

    if (!healthCheckEl) {
      return;
    }

    healthCheckEl.textContent = healthStatus;
    healthCheckEl.className = healthClass;
  } catch {
    // Handle errors
    const responseTimeEl = document.getElementById(
      'pingResponseTime',
    ) as HTMLSpanElement;
    responseTimeEl.textContent = 'Timeout';
    responseTimeEl.className = 'ping-result-value bad';
    const statusCodeEl = document.getElementById(
      'pingStatusCode',
    ) as HTMLSpanElement;
    statusCodeEl.textContent = 'Failed';
    statusCodeEl.className = 'ping-result-value bad';
    const healthCheckEl = document.getElementById(
      'pingHealthCheck',
    ) as HTMLSpanElement;
    healthCheckEl.textContent = 'Offline';
    healthCheckEl.className = 'ping-result-value bad';
  } finally {
    // Show results
    pingLoading.style.display = 'none';
    pingResults.style.display = 'block';
    pingButton.disabled = false;
    pingButton.classList.remove('testing');
    pingButton.querySelector<HTMLSpanElement>('span')!.textContent =
      'Run Again';
  }
}

// Gateway information functionality
async function loadGatewayInfo(gateway: any) {
  const { settings } = gateway.data;

  if (!settings) {
    return;
  }

  try {
    // Calculate uptime (time since join)
    const startDate = new Date(gateway.data.startTimestamp).getTime();
    const now = Date.now();
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

    const uptimeElement = document.getElementById('gatewayUptime');
    if (uptimeElement) {
      uptimeElement.textContent = uptimeText;
    }
  } catch (error) {
    console.error('Error loading gateway info:', error);
    const uptimeElement = document.getElementById('gatewayUptime');
    if (uptimeElement) {
      uptimeElement.textContent = 'Unknown';
    }
  }
}

// Highlight gateway functionality
async function checkForHighlightGateway() {
  const { highlightGateway, openGatewayModal } = await chrome.storage.local.get(
    ['highlightGateway', 'openGatewayModal'],
  );

  if (highlightGateway) {
    // Clear the flags
    await chrome.storage.local.remove(['highlightGateway', 'openGatewayModal']);

    // Wait for gateways to load and then highlight
    setTimeout(() => {
      // Find the gateway in our loaded data
      const targetGateway = allGateways.find(
        (g) => g.data.settings?.fqdn === highlightGateway,
      );

      if (targetGateway && openGatewayModal) {
        // Open the modal directly
        showGatewayDetails(targetGateway);
      } else {
        // Just highlight the card
        const gatewayCards =
          document.querySelectorAll<HTMLDivElement>('.gateway-card');
        for (const card of Array.from(gatewayCards)) {
          const gatewayUrl =
            card.querySelector<HTMLSpanElement>('.gateway-url');

          if (!gatewayUrl) {
            continue;
          }

          if (gatewayUrl && gatewayUrl.textContent === highlightGateway) {
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
      }
    }, 1500); // Give more time for gateways to load
  }
}
