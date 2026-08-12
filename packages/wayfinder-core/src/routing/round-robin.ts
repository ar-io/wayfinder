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
import type { GatewaysProvider, Logger, RoutingStrategy } from '../types.js';

export class RoundRobinRoutingStrategy implements RoutingStrategy {
  public readonly name = 'round-robin';
  private gateways: URL[];
  private currentIndex: number;
  private logger: Logger;
  private gatewaysProvider?: GatewaysProvider;

  constructor({
    gateways,
    logger = defaultLogger,
    gatewaysProvider,
  }: {
    gateways?: URL[];
    logger?: Logger;
    gatewaysProvider?: GatewaysProvider;
  } = {}) {
    if (gateways && gatewaysProvider) {
      throw new Error('Cannot provide both gateways and gatewaysProvider');
    }
    if (!gateways && !gatewaysProvider) {
      gateways = [
        new URL('https://turbo-gateway.com'),
        new URL('https://g8way.io'),
      ];
    }

    this.gateways = gateways || [];
    this.currentIndex = 0;
    this.logger = logger;
    this.gatewaysProvider = gatewaysProvider;
  }

  /**
   * Resolves the pool to cycle over.
   *
   * A provider is consulted on every selection rather than once. Caching is the
   * provider layer's job — `SimpleCacheGatewaysProvider` and
   * `LocalStorageGatewaysProvider` exist for exactly that, and their TTL is
   * meaningless if this strategy never asks again. Holding the first result
   * forever also means a list that narrows (a gateway blacklisted, or one that
   * starts failing epochs) is never picked up for the life of the instance.
   */
  private async resolvePool(): Promise<URL[]> {
    if (this.gatewaysProvider) {
      return this.gatewaysProvider.getGateways();
    }
    return this.gateways;
  }

  async selectGateway({
    gateways,
  }: {
    gateways?: URL[];
  } = {}): Promise<URL> {
    /**
     * Precedence: a list pinned at construction, then a list supplied by the
     * caller, then the provider.
     *
     * Pinning a list at construction is a hard configuration and keeps winning
     * — that is long-standing behaviour and is asserted by the tests below.
     * When this strategy is provider-backed, though, a caller-supplied list is
     * honoured, as the `RoutingStrategy` interface advertises. Ignoring it
     * outright is what made this strategy behave differently from
     * `RandomRoutingStrategy` under the same wrapper.
     */
    const pool = this.gatewaysProvider
      ? (gateways ?? (await this.resolvePool()))
      : await this.resolvePool();

    if (pool.length === 0) {
      throw new Error('No gateways available');
    }

    // Modulo the current pool length so the cursor stays valid even when the
    // pool changes size between selections.
    const gateway = pool[this.currentIndex % pool.length];
    this.logger.debug('Selecting gateway', {
      gateway: gateway.toString(),
      currentIndex: this.currentIndex % pool.length,
      totalGateways: pool.length,
    });
    this.currentIndex = (this.currentIndex + 1) % pool.length;
    return gateway;
  }
}
