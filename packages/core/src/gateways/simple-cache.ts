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
import type { GatewaysProvider, Logger } from '../types.js';

export class SimpleCacheGatewaysProvider implements GatewaysProvider {
  private gatewaysProvider: GatewaysProvider;
  private ttlSeconds: number;
  private lastUpdated: number;
  private gatewaysCache: URL[];
  private logger: Logger;

  constructor({
    gatewaysProvider,
    ttlSeconds = 60 * 60, // 1 hour
    logger = defaultLogger,
  }: {
    gatewaysProvider: GatewaysProvider;
    ttlSeconds?: number;
    logger?: Logger;
  }) {
    this.gatewaysCache = [];
    this.gatewaysProvider = gatewaysProvider;
    this.ttlSeconds = ttlSeconds;
    this.lastUpdated = 0;
    this.logger = logger;
  }

  async getGateways(params?: { path?: string; subdomain?: string }): Promise<
    URL[]
  > {
    const now = Date.now();
    if (
      this.gatewaysCache.length === 0 ||
      now - this.lastUpdated > this.ttlSeconds * 1000
    ) {
      try {
        this.logger.debug('Cache expired, fetching new gateways', {
          cacheAge: now - this.lastUpdated,
          ttlSeconds: this.ttlSeconds,
        });

        // preserve the cache if the fetch fails
        const allGateways = await this.gatewaysProvider.getGateways(params);
        this.gatewaysCache = allGateways;
        this.lastUpdated = now;

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
        cacheAge: now - this.lastUpdated,
        ttlSeconds: this.ttlSeconds,
        gatewayCount: this.gatewaysCache.length,
      });
    }
    return this.gatewaysCache;
  }
}
