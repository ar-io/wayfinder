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
import { AoGatewayWithAddress } from '@ar.io/sdk';
import { TOP_ONCHAIN_GATEWAY_LIMIT } from './constants';
import { logger } from './utils/logger';
// Legacy imports removed - using ChromeStorageGatewayProvider instead

export async function backgroundGatewayBenchmarking() {
  logger.debug(
    'Running Gateway benchmark (deprecated - handled by core library)',
  );

  // This function is being phased out in favor of the Wayfinder core library's
  // built-in performance tracking and gateway selection algorithms.
  // Keeping for compatibility but functionality moved to ChromeStorageGatewayProvider

  logger.debug('Gateway benchmark completed (using core library)');
}

/**
 * Runs a **background validation** for **top performing gateways** instead of a single cached one.
 * - If they are too slow, marks them as stale.
 */
export async function backgroundValidateCachedGateway() {
  logger.debug(
    'Running background gateway validation (deprecated - handled by core library)',
  );

  // This function is being phased out in favor of the Wayfinder core library's
  // built-in performance validation and gateway health monitoring.

  logger.debug('Background validation completed (using core library)');
}

/**
 * Checks if a hostname belongs to a known AR.IO gateway.
 */
export async function isKnownGateway(fqdn: string): Promise<boolean> {
  const normalizedFQDN = await normalizeGatewayFQDN(fqdn);

  const { localGatewayAddressRegistry = {} } = await chrome.storage.local.get([
    'localGatewayAddressRegistry',
  ]);

  return Object.values(localGatewayAddressRegistry).some(
    (gw: any) => gw.settings.fqdn === normalizedFQDN,
  );
}

/**
 * Updates gateway performance metrics using an Exponential Moving Average (EMA).
 */
export async function updateGatewayPerformance(
  rawFQDN: string, // The full hostname from the request
  startTime: number,
) {
  const gatewayFQDN = await normalizeGatewayFQDN(rawFQDN); // ✅ Normalize before storage
  const responseTime = Math.max(0, performance.now() - startTime); // Prevent negatives

  // Ensure performance storage is initialized
  const storage = await chrome.storage.local.get(['gatewayPerformance']);
  const gatewayPerformance = storage.gatewayPerformance || {};

  // Ensure the gateway entry exists
  if (!gatewayPerformance[gatewayFQDN]) {
    gatewayPerformance[gatewayFQDN] = {
      avgResponseTime: responseTime, // Set initial average
      failures: 0,
      successCount: 1, // First success
    };
  } else {
    const prevAvg =
      gatewayPerformance[gatewayFQDN].avgResponseTime || responseTime;
    const alpha = 0.2; // **Smoothing factor (higher = reacts faster, lower = more stable)**

    // 🔥 Compute new EMA for response time
    gatewayPerformance[gatewayFQDN].avgResponseTime =
      alpha * responseTime + (1 - alpha) * prevAvg;

    gatewayPerformance[gatewayFQDN].successCount += 1;
  }

  // Debug: Gateway performance update
  // logger.debug(`Updating Gateway Performance: ${gatewayFQDN} | New Response Time: ${responseTime} New Avg Response Time: ${gatewayPerformance[gatewayFQDN].avgResponseTime.toFixed(2)}ms`);

  // 🔥 Store under the **root** FQDN
  await chrome.storage.local.set({ gatewayPerformance });

  // Update usage history
  await updateGatewayUsageHistory(gatewayFQDN);
}

/**
 * Updates gateway usage history for the History page
 */
export async function updateGatewayUsageHistory(gatewayFQDN: string) {
  const now = new Date().toISOString();

  const { gatewayUsageHistory = {} } = await chrome.storage.local.get([
    'gatewayUsageHistory',
  ]);

  if (!gatewayUsageHistory[gatewayFQDN]) {
    gatewayUsageHistory[gatewayFQDN] = {
      requestCount: 1,
      firstUsed: now,
      lastUsed: now,
    };
  } else {
    gatewayUsageHistory[gatewayFQDN].requestCount += 1;
    gatewayUsageHistory[gatewayFQDN].lastUsed = now;
  }

  await chrome.storage.local.set({ gatewayUsageHistory });
}

/**
 * Extracts the base gateway FQDN from a potentially subdomain-prefixed FQDN.
 * Ensures that ArNS subdomains and TXID-based URLs resolve to their root gateway.
 *
 * @param fqdn The full hostname from the request.
 * @returns The normalized gateway FQDN.
 */
export async function normalizeGatewayFQDN(fqdn: string): Promise<string> {
  const { localGatewayAddressRegistry = {} } = await chrome.storage.local.get([
    'localGatewayAddressRegistry',
  ]);

  const knownGateways = Object.values(localGatewayAddressRegistry).map(
    (gw: any) => gw.settings.fqdn,
  );

  // ✅ Direct match (e.g., `arweave.net`)
  if (knownGateways.includes(fqdn)) {
    return fqdn;
  }

  // 🔍 Check if fqdn is a **subdomain** of a known gateway (e.g., `example.arweave.net`)
  for (const gatewayFQDN of knownGateways) {
    if (fqdn.endsWith(`.${gatewayFQDN}`)) {
      return gatewayFQDN; // ✅ Return base FQDN
    }
  }

  // 🚨 Unknown gateway fallback
  // logger.warn(`Unknown gateway encountered: ${fqdn}`);
  return fqdn;
}

export function isBase64URL(address: string): boolean {
  const trimmedBase64URL = address.toString().trim();
  const BASE_64_REXEX = new RegExp('^[a-zA-Z0-9-_s+]{43}$');
  return BASE_64_REXEX.test(trimmedBase64URL);
}
