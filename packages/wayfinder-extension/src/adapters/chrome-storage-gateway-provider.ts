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
import { AoGatewayWithAddress } from '@ar.io/sdk/web';
import { GatewayRegistry } from '../types';

/**
 * Gateway provider that uses Chrome extension's local storage
 * to provide gateways for the core library's routing strategies.
 * This bridges the existing extension gateway registry with the core library.
 */
export class ChromeStorageGatewayProvider {
  private sortBy: 'operatorStake' | 'totalDelegatedStake';
  private sortOrder: 'asc' | 'desc';

  constructor(
    options: {
      sortBy?: 'operatorStake' | 'totalDelegatedStake';
      sortOrder?: 'asc' | 'desc';
    } = {},
  ) {
    this.sortBy = options.sortBy || 'operatorStake';
    this.sortOrder = options.sortOrder || 'desc';
  }

  /**
   * Gets filtered gateways from Chrome storage, excluding blacklisted and unjoined gateways
   */
  async getGateways(): Promise<URL[]> {
    const { localGatewayAddressRegistry = {}, blacklistedGateways = [] } =
      (await chrome.storage.local.get([
        'localGatewayAddressRegistry',
        'blacklistedGateways',
      ])) as {
        localGatewayAddressRegistry: GatewayRegistry;
        blacklistedGateways: string[];
      };

    // Get all joined, non-blacklisted gateways
    const joinedGateways = Object.entries(localGatewayAddressRegistry)
      .filter(
        ([gatewayAddress, gateway]) =>
          !blacklistedGateways.includes(gatewayAddress) &&
          gateway.status === 'joined',
      )
      .map(([, gateway]) => gateway);

    // First try to filter out gateways with consecutive failed epochs
    let filteredGateways = joinedGateways.filter(
      (gateway) =>
        !gateway.stats || gateway.stats.failedConsecutiveEpochs === 0,
    );

    // Log if any gateways were filtered out due to failed epochs
    const failingGatewaysCount =
      joinedGateways.length - filteredGateways.length;
    if (failingGatewaysCount > 0) {
      console.info(
        `[ChromeStorageGatewayProvider] Filtered out ${failingGatewaysCount} gateways with consecutive failed epochs`,
      );
    }

    // If all gateways have failed epochs, use the ones with the least failures
    if (filteredGateways.length === 0 && joinedGateways.length > 0) {
      console.warn(
        '[ChromeStorageGatewayProvider] All gateways have failed epochs, using gateways with least failures',
      );
      // Sort by failed epochs and take the best ones
      filteredGateways = joinedGateways
        .sort(
          (a, b) =>
            (a.stats?.failedConsecutiveEpochs || 0) -
            (b.stats?.failedConsecutiveEpochs || 0),
        )
        .slice(0, Math.max(5, Math.floor(joinedGateways.length * 0.3))); // Take top 5 or 30% of gateways
    }

    // Sort gateways based on configuration
    const sortedGateways = filteredGateways.sort((a, b) => {
      let aValue: number;
      let bValue: number;

      if (this.sortBy === 'operatorStake') {
        aValue = a.operatorStake || 0;
        bValue = b.operatorStake || 0;
      } else {
        // totalDelegatedStake
        aValue = a.totalDelegatedStake || 0;
        bValue = b.totalDelegatedStake || 0;
      }

      // Apply sort order
      if (this.sortOrder === 'asc') {
        return aValue - bValue;
      } else {
        return bValue - aValue;
      }
    });

    // Convert to URL format expected by core library
    const gateways = sortedGateways.map((gateway) => {
      const { protocol, fqdn, port } = gateway.settings;
      const portSuffix =
        port && port !== (protocol === 'https' ? 443 : 80) ? `:${port}` : '';
      return new URL(`${protocol}://${fqdn}${portSuffix}`);
    });

    // If no gateways are available (registry not synced or empty), use fallback
    if (gateways.length === 0) {
      console.warn(
        '[ChromeStorageGatewayProvider] No gateways in local registry, using arweave.net as fallback',
      );
      return [new URL('https://arweave.net')];
    }

    return gateways;
  }

  /**
   * Gets gateway with performance data for advanced routing decisions
   */
  async getGatewaysWithMetadata(): Promise<
    Array<{
      url: URL;
      gateway: AoGatewayWithAddress;
      performance?: {
        avgResponseTime: number;
        failures: number;
        successCount: number;
      };
    }>
  > {
    const {
      localGatewayAddressRegistry = {},
      blacklistedGateways = [],
      gatewayPerformance = {},
    } = (await chrome.storage.local.get([
      'localGatewayAddressRegistry',
      'blacklistedGateways',
      'gatewayPerformance',
    ])) as {
      localGatewayAddressRegistry: GatewayRegistry;
      blacklistedGateways: string[];
      gatewayPerformance: Record<
        string,
        {
          avgResponseTime: number;
          failures: number;
          successCount: number;
        }
      >;
    };

    // Get all joined, non-blacklisted gateways
    const joinedGateways = Object.entries(localGatewayAddressRegistry).filter(
      ([gatewayAddress, gateway]) =>
        !blacklistedGateways.includes(gatewayAddress) &&
        gateway.status === 'joined',
    );

    // First try to filter out gateways with consecutive failed epochs
    let filteredGateways = joinedGateways.filter(
      ([, gateway]) =>
        !gateway.stats || gateway.stats.failedConsecutiveEpochs === 0,
    );

    // If all gateways have failed epochs, use the ones with the least failures
    if (filteredGateways.length === 0 && joinedGateways.length > 0) {
      // Sort by failed epochs and take the best ones
      filteredGateways = joinedGateways
        .sort(
          ([, a], [, b]) =>
            (a.stats?.failedConsecutiveEpochs || 0) -
            (b.stats?.failedConsecutiveEpochs || 0),
        )
        .slice(0, Math.max(5, Math.floor(joinedGateways.length * 0.3)));
    }

    // Filter and enrich gateways with performance data
    return filteredGateways.map(([, gateway]) => {
      const { protocol, fqdn, port } = gateway.settings;
      const portSuffix =
        port && port !== (protocol === 'https' ? 443 : 80) ? `:${port}` : '';
      const url = new URL(`${protocol}://${fqdn}${portSuffix}`);

      return {
        url,
        gateway,
        performance: gatewayPerformance[fqdn],
      };
    });
  }

  /**
   * Gets static gateway if configured, otherwise returns null
   */
  async getStaticGateway(): Promise<URL | null> {
    const { staticGateway } = await chrome.storage.local.get(['staticGateway']);

    if (!staticGateway) {
      return null;
    }

    const { protocol, fqdn, port } = staticGateway.settings;
    const portSuffix =
      port && port !== (protocol === 'https' ? 443 : 80) ? `:${port}` : '';
    return new URL(`${protocol}://${fqdn}${portSuffix}`);
  }

  /**
   * Updates gateway performance metrics in Chrome storage
   */
  async updateGatewayPerformance(
    fqdn: string,
    responseTime: number,
    success: boolean = true,
  ): Promise<void> {
    const storage = await chrome.storage.local.get(['gatewayPerformance']);
    const gatewayPerformance = storage.gatewayPerformance || {};

    if (!gatewayPerformance[fqdn]) {
      gatewayPerformance[fqdn] = {
        avgResponseTime: responseTime,
        failures: success ? 0 : 1,
        successCount: success ? 1 : 0,
      };
    } else {
      const prevAvg = gatewayPerformance[fqdn].avgResponseTime || responseTime;
      const alpha = 0.2; // EMA smoothing factor

      // Update EMA for response time
      gatewayPerformance[fqdn].avgResponseTime =
        alpha * responseTime + (1 - alpha) * prevAvg;

      if (success) {
        gatewayPerformance[fqdn].successCount += 1;
      } else {
        gatewayPerformance[fqdn].failures += 1;
      }
    }

    await chrome.storage.local.set({ gatewayPerformance });
    await this.updateGatewayUsageHistory(fqdn);
  }

  async updateGatewayUsageHistory(gatewayFQDN: string) {
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
}
