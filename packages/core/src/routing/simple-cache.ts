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
import type { Logger, RoutingStrategy } from '../types.js';
import { defaultLogger } from '../logger.js';

export class SimpleCacheRoutingStrategy implements RoutingStrategy {
  public readonly name = 'simple-cache';
  private routingStrategy: RoutingStrategy;
  private ttlSeconds: number;
  private lastUpdated: number;
  private cachedGateway: URL | null;
  private logger: Logger;

  constructor({
    routingStrategy,
    ttlSeconds = 60 * 60, // 1 hour
    logger = defaultLogger,
  }: {
    routingStrategy: RoutingStrategy;
    ttlSeconds?: number;
    logger?: Logger;
  }) {
    this.routingStrategy = routingStrategy;
    this.ttlSeconds = ttlSeconds;
    this.lastUpdated = 0;
    this.cachedGateway = null;
    this.logger = logger;
  }

  async selectGateway(params: {
    gateways: URL[];
    path?: string;
    subdomain?: string;
  }): Promise<URL> {
    const now = Date.now();
    if (
      this.cachedGateway === null ||
      now - this.lastUpdated > this.ttlSeconds * 1000
    ) {
      try {
        this.logger.debug('Cache expired, selecting new gateway', {
          cacheAge: now - this.lastUpdated,
          ttlSeconds: this.ttlSeconds,
        });

        // preserve the cache if the selection fails
        const selectedGateway =
          await this.routingStrategy.selectGateway(params);
        this.cachedGateway = selectedGateway;
        this.lastUpdated = now;

        this.logger.debug('Updated gateway cache', {
          selectedGateway: selectedGateway.toString(),
        });
      } catch (error: any) {
        this.logger.error('Failed to select gateway', {
          error: error.message,
          stack: error.stack,
        });
        // If we have a cached gateway, return it even if expired
        if (this.cachedGateway !== null) {
          this.logger.warn(
            'Returning expired cached gateway due to selection failure',
          );
          return this.cachedGateway;
        }
        throw error;
      }
    } else {
      this.logger.debug('Using cached gateway', {
        cacheAge: now - this.lastUpdated,
        ttlSeconds: this.ttlSeconds,
        cachedGateway: this.cachedGateway.toString(),
      });
    }
    return this.cachedGateway!;
  }
}
