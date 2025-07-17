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
import { setExtensionVersion } from './utils/version';
// Toast notification system
// Exported for potential future use
export function showToast(
  message: string,
  type: 'success' | 'error' = 'success',
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

// Initialize popup
document.addEventListener('DOMContentLoaded', async () => {
  await initializePopup();
  setupEventHandlers();
  setupStorageListener();
  await loadStats();
  await loadCurrentStrategy();
  updateConnectionStatus();
});

// Listen for storage changes to update UI in real-time
function setupStorageListener() {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local') {
      // Update gateway count if sync status or registry changes
      if (
        changes.syncStatus ||
        changes.localGatewayAddressRegistry ||
        changes.lastKnownGatewayCount
      ) {
        loadStats();
      }

      // Update routing strategy if changed
      if (changes.routingMethod) {
        loadCurrentStrategy();
      }
    }
  });
}

async function initializePopup() {
  // Apply saved theme
  await applyTheme();

  // Set dynamic version
  await setExtensionVersion();
}

function setupEventHandlers() {
  // Navigation cards
  document.getElementById('showGateways')?.addEventListener('click', () => {
    window.location.href = 'gateways.html';
  });

  document.getElementById('showHistory')?.addEventListener('click', () => {
    window.location.href = 'performance.html';
  });

  document.getElementById('showSettings')?.addEventListener('click', () => {
    window.location.href = 'settings.html';
  });

  // Current strategy change
  document.getElementById('changeStrategy')?.addEventListener('click', () => {
    window.location.href = 'settings.html#routing';
  });
}

async function loadStats() {
  try {
    // Load gateway stats, daily stats, and sync status
    const {
      localGatewayAddressRegistry = {},
      gatewayPerformance = {},
      dailyStats,
      syncStatus = 'idle',
      lastKnownGatewayCount = 0,
    } = await chrome.storage.local.get([
      'localGatewayAddressRegistry',
      'gatewayPerformance',
      'dailyStats',
      'syncStatus',
      'lastKnownGatewayCount',
    ]);

    // Calculate healthy gateways - joined gateways with 0 consecutive failed epochs
    const healthyCount = Object.values(localGatewayAddressRegistry).filter(
      (gateway: any) =>
        gateway.status === 'joined' &&
        (!gateway.stats || gateway.stats.failedConsecutiveEpochs === 0),
    ).length;

    // Update gateway count with loading state
    const countElement = document.getElementById('healthyGatewayCount');
    const gatewayCard = document.getElementById('showGateways');
    const avgResponseTimeElement = document.getElementById('avgResponseTime');
    const requestsTodayElement = document.getElementById('requestsToday');

    if (!countElement || !gatewayCard) return;

    if (syncStatus === 'syncing') {
      // Show loading state
      if (lastKnownGatewayCount > 0) {
        countElement.innerHTML = `<svg class="loading-indicator" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 11-6.219-8.56"/></svg> ${lastKnownGatewayCount}`;
        // Add subtle loading animation to the card
        gatewayCard.classList.add('syncing');
      } else {
        countElement.innerHTML =
          '<svg class="loading-indicator spinning" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 11-6.219-8.56"/></svg> Syncing...';
        gatewayCard.classList.add('syncing');
      }
    } else if (syncStatus === 'error' && lastKnownGatewayCount > 0) {
      // Show last known count with error indicator
      countElement.innerHTML = `<svg class="error-indicator" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> ${lastKnownGatewayCount}`;
      gatewayCard.classList.add('sync-error');
      gatewayCard.classList.remove('syncing');
    } else if (healthyCount === 0 && syncStatus === 'idle') {
      // Initial state - trigger sync
      countElement.innerHTML =
        '<svg class="loading-indicator spinning" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 11-6.219-8.56"/></svg> Loading...';
      gatewayCard.classList.add('syncing');
      // Trigger initial sync
      chrome.runtime.sendMessage({ message: 'syncGatewayAddressRegistry' });
    } else {
      // Normal display
      countElement.textContent = healthyCount.toString();
      gatewayCard.classList.remove('syncing', 'sync-error');
    }

    // Calculate average response time
    const performances = Object.values(gatewayPerformance);
    if (performances.length > 0) {
      const avgResponseTimes = performances
        .map((p: any) => p.avgResponseTime)
        .filter((time) => time !== undefined);

      const overallAvg =
        avgResponseTimes.length > 0
          ? avgResponseTimes.reduce((a, b) => a + b, 0) /
            avgResponseTimes.length
          : 0;

      if (!avgResponseTimeElement) return;

      avgResponseTimeElement.textContent =
        overallAvg > 0 ? `${Math.round(overallAvg)}ms` : '--';
    } else {
      const avgResponseTimeElement = document.getElementById('avgResponseTime');
      if (!avgResponseTimeElement) return;

      avgResponseTimeElement.textContent = '--';
    }

    // Display actual requests today
    const today = new Date().toDateString();
    const requestsToday =
      dailyStats && dailyStats.date === today ? dailyStats.requestCount : 0;

    if (!requestsTodayElement) return;

    requestsTodayElement.textContent = requestsToday.toString();
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
      random: 'Balanced',
      static: 'Static Gateway',
      // Legacy method fallbacks
      optimalGateway: 'Fastest Ping',
      weightedStake: 'Balanced',
      topFiveStake: 'Balanced',
      weightedOnchainPerformance: 'Fastest Ping',
      stakeRandom: 'Balanced',
      highestStake: 'Balanced',
      roundRobin: 'Balanced', // Fallback for old configs
    };

    const strategyName =
      strategyNames[routingMethod as keyof typeof strategyNames] ||
      'Fastest Ping';
    const currentStrategyElement = document.getElementById('currentStrategy');
    if (currentStrategyElement) {
      currentStrategyElement.textContent = strategyName;
    }
  } catch (error) {
    console.error('Error loading current strategy:', error);
  }
}

async function updateConnectionStatus() {
  // Show static "Connected" status (connection testing removed)
  const statusElement = document.getElementById('connectionStatus');
  if (!statusElement) return;

  const statusText = statusElement.querySelector('.status-text');
  if (!statusText) return;

  statusText.textContent = 'Connected';
  statusElement.classList.remove('limited', 'offline');
  statusElement.classList.add('connected');
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
  .addEventListener('change', async () => {
    const { theme } = await chrome.storage.local.get(['theme']);
    if (theme === 'auto') {
      applyTheme();
    }
  });
