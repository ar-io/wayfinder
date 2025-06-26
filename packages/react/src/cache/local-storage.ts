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

interface CachedGateways {
  gateways: URL[];
  timestamp: number;
  ttlSeconds: number;
}

export class LocalStorageGatewaysProvider implements GatewaysProvider {
  private readonly storageKey = 'wayfinder-gateways-cache';
  private readonly defaultTtlSeconds = 3600; // 1 hour default
  private readonly gatewaysProvider: GatewaysProvider;
  private readonly ttlSeconds: number;

  constructor({
    ttlSeconds = 300,
    gatewaysProvider,
  }: {
    ttlSeconds?: number;
    gatewaysProvider: GatewaysProvider;
  }) {
    this.gatewaysProvider = gatewaysProvider;
    this.ttlSeconds = ttlSeconds;
    this.gatewaysProvider = gatewaysProvider;
  }

  async getGateways(): Promise<URL[]> {
    const cached = this.getCachedGateways();

    if (cached && this.isCacheValid(cached)) {
      return cached.gateways;
    }

    const gateways = await this.gatewaysProvider.getGateways();
    this.cacheGateways(gateways);

    return gateways;
  }

  private getCachedGateways(): CachedGateways | null {
    try {
      if (typeof window === 'undefined' || !window.localStorage) {
        return null;
      }

      const cached = window.localStorage.getItem(this.storageKey);
      if (!cached) {
        return null;
      }

      return JSON.parse(cached) as CachedGateways;
    } catch (error) {
      console.warn('Failed to retrieve cached gateways:', error);
      return null;
    }
  }

  private isCacheValid(cached: CachedGateways): boolean {
    const now = Date.now();
    const cacheAge = now - cached.timestamp;
    const ttlMs = (cached.ttlSeconds || this.defaultTtlSeconds) * 1000;

    return cacheAge < ttlMs;
  }

  private cacheGateways(gateways: URL[]): void {
    try {
      if (typeof window === 'undefined' || !window.localStorage) {
        return;
      }

      const cached: CachedGateways = {
        gateways,
        timestamp: Date.now(),
        ttlSeconds: this.ttlSeconds,
      };

      window.localStorage.setItem(this.storageKey, JSON.stringify(cached));
    } catch (error) {
      console.warn('Failed to cache gateways:', error);
    }
  }

  clearCache(): void {
    try {
      if (typeof window === 'undefined' || !window.localStorage) {
        return;
      }

      window.localStorage.removeItem(this.storageKey);
    } catch (error) {
      console.warn('Failed to clear gateway cache:', error);
    }
  }
}
