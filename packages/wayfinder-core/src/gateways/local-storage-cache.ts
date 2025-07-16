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
import { GatewaysProvider } from '@ar.io/wayfinder-core';
import { defaultLogger } from '../logger.js';
import type { Logger } from '../types.js';
import { isBrowser } from '../utils/browser.js';

/**
 * Browser-based cache provider for gateways that fetches gateways from a
 * GatewaysProvider and caches them in the browser's localStorage for a given
 * number of seconds.
 *
 * ```ts
 * import { NetworkGatewaysProvider, LocalStorageGatewaysProvider } from '@ar.io/wayfinder-core';
 *
 * // Create your network provider (fetches gateways from the network)
 * const networkProvider = new NetworkGatewaysProvider({ ... });
 *
 * // Wrap with LocalStorageGatewaysProvider for browser caching
 * const cachedProvider = new LocalStorageGatewaysProvider({
 *   gatewaysProvider: networkProvider,
 *   ttlSeconds: 3600, // cache for 1 hour
 * });
 *
 * // Use cachedProvider to get gateways
 * const gateways = await cachedProvider.getGateways();
 * ```
 */
interface CachedGateways {
  gateways: string[];
  timestamp: number;
  expiresAt: number;
  ttlSeconds: number;
}

export class LocalStorageGatewaysProvider implements GatewaysProvider {
  private readonly storageKey = 'wayfinder-gateways-cache';
  private readonly defaultTtlSeconds = 3600; // 1 hour default
  private readonly gatewaysProvider: GatewaysProvider;
  private readonly ttlSeconds: number;
  private readonly logger: Logger;
  private gatewaysPromise: Promise<URL[]> | undefined;

  constructor({
    ttlSeconds = this.defaultTtlSeconds,
    gatewaysProvider,
    logger = defaultLogger,
  }: {
    ttlSeconds?: number;
    gatewaysProvider: GatewaysProvider;
    logger?: Logger;
  }) {
    if (!isBrowser()) {
      throw new Error(
        'LocalStorageGatewaysProvider is only available in browser environments. Consider using SimpleCacheGatewaysProvider for node.js environments.',
      );
    }

    this.gatewaysProvider = gatewaysProvider;
    this.ttlSeconds = ttlSeconds;
    this.gatewaysProvider = gatewaysProvider;
    this.logger = logger;
  }

  async getGateways(): Promise<URL[]> {
    const cached = this.getCachedGateways();

    if (cached && this.isCacheValid(cached)) {
      this.logger?.debug('Using cached gateways', {
        ttlSeconds: this.ttlSeconds,
        timestamp: cached.timestamp,
        expiresAt: cached.expiresAt,
        gateways: cached.gateways.length,
      });
      return cached.gateways.map((gateway) => new URL(gateway));
    }

    // if a promise is already set, return it vs creating a new one
    if (this.gatewaysPromise) {
      return this.gatewaysPromise;
    }

    // set the promise to prevent multiple requests
    this.gatewaysPromise = this.gatewaysProvider.getGateways();
    const gateways = await this.gatewaysPromise;
    this.cacheGateways(gateways);

    // clear the promise for the next request
    this.gatewaysPromise = undefined;
    return gateways;
  }

  private getCachedGateways(): CachedGateways | undefined {
    try {
      if (typeof window === 'undefined' || !window.localStorage) {
        return undefined;
      }

      const cached = window.localStorage.getItem(this.storageKey);
      if (!cached) {
        return undefined;
      }

      return <CachedGateways>JSON.parse(cached);
    } catch (error) {
      this.logger?.warn('Failed to retrieve cached gateways:', error);
      return undefined;
    }
  }

  private isCacheValid(cached: CachedGateways): boolean {
    const now = Date.now();
    const expiresAt = cached.timestamp + cached.ttlSeconds * 1000;
    const gatewaysCount = cached.gateways.length;
    return now < expiresAt && gatewaysCount > 0;
  }

  private cacheGateways(gateways: URL[]): void {
    try {
      if (typeof window === 'undefined' || !window.localStorage) {
        return;
      }

      const cached: CachedGateways = {
        gateways: gateways.map((gateway) => gateway.toString()),
        timestamp: Date.now(),
        expiresAt: Date.now() + this.ttlSeconds * 1000,
        ttlSeconds: this.ttlSeconds,
      };

      window.localStorage.setItem(this.storageKey, JSON.stringify(cached));
    } catch (error) {
      this.logger?.warn('Failed to cache gateways:', error);
    }
  }

  clearCache(): void {
    try {
      if (typeof window === 'undefined' || !window.localStorage) {
        return;
      }

      window.localStorage.removeItem(this.storageKey);
    } catch (error) {
      this.logger?.warn('Failed to clear gateway cache:', error);
    }
  }
}
