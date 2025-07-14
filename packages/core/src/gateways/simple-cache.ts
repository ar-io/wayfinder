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
import { defaultLogger } from '../logger.js';
import type { GatewaysProvider, Logger } from '../types.js';

/**
 * Simple in-memory cache provider for gateways that fetches gateways from a
 * GatewaysProvider and caches them for a given number of seconds. Ideal for
 * node.js environments where you want to cache gateways for a given number of
 * seconds and avoid rate limiting. If you are in a browser environment,
 * consider using LocalStorageGatewaysProvider instead.
 *
 * ```ts
 * import { NetworkGatewaysProvider, SimpleCacheGatewaysProvider } from '@ar.io/wayfinder-core';
 *
 * // Create your network provider (fetches gateways from the network)
 * const networkProvider = new NetworkGatewaysProvider({ ... });
 *
 * // Wrap with SimpleCacheGatewaysProvider for caching
 * const cachedProvider = new SimpleCacheGatewaysProvider({
 *   gatewaysProvider: networkProvider,
 *   ttlSeconds: 3600, // cache for 1 hour
 * });
 *
 * // Use cachedProvider to get gateways
 * const gateways = await cachedProvider.getGateways();
 * ```
 */
export class SimpleCacheGatewaysProvider implements GatewaysProvider {
  private gatewaysProvider: GatewaysProvider;
  private defaultTtlSeconds = 3600; // 1 hour default
  private ttlSeconds: number;
  private expiresAt: number;
  private gatewaysCache: URL[];
  private logger: Logger;

  constructor({
    gatewaysProvider,
    ttlSeconds = this.defaultTtlSeconds,
    logger = defaultLogger,
  }: {
    gatewaysProvider: GatewaysProvider;
    ttlSeconds?: number;
    logger?: Logger;
  }) {
    this.gatewaysCache = [];
    this.gatewaysProvider = gatewaysProvider;
    this.ttlSeconds = ttlSeconds;
    this.expiresAt = 0;
    this.logger = logger;
  }

  async getGateways(params?: { path?: string; subdomain?: string }): Promise<
    URL[]
  > {
    if (this.isCacheValid()) {
      try {
        this.logger.debug('Cache expired, fetching new gateways', {
          expiresAt: this.expiresAt,
          ttlSeconds: this.ttlSeconds,
        });

        // preserve the cache if the fetch fails
        const allGateways = await this.gatewaysProvider.getGateways(params);
        this.gatewaysCache = allGateways;
        this.expiresAt = Date.now() + this.ttlSeconds * 1000;

        this.logger.debug('Updated gateways cache', {
          gatewayCount: allGateways.length,
        });
      } catch (error: any) {
        this.logger.error('Failed to fetch gateways', {
          error: error.message,
          stack: error.stack,
        });
      }
    } else {
      this.logger.debug('Using cached gateways', {
        expiresAt: this.expiresAt,
        ttlSeconds: this.ttlSeconds,
        gatewayCount: this.gatewaysCache.length,
      });
    }
    return this.gatewaysCache;
  }

  private isCacheValid(): boolean {
    return Date.now() < this.expiresAt && this.gatewaysCache.length > 0;
  }
}
