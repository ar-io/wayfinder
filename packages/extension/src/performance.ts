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
  await setExtensionVersion();
});

function setupEventHandlers() {
  // Navigation
  document.getElementById('backToMain').addEventListener('click', () => {
    window.location.href = 'popup.html';
  });

  // Clear history - removed as functionality moved to Settings page

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

  // Modal handlers removed - gateway cards now navigate to gateways page
  // Performance action handlers removed - functionality moved to Settings page
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

  // Find the most used gateway
  let topGateway = '--';
  let topGatewayFull = '--';
  let maxRequests = 0;
  
  for (const [fqdn, data] of gatewayUsageData) {
    if (data.usage.requestCount > maxRequests) {
      maxRequests = data.usage.requestCount;
      topGateway = fqdn;
      topGatewayFull = fqdn;
    }
  }

  // Truncate long gateway names for display
  if (topGateway !== '--' && topGateway.length > 20) {
    topGateway = topGateway.substring(0, 17) + '...';
  }

  const topGatewayEl = document.getElementById('topGateway');
  topGatewayEl.textContent = topGateway;
  
  // Make it clickable if we have a gateway
  if (topGatewayFull !== '--') {
    topGatewayEl.style.cursor = 'pointer';
    topGatewayEl.style.textDecoration = 'underline';
    topGatewayEl.title = `Click to view ${topGatewayFull} details`;
    
    topGatewayEl.onclick = async () => {
      // Store the gateway to highlight and open
      await chrome.storage.local.set({ 
        highlightGateway: topGatewayFull,
        openGatewayModal: true 
      });
      window.location.href = 'gateways.html';
    };
  }
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

  // Calculate total requests for usage share
  const totalRequests = Array.from(gatewayUsageData.values()).reduce(
    (sum, d) => sum + d.usage.requestCount,
    0
  );

  // Render cards
  sortedData.forEach(([fqdn, data]) => {
    const card = createGatewayUsageCard(fqdn, data, totalRequests);
    container.appendChild(card);
  });
}

function createGatewayUsageCard(fqdn, data, totalRequests) {
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

  // Calculate usage percentage - handle edge case where totalRequests is 0
  const usagePercentage = totalRequests > 0 
    ? Math.round((data.usage.requestCount / totalRequests) * 100)
    : 0;

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
        <span>${usagePercentage}%</span>
      </div>
      <div class="usage-bar-background">
        <div class="usage-bar-fill" style="width: ${usagePercentage}%"></div>
      </div>
    </div>
  `;

  // Click to navigate to gateway details on gateways page
  card.addEventListener('click', async () => {
    await chrome.storage.local.set({ 
      highlightGateway: fqdn,
      openGatewayModal: true 
    });
    window.location.href = 'gateways.html';
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

// Removed: clearHistory function - functionality moved to Settings page

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

    // Verification stats elements removed - functionality moved elsewhere
  } catch (error) {
    console.error('Error updating performance stats:', error);
  }
}

// Removed: updateCacheStats function - verification cache removed
// Removed: clearPerformanceData function - functionality moved to Settings page
// Removed: clearVerificationCache function - verification cache removed
// Removed: openGatewayModal and closeModal functions - gateway cards now navigate to gateways page
