import { AoGatewayWithAddress } from '@ar.io/sdk/web';
/**
 * WayFinder
 * Copyright (C) 2022-2025 Permanent Data Solutions, Inc. All Rights Reserved.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */
import type { GatewaysProvider } from '@ar.io/wayfinder-core';
import { GatewayRegistry } from '../types';

/**
 * Gateway provider that uses Chrome extension's local storage
 * to provide gateways for the core library's routing strategies.
 * This bridges the existing extension gateway registry with the core library.
 */
export class ChromeStorageGatewayProvider implements GatewaysProvider {
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

    // Filter out blacklisted and unjoined gateways
    const filteredGateways = Object.entries(localGatewayAddressRegistry)
      .filter(
        ([gatewayAddress, gateway]) =>
          !blacklistedGateways.includes(gatewayAddress) &&
          gateway.status === 'joined',
      )
      .map(([, gateway]) => gateway);

    // Convert to URL format expected by core library
    const gateways = filteredGateways.map((gateway) => {
      const { protocol, fqdn, port } = gateway.settings;
      const portSuffix =
        port && port !== (protocol === 'https' ? 443 : 80) ? `:${port}` : '';
      return new URL(`${protocol}://${fqdn}${portSuffix}`);
    });

    // If no gateways are available (registry not synced or empty), provide fallback gateways
    if (gateways.length === 0) {
      console.warn(
        '[ChromeStorageGatewayProvider] No gateways in registry, using fallback gateways',
      );
      return [
        new URL('https://arweave.net'),
        new URL('https://permagate.io'),
        new URL('https://ar-io.dev'),
      ];
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

    // Filter and enrich gateways with performance data
    return Object.entries(localGatewayAddressRegistry)
      .filter(
        ([gatewayAddress, gateway]) =>
          !blacklistedGateways.includes(gatewayAddress) &&
          gateway.status === 'joined',
      )
      .map(([, gateway]) => {
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
  }

  /**
   * Syncs gateway registry from AR.IO network
   */
  async syncGatewayRegistry(): Promise<void> {
    // Trigger the existing sync mechanism
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { message: 'syncGatewayAddressRegistry' },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve(response);
          }
        },
      );
    });
  }
}
