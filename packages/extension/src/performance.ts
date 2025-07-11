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
  document.getElementById('backToMain')?.addEventListener('click', () => {
    window.location.href = 'popup.html';
  });

  // Time filter buttons
  document.querySelectorAll<HTMLButtonElement>('.filter-btn').forEach((btn) => {
    btn.addEventListener('click', (e: Event) => {
      if (!(e.target instanceof HTMLButtonElement)) return;
      document
        .querySelectorAll('.filter-btn')
        .forEach((b) => b.classList.remove('active'));
      e.target?.classList.add('active');
      currentPeriod = e.target?.dataset.period || 'today';
      loadGatewayUsage();
    });
  });

  // Sort dropdown
  document.getElementById('sortBy')?.addEventListener('change', (e) => {
    if (!(e.target instanceof HTMLSelectElement)) return;
    currentSort = e.target.value;
    renderGatewayUsage();
  });
}

async function loadGatewayUsage() {
  showLoadingState();

  try {
    // Get gateway performance data and usage history
    const {
      gatewayPerformance = {},
      gatewayUsageHistory = {},
      localGatewayAddressRegistry = {},
    } = (await chrome.storage.local.get([
      'gatewayPerformance',
      'gatewayUsageHistory',
      'localGatewayAddressRegistry',
    ])) as {
      gatewayPerformance: Record<string, any>;
      gatewayUsageHistory: Record<string, any>;
      localGatewayAddressRegistry: Record<string, any>;
    };

    // Clear existing data
    gatewayUsageData.clear();

    // Get time filter
    const periodStart = getPeriodStartDate(currentPeriod);

    // Process only AR.IO gateways (those in the registry)
    for (const [, gatewayDetails] of Object.entries(
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

function getPeriodStartDate(period: string) {
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

  for (const [, data] of gatewayUsageData) {
    totalRequests += data.usage.requestCount;
    if (
      data.performance.avgResponseTime &&
      data.performance.avgResponseTime > 0
    ) {
      totalResponseTime += data.performance.avgResponseTime;
      responseTimeCount++;
    }
  }

  // Update UI with shortened labels for mobile
  const totalRequestsEl = document.getElementById('totalRequests');
  if (!totalRequestsEl) return;
  totalRequestsEl.textContent =
    totalRequests >= 1000
      ? `${(totalRequests / 1000).toFixed(1)}k`
      : totalRequests.toString();

  const uniqueGatewaysEl = document.getElementById('uniqueGateways');
  if (!uniqueGatewaysEl) return;
  uniqueGatewaysEl.textContent = gatewayUsageData.size.toString();

  const avgTime =
    responseTimeCount > 0 ? totalResponseTime / responseTimeCount : 0;
  const avgResponseTimeEl = document.getElementById('avgResponseTime');
  if (!avgResponseTimeEl) return;
  avgResponseTimeEl.textContent =
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
  if (!topGatewayEl) return;
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
        openGatewayModal: true,
      });
      window.location.href = 'gateways.html';
    };
  }
}

function renderGatewayUsage() {
  const container = document.getElementById('gatewayUsageList');
  if (!container) return;
  container.innerHTML = '';

  if (gatewayUsageData.size === 0) {
    showEmptyState();
    return;
  }

  hideEmptyState();
  hideLoadingState();

  // Sort data
  const sortedData = Array.from(gatewayUsageData.entries()).sort((a, b) => {
    const [, dataA] = a;
    const [, dataB] = b;

    switch (currentSort) {
      case 'requests':
        return dataB.usage.requestCount - dataA.usage.requestCount;
      case 'recent':
        return (
          new Date(dataB.usage.lastUsed || '').getTime() -
          new Date(dataA.usage.lastUsed || '').getTime()
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
    0,
  );

  // Render cards
  sortedData.forEach(([fqdn, data]) => {
    const card = createGatewayUsageCard(fqdn, data, totalRequests);
    container.appendChild(card);
  });
}

function createGatewayUsageCard(
  fqdn: string,
  data: any,
  totalRequests: number,
) {
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
  const usagePercentage =
    totalRequests > 0
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
      openGatewayModal: true,
    });
    window.location.href = 'gateways.html';
  });

  return card;
}

function getSuccessRate(performance: any) {
  const total = performance.successCount + performance.failures;
  if (total === 0) return 0;
  return Math.round((performance.successCount / total) * 100);
}

function updatePeriodLabel() {
  const label = document.getElementById('periodLabel');
  if (!label) return;
  const periodText = {
    today: 'today',
    week: 'the last 7 days',
    month: 'the last 30 days',
    all: 'all time',
  };

  label.textContent = `Showing usage for ${periodText[currentPeriod as keyof typeof periodText]}`;

  // Update footer date range
  const dataRange = document.getElementById('dataRange');
  if (!dataRange) return;
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
  const loadingState = document.getElementById('loadingState');
  if (!loadingState) return;
  loadingState.style.display = 'flex';

  const gatewayUsageList = document.getElementById('gatewayUsageList');
  if (!gatewayUsageList) return;
  gatewayUsageList.style.display = 'none';

  const emptyState = document.getElementById('emptyState');
  if (!emptyState) return;
  emptyState.style.display = 'flex';
}

function hideLoadingState() {
  const loadingState = document.getElementById('loadingState');
  if (!loadingState) return;
  loadingState.style.display = 'none';

  const gatewayUsageList = document.getElementById('gatewayUsageList');
  if (!gatewayUsageList) return;
  gatewayUsageList.style.display = 'block';
}

function showEmptyState() {
  const emptyState = document.getElementById('emptyState');
  if (!emptyState) return;
  emptyState.style.display = 'flex';

  const gatewayUsageList = document.getElementById('gatewayUsageList');
  if (!gatewayUsageList) return;
  gatewayUsageList.style.display = 'none';

  const loadingState = document.getElementById('loadingState');
  if (!loadingState) return;
  loadingState.style.display = 'none';
}

function hideEmptyState() {
  const emptyState = document.getElementById('emptyState');
  if (!emptyState) return;
  emptyState.style.display = 'none';
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
        .map((p: any) => p.avgResponseTime)
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
      const successRates = performances.map((p: any) => {
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
  } catch (error) {
    console.error('Error updating performance stats:', error);
  }
}
