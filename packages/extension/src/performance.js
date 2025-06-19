/**
 * WayFinder History - Gateway Usage Statistics
 */

// State management
let currentPeriod = 'today';
let currentSort = 'requests';
const gatewayUsageData = new Map();

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', async () => {
  setupEventHandlers();
  await loadGatewayUsage();
  await updatePerformanceStats();
  await updateCacheStats();
  await setExtensionVersion();

  // Set up periodic cache stats updates
  setInterval(updateCacheStats, 5000); // Update every 5 seconds
});

function setupEventHandlers() {
  // Navigation
  document.getElementById('backToMain').addEventListener('click', () => {
    window.location.href = 'popup.html';
  });

  // Clear history
  document
    .getElementById('clearHistory')
    .addEventListener('click', clearHistory);

  // Time filter buttons
  document.querySelectorAll('.filter-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      document
        .querySelectorAll('.filter-btn')
        .forEach((b) => b.classList.remove('active'));
      e.target.classList.add('active');
      currentPeriod = e.target.dataset.period;
      loadGatewayUsage();
    });
  });

  // Sort dropdown
  document.getElementById('sortBy').addEventListener('change', (e) => {
    currentSort = e.target.value;
    renderGatewayUsage();
  });

  // Modal close handlers
  document.getElementById('closeModal').addEventListener('click', closeModal);
  document.getElementById('gatewayModal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('gatewayModal')) {
      closeModal();
    }
  });

  // Performance action handlers
  document
    .getElementById('clearVerificationCache')
    ?.addEventListener('click', clearVerificationCache);
  document
    .getElementById('clearPerformanceData')
    ?.addEventListener('click', clearPerformanceData);
}

async function loadGatewayUsage() {
  showLoadingState();

  try {
    // Get gateway performance data and usage history
    const {
      gatewayPerformance = {},
      gatewayUsageHistory = {},
      localGatewayAddressRegistry = {},
    } = await chrome.storage.local.get([
      'gatewayPerformance',
      'gatewayUsageHistory',
      'localGatewayAddressRegistry',
    ]);

    // Clear existing data
    gatewayUsageData.clear();

    // Get time filter
    const _now = new Date();
    const periodStart = getPeriodStartDate(currentPeriod);

    // Process only AR.IO gateways (those in the registry)
    for (const [_registryKey, gatewayDetails] of Object.entries(
      localGatewayAddressRegistry,
    )) {
      const fqdn = gatewayDetails.settings?.fqdn;
      if (!fqdn) continue;

      const performance = gatewayPerformance[fqdn] || {
        successCount: 0,
        failures: 0,
        avgResponseTime: 0,
      };
      const usage = gatewayUsageHistory[fqdn] || {};

      // Filter by time period - only include if used in this period
      if (usage.lastUsed && new Date(usage.lastUsed) < periodStart) {
        continue;
      }

      // Skip if no usage data at all
      if (!usage.requestCount && !performance.successCount) {
        continue;
      }

      gatewayUsageData.set(fqdn, {
        fqdn,
        performance,
        usage: {
          requestCount: usage.requestCount || 0,
          lastUsed: usage.lastUsed || null,
          firstUsed: usage.firstUsed || null,
        },
        details: gatewayDetails,
      });
    }

    // Update summary and render
    await updateSummaryStats();
    renderGatewayUsage();
    updatePeriodLabel();
  } catch (error) {
    console.error('Error loading gateway usage:', error);
    showEmptyState();
  }
}

function getPeriodStartDate(period) {
  const now = new Date();

  switch (period) {
    case 'today':
      return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    case 'week':
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case 'month':
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    case 'all':
    default:
      return new Date(0); // Beginning of time
  }
}

async function updateSummaryStats() {
  let totalRequests = 0;
  let totalResponseTime = 0;
  let responseTimeCount = 0;

  for (const [_fqdn, data] of gatewayUsageData) {
    totalRequests += data.usage.requestCount;
    if (
      data.performance.avgResponseTime &&
      data.performance.avgResponseTime > 0
    ) {
      totalResponseTime += data.performance.avgResponseTime;
      responseTimeCount++;
    }
  }

  // Get daily stats for permaweb ratio calculation
  const { dailyStats = null } = await chrome.storage.local.get(['dailyStats']);

  // Calculate permaweb usage ratio
  let permawebRatio = '';
  if (dailyStats && currentPeriod === 'today') {
    // For today, use actual tracked data
    const totalWebRequests = dailyStats.totalRequestCount || 0;
    const arIORequests = totalRequests;

    if (totalWebRequests === 0) {
      permawebRatio = '0%';
    } else {
      const ratio = ((arIORequests / totalWebRequests) * 100).toFixed(3);
      permawebRatio = `${ratio}%`;
    }
  } else {
    // For other periods, show activity level since we don't have historical total request data
    if (totalRequests === 0) {
      permawebRatio = 'None';
    } else if (totalRequests < 5) {
      permawebRatio = 'Low';
    } else if (totalRequests < 20) {
      permawebRatio = 'Medium';
    } else if (totalRequests < 50) {
      permawebRatio = 'High';
    } else {
      permawebRatio = 'Very High';
    }
  }

  // Update UI with shortened labels for mobile
  document.getElementById('totalRequests').textContent =
    totalRequests >= 1000
      ? `${(totalRequests / 1000).toFixed(1)}k`
      : totalRequests.toString();
  document.getElementById('uniqueGateways').textContent =
    gatewayUsageData.size.toString();

  const avgTime =
    responseTimeCount > 0 ? totalResponseTime / responseTimeCount : 0;
  document.getElementById('avgResponseTime').textContent =
    avgTime > 0 ? `${Math.round(avgTime)}ms` : '--';

  document.getElementById('permawebRatio').textContent = permawebRatio;
}

function renderGatewayUsage() {
  const container = document.getElementById('gatewayUsageList');
  container.innerHTML = '';

  if (gatewayUsageData.size === 0) {
    showEmptyState();
    return;
  }

  hideEmptyState();
  hideLoadingState();

  // Sort data
  const sortedData = Array.from(gatewayUsageData.entries()).sort((a, b) => {
    const [_fqdnA, dataA] = a;
    const [_fqdnB, dataB] = b;

    switch (currentSort) {
      case 'requests':
        return dataB.usage.requestCount - dataA.usage.requestCount;
      case 'recent':
        return (
          new Date(dataB.usage.lastUsed || 0) -
          new Date(dataA.usage.lastUsed || 0)
        );
      case 'performance': {
        const perfA = dataA.performance.avgResponseTime || Infinity;
        const perfB = dataB.performance.avgResponseTime || Infinity;
        return perfA - perfB;
      }
      case 'success': {
        const rateA = getSuccessRate(dataA.performance);
        const rateB = getSuccessRate(dataB.performance);
        return rateB - rateA;
      }
      default:
        return 0;
    }
  });

  // Calculate max requests for usage bar
  const maxRequests = Math.max(
    ...Array.from(gatewayUsageData.values()).map((d) => d.usage.requestCount),
  );

  // Render cards
  sortedData.forEach(([fqdn, data]) => {
    const card = createGatewayUsageCard(fqdn, data, maxRequests);
    container.appendChild(card);
  });
}

function createGatewayUsageCard(fqdn, data, maxRequests) {
  const card = document.createElement('div');
  card.className = 'gateway-usage-card';

  const successRate = getSuccessRate(data.performance);
  const avgTime = data.performance.avgResponseTime;
  const lastUsedText = data.usage.lastUsed
    ? getRelativeTime(new Date(data.usage.lastUsed))
    : 'Never';

  // Determine performance class
  let perfClass = '';
  if (avgTime) {
    if (avgTime < 200) perfClass = 'good';
    else if (avgTime < 1000) perfClass = 'warning';
    else perfClass = 'bad';
  }

  card.innerHTML = `
    <div class="usage-header">
      <div class="gateway-info">
        <div class="gateway-name">${fqdn}</div>
        <div class="last-used">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <polyline points="12 6 12 12 16 14"/>
          </svg>
          Last used: ${lastUsedText}
        </div>
      </div>
      <div class="request-count">${data.usage.requestCount}</div>
    </div>
    
    <div class="usage-stats">
      <div class="stat-item">
        <div class="stat-label">Avg Response</div>
        <div class="stat-value ${perfClass}">
          ${avgTime ? Math.round(avgTime) + 'ms' : '--'}
        </div>
      </div>
      <div class="stat-item">
        <div class="stat-label">Success Rate</div>
        <div class="stat-value ${successRate >= 95 ? 'good' : successRate >= 80 ? 'warning' : 'bad'}">
          ${successRate}%
        </div>
      </div>
      <div class="stat-item">
        <div class="stat-label">Status</div>
        <div class="stat-value ${data.details?.status === 'joined' ? 'good' : 'warning'}">
          ${data.details?.status || 'Unknown'}
        </div>
      </div>
    </div>
    
    <div class="usage-bar-container">
      <div class="usage-bar-label">
        <span>Usage Share</span>
        <span>${Math.round((data.usage.requestCount / maxRequests) * 100)}%</span>
      </div>
      <div class="usage-bar-background">
        <div class="usage-bar-fill" style="width: ${(data.usage.requestCount / maxRequests) * 100}%"></div>
      </div>
    </div>
  `;

  // Click to view gateway details modal
  card.addEventListener('click', () => {
    openGatewayModal(fqdn, data.details);
  });

  return card;
}

function getSuccessRate(performance) {
  const total = performance.successCount + performance.failures;
  if (total === 0) return 0;
  return Math.round((performance.successCount / total) * 100);
}

function getRelativeTime(date) {
  const now = new Date();
  const diff = now - date;

  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 30) return `${days}d ago`;

  return date.toLocaleDateString();
}

function updatePeriodLabel() {
  const label = document.getElementById('periodLabel');
  const periodText = {
    today: 'today',
    week: 'the last 7 days',
    month: 'the last 30 days',
    all: 'all time',
  };

  label.textContent = `Showing usage for ${periodText[currentPeriod]}`;

  // Update footer date range
  const dataRange = document.getElementById('dataRange');
  const start = getPeriodStartDate(currentPeriod);
  const now = new Date();

  if (currentPeriod === 'today') {
    dataRange.textContent = now.toLocaleDateString();
  } else if (currentPeriod === 'all') {
    dataRange.textContent = 'All available data';
  } else {
    dataRange.textContent = `${start.toLocaleDateString()} - ${now.toLocaleDateString()}`;
  }
}

async function clearHistory() {
  if (!confirm('Clear all gateway usage history? This cannot be undone.')) {
    return;
  }

  try {
    // Clear usage history but keep performance data
    await chrome.storage.local.remove(['gatewayUsageHistory']);

    // Reset gateway performance success counts
    const { gatewayPerformance = {} } = await chrome.storage.local.get([
      'gatewayPerformance',
    ]);

    for (const gateway of Object.values(gatewayPerformance)) {
      gateway.successCount = 0;
      gateway.failures = 0;
    }

    await chrome.storage.local.set({ gatewayPerformance });

    showToast('History cleared', 'success');
    await loadGatewayUsage();
  } catch (error) {
    console.error('Error clearing history:', error);
    showToast('Failed to clear history', 'error');
  }
}

function showLoadingState() {
  document.getElementById('loadingState').style.display = 'flex';
  document.getElementById('gatewayUsageList').style.display = 'none';
  document.getElementById('emptyState').style.display = 'none';
}

function hideLoadingState() {
  document.getElementById('loadingState').style.display = 'none';
  document.getElementById('gatewayUsageList').style.display = 'block';
}

function showEmptyState() {
  document.getElementById('emptyState').style.display = 'flex';
  document.getElementById('gatewayUsageList').style.display = 'none';
  document.getElementById('loadingState').style.display = 'none';
}

function hideEmptyState() {
  document.getElementById('emptyState').style.display = 'none';
}

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;

  const container = document.getElementById('toastContainer');
  container.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 3000);
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

// Performance stats functions moved from settings.js
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

async function updateCacheStats() {
  try {
    // Get cache stats from background script
    const response = await chrome.runtime.sendMessage({
      message: 'getCacheStats',
    });

    if (response && response.stats) {
      const { size, sizeInKB, hitRate } = response.stats;

      const cacheSizeEl = document.getElementById('cacheSize');
      if (cacheSizeEl) {
        cacheSizeEl.textContent = size > 0 ? size : '--';
      }

      const cacheSizeKBEl = document.getElementById('cacheSizeKB');
      if (cacheSizeKBEl) {
        cacheSizeKBEl.textContent = sizeInKB > 0 ? `${sizeInKB} KB` : '--';
      }

      const cacheHitRateEl = document.getElementById('cacheHitRate');
      if (cacheHitRateEl) {
        cacheHitRateEl.textContent =
          hitRate > 0 ? `${Math.round(hitRate)}%` : '--';
      }
    }
  } catch (error) {
    console.error('Error updating cache stats:', error);
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
    await updateCacheStats();
  } catch (error) {
    console.error('Error clearing performance data:', error);
    showToast('Failed to clear performance data', 'error');
  }
}

async function clearVerificationCache() {
  if (
    !confirm(
      'Clear verification cache? This will remove all cached verification results.',
    )
  ) {
    return;
  }

  try {
    const response = await chrome.runtime.sendMessage({
      message: 'clearVerificationCache',
    });

    if (response && response.success) {
      showToast('Verification cache cleared', 'success');
      await updateCacheStats();
    } else {
      throw new Error(response?.error || 'Failed to clear cache');
    }
  } catch (error) {
    console.error('Error clearing verification cache:', error);
    showToast('Failed to clear verification cache', 'error');
  }
}

// Modal functions
async function openGatewayModal(fqdn, gatewayDetails) {
  if (!gatewayDetails) {
    showToast('Gateway details not available', 'error');
    return;
  }

  const modal = document.getElementById('gatewayModal');

  // Get additional data
  const { gatewayPerformance = {}, gatewayUsageHistory = {} } =
    await chrome.storage.local.get([
      'gatewayPerformance',
      'gatewayUsageHistory',
    ]);

  const performance = gatewayPerformance[fqdn] || {};
  const usage = gatewayUsageHistory[fqdn] || {};
  const settings = gatewayDetails.settings || {};

  // Find gateway address from registry
  const { localGatewayAddressRegistry = {} } = await chrome.storage.local.get([
    'localGatewayAddressRegistry',
  ]);
  let gatewayAddress = '';
  for (const [address, details] of Object.entries(
    localGatewayAddressRegistry,
  )) {
    if (details.settings?.fqdn === fqdn) {
      gatewayAddress = address;
      break;
    }
  }

  // Populate modal fields
  document.getElementById('modal-gateway-url').href =
    `${settings.protocol}://${settings.fqdn}:${settings.port}`;
  document
    .getElementById('modal-gateway-url')
    .querySelector(
      'span',
    ).textContent = `${settings.protocol}://${settings.fqdn}`;

  if (gatewayAddress) {
    document.getElementById('modal-gateway-wallet').href =
      `https://viewblock.io/arweave/address/${gatewayAddress}`;
    document
      .getElementById('modal-gateway-wallet')
      .querySelector(
        'span',
      ).textContent = `${gatewayAddress.slice(0, 6)}...${gatewayAddress.slice(-4)}`;
  } else {
    document
      .getElementById('modal-gateway-wallet')
      .querySelector('span').textContent = 'Unknown';
  }

  // Calculate total stake
  const totalStake = Math.floor(
    ((gatewayDetails.operatorStake || 0) +
      (gatewayDetails.totalDelegatedStake || 0)) /
      1000000,
  );
  document.getElementById('modal-total-stake').textContent =
    `${totalStake.toLocaleString()} ARIO`;

  // Response time
  document.getElementById('modal-gateway-avg-response-time').textContent =
    performance.avgResponseTime
      ? `${Math.round(performance.avgResponseTime)}ms`
      : '--';

  // Start date
  document.getElementById('modal-start').textContent =
    gatewayDetails.startTimestamp
      ? new Date(gatewayDetails.startTimestamp).toLocaleDateString()
      : '--';

  // Usage count
  document.getElementById('modal-usage-count').textContent = usage.requestCount
    ? usage.requestCount.toString()
    : '0';

  // Success rate
  const successRate = getSuccessRate(performance);
  document.getElementById('modal-success-rate').textContent = `${successRate}%`;

  // Failed requests
  document.getElementById('modal-failed-requests').textContent =
    performance.failures ? performance.failures.toString() : '0';

  // Last used
  document.getElementById('modal-last-used').textContent = usage.lastUsed
    ? getRelativeTime(new Date(usage.lastUsed))
    : 'Never';

  // Status badge
  const statusBadge = document.getElementById('modalStatusBadge');
  let statusClass = 'unknown';
  let statusText = 'Unknown';

  if (gatewayDetails.status === 'joined') {
    statusClass = 'good';
    statusText = 'Active';
  } else if (gatewayDetails.status === 'leaving') {
    statusClass = 'warning';
    statusText = 'Leaving';
  }

  statusBadge.className = `gateway-status-badge ${statusClass}`;
  statusBadge.querySelector('span').textContent = statusText;

  // Show modal
  modal.style.display = 'block';
}

function closeModal() {
  document.getElementById('gatewayModal').style.display = 'none';
}
