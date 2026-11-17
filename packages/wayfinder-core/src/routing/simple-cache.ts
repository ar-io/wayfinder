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
import type { Logger, RoutingStrategy } from '../types.js';
import { isExcluded } from './exclude.js';

export class SimpleCacheRoutingStrategy implements RoutingStrategy {
  public readonly name = 'simple-cache';
  private routingStrategy: RoutingStrategy;
  private ttlSeconds: number;
  private lastUpdated: number;
  private cachedGateway: URL | undefined;
  private logger: Logger;
  private gatewayPromise: Promise<URL> | undefined;

  constructor({
    routingStrategy,
    ttlSeconds = 60 * 5, // 5 minutes
    logger = defaultLogger,
  }: {
    routingStrategy: RoutingStrategy;
    ttlSeconds?: number;
    logger?: Logger;
  }) {
    this.routingStrategy = routingStrategy;
    this.ttlSeconds = ttlSeconds;
    this.lastUpdated = 0;
    this.logger = logger;
  }

  private isCacheValid(): boolean {
    return (
      Date.now() < this.lastUpdated + this.ttlSeconds * 1000 &&
      this.cachedGateway !== undefined
    );
  }

  async selectGateway(params: {
    gateways?: URL[];
    path?: string;
    subdomain?: string;
    exclude?: URL[];
  }): Promise<URL> {
    const now = Date.now();

    /**
     * A cached gateway that already failed this request is bypassed: the
     * wrapped strategy is asked again, with `exclude` passed through, and its
     * pick replaces the cache entry.
     */
    const cachedIsExcluded =
      this.cachedGateway !== undefined &&
      isExcluded(this.cachedGateway, params.exclude);

    if (this.isCacheValid() && !cachedIsExcluded) {
      this.logger.debug('Using cached gateway', {
        cacheAge: now - this.lastUpdated,
        ttlSeconds: this.ttlSeconds,
        cachedGateway: this.cachedGateway?.toString(),
      });
      return this.cachedGateway!;
    }

    /**
     * Share an in-flight selection so concurrent callers do not each hit the
     * wrapped strategy. A caller with an `exclude` list only shares it when
     * the pending result is not one of its excluded gateways. While it
     * waited, another excluding caller may have started a replacement
     * selection, so it rechecks the shared promise (and the cache) before
     * running its own selection below.
     */
    const awaited = new Set<Promise<URL>>();
    let pending = this.gatewayPromise;
    while (pending !== undefined && !awaited.has(pending)) {
      awaited.add(pending);
      if (!params.exclude || params.exclude.length === 0) {
        return pending;
      }
      const pendingGateway = await pending.catch(() => undefined);
      if (pendingGateway && !isExcluded(pendingGateway, params.exclude)) {
        return pendingGateway;
      }
      pending = this.gatewayPromise;
    }
    if (
      awaited.size > 0 &&
      this.isCacheValid() &&
      !isExcluded(this.cachedGateway!, params.exclude)
    ) {
      return this.cachedGateway!;
    }

    let selection: Promise<URL> | undefined;
    try {
      this.logger.debug(
        cachedIsExcluded
          ? 'Cached gateway is excluded, selecting new gateway'
          : 'Cache expired, selecting new gateway',
        {
          cacheAge: now - this.lastUpdated,
          ttlSeconds: this.ttlSeconds,
        },
      );

      // set the promise to prevent multiple requests to the routingStrategy
      selection = this.routingStrategy.selectGateway(params);
      this.gatewayPromise = selection;
      const selectedGateway = await selection;

      // update the cache; the TTL starts when the result arrives, not when
      // this call began, since the selection itself can take a while
      this.cachedGateway = selectedGateway;
      this.lastUpdated = Date.now();

      this.logger.debug('Updated gateway cache', {
        selectedGateway: selectedGateway.toString(),
      });
    } catch (error: any) {
      this.logger.error('Failed to select gateway', {
        error: error.message,
        stack: error.stack,
      });
      // If we have a cached gateway, return it even if expired
      if (this.cachedGateway === undefined) {
        this.logger.warn(
          'Returning expired cached gateway due to selection failure',
        );
        throw error;
      }
      // if we have a cached gateway, return it even if expired
      this.logger.warn(
        'Returning expired cached gateway due to selection failure',
      );
    } finally {
      // only clear the promise this call set; a concurrent call may have
      // replaced it with its own selection
      if (this.gatewayPromise === selection) {
        this.gatewayPromise = undefined;
      }
    }

    return this.cachedGateway;
  }
}
