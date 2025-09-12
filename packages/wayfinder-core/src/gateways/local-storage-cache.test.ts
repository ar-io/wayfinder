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
import assert from 'node:assert';
import { after, beforeEach, describe, it } from 'node:test';
import type { GatewaysProvider } from '../types.js';
import { LocalStorageGatewaysProvider } from './local-storage-cache.js';

interface MockLocalStorage extends Storage {
  store: Record<string, string>;
}

class MockGatewaysProvider implements GatewaysProvider {
  private gateways: URL[];

  constructor(
    gateways: string[] = ['https://gateway1.com', 'https://gateway2.com'],
  ) {
    this.gateways = gateways.map((url) => new URL(url));
  }

  async getGateways(): Promise<URL[]> {
    return this.gateways;
  }

  setGateways(gateways: string[]): void {
    this.gateways = gateways.map((url) => new URL(url));
  }
}

function setupBrowserEnvironment(): MockLocalStorage {
  const mockLocalStorage: MockLocalStorage = {
    store: {},
    get length(): number {
      return Object.keys(this.store).length;
    },
    getItem: function (key: string): string | null {
      return this.store[key] || null;
    },
    setItem: function (key: string, value: string): void {
      this.store[key] = value;
    },
    removeItem: function (key: string): void {
      delete this.store[key];
    },
    clear: function (): void {
      this.store = {};
    },
    key: function (index: number): string | null {
      const keys = Object.keys(this.store);
      return keys[index] || null;
    },
  };

  global.window = {
    localStorage: mockLocalStorage,
    // @ts-expect-error - Mock global window object
    document: {},
  };

  return mockLocalStorage;
}

function teardownBrowserEnvironment(): void {
  // @ts-expect-error - Remove mock global window object
  delete global.window;
}

describe('LocalStorageGatewaysProvider', () => {
  let mockLocalStorage: MockLocalStorage;
  let mockGatewaysProvider: MockGatewaysProvider;

  beforeEach(() => {
    mockLocalStorage = setupBrowserEnvironment();
    mockGatewaysProvider = new MockGatewaysProvider();
  });

  after(() => {
    teardownBrowserEnvironment();
  });

  describe('constructor', () => {
    it('should initialize with default TTL when not provided', () => {
      const provider = new LocalStorageGatewaysProvider({
        gatewaysProvider: mockGatewaysProvider,
      });

      assert.ok(provider instanceof LocalStorageGatewaysProvider);
    });

    it('should initialize with custom TTL when provided', () => {
      const provider = new LocalStorageGatewaysProvider({
        ttlSeconds: 600,
        gatewaysProvider: mockGatewaysProvider,
      });

      assert.ok(provider instanceof LocalStorageGatewaysProvider);
    });
  });

  it('should throw an error when window is undefined', async () => {
    teardownBrowserEnvironment();

    assert.throws(() => {
      (() => {
        new LocalStorageGatewaysProvider({
          ttlSeconds: 300,
          gatewaysProvider: mockGatewaysProvider,
        });
      })();
    }, /LocalStorageGatewaysProvider is only available in browser environments/);
  });

  describe('getGateways', () => {
    describe('cache hit scenarios', () => {
      it('should return cached gateways when cache is valid', async () => {
        const provider = new LocalStorageGatewaysProvider({
          ttlSeconds: 300,
          gatewaysProvider: mockGatewaysProvider,
        });

        const cachedGateways = {
          gateways: ['https://cached1.com', 'https://cached2.com'],
          timestamp: Date.now(),
          ttlSeconds: 300,
        };

        mockLocalStorage.setItem(
          'wayfinder|gateways',
          JSON.stringify(cachedGateways),
        );

        const result = await provider.getGateways();

        assert.strictEqual(result.length, 2);
        assert.strictEqual(result[0].toString(), 'https://cached1.com/');
        assert.strictEqual(result[1].toString(), 'https://cached2.com/');
      });

      it('should return URLs as URL objects from cache', async () => {
        const provider = new LocalStorageGatewaysProvider({
          ttlSeconds: 300,
          gatewaysProvider: mockGatewaysProvider,
        });

        const cachedGateways = {
          gateways: ['https://example.com'],
          timestamp: Date.now(),
          ttlSeconds: 300,
        };

        mockLocalStorage.setItem(
          'wayfinder|gateways',
          JSON.stringify(cachedGateways),
        );

        const result = await provider.getGateways();

        assert.ok(result[0] instanceof URL);
        assert.strictEqual(result[0].toString(), 'https://example.com/');
      });
    });

    describe('cache miss scenarios', () => {
      it('should fetch from provider when no cache exists', async () => {
        const provider = new LocalStorageGatewaysProvider({
          ttlSeconds: 300,
          gatewaysProvider: mockGatewaysProvider,
        });

        const result = await provider.getGateways();

        assert.strictEqual(result.length, 2);
        assert.strictEqual(result[0].toString(), 'https://gateway1.com/');
        assert.strictEqual(result[1].toString(), 'https://gateway2.com/');

        const cached = mockLocalStorage.getItem('wayfinder|gateways');
        assert.ok(cached);
        const parsedCache = JSON.parse(cached);
        assert.strictEqual(parsedCache.gateways.length, 2);
        assert.strictEqual(parsedCache.ttlSeconds, 300);
      });

      it('should fetch from provider when cache is expired', async () => {
        const provider = new LocalStorageGatewaysProvider({
          ttlSeconds: 300,
          gatewaysProvider: mockGatewaysProvider,
        });

        const expiredCache = {
          gateways: ['https://expired.com'],
          timestamp: Date.now() - 400000, // 400 seconds ago (expired)
          ttlSeconds: 300,
        };

        mockLocalStorage.setItem(
          'wayfinder|gateways',
          JSON.stringify(expiredCache),
        );

        const result = await provider.getGateways();

        assert.strictEqual(result.length, 2);
        assert.strictEqual(result[0].toString(), 'https://gateway1.com/');
        assert.strictEqual(result[1].toString(), 'https://gateway2.com/');
      });

      it('should use default TTL from cache when cache TTL is missing', async () => {
        const provider = new LocalStorageGatewaysProvider({
          ttlSeconds: 300,
          gatewaysProvider: mockGatewaysProvider,
        });

        const cacheWithoutTTL = {
          gateways: ['https://cached.com'],
          timestamp: Date.now() - 3700000, // Older than default TTL (3600s)
        };

        mockLocalStorage.setItem(
          'wayfinder|gateways',
          JSON.stringify(cacheWithoutTTL),
        );

        const result = await provider.getGateways();

        assert.strictEqual(result.length, 2);
        assert.strictEqual(result[0].toString(), 'https://gateway1.com/');
      });
    });

    describe('error handling', () => {
      it('should handle JSON parse errors gracefully', async () => {
        const provider = new LocalStorageGatewaysProvider({
          ttlSeconds: 300,
          gatewaysProvider: mockGatewaysProvider,
        });

        mockLocalStorage.setItem('wayfinder|gateways', 'invalid-json');

        const result = await provider.getGateways();

        assert.strictEqual(result.length, 2);
        assert.strictEqual(result[0].toString(), 'https://gateway1.com/');
      });

      it('should handle localStorage getItem errors', async () => {
        const provider = new LocalStorageGatewaysProvider({
          ttlSeconds: 300,
          gatewaysProvider: mockGatewaysProvider,
        });

        mockLocalStorage.getItem = () => {
          throw new Error('Storage error');
        };

        const result = await provider.getGateways();

        assert.strictEqual(result.length, 2);
        assert.strictEqual(result[0].toString(), 'https://gateway1.com/');
      });

      it('should handle localStorage setItem errors gracefully', async () => {
        const provider = new LocalStorageGatewaysProvider({
          ttlSeconds: 300,
          gatewaysProvider: mockGatewaysProvider,
        });

        mockLocalStorage.setItem = () => {
          throw new Error('Storage quota exceeded');
        };

        const result = await provider.getGateways();

        assert.strictEqual(result.length, 2);
        assert.strictEqual(result[0].toString(), 'https://gateway1.com/');
      });
    });
  });

  describe('clearCache', () => {
    it('should remove cache from localStorage', () => {
      const provider = new LocalStorageGatewaysProvider({
        ttlSeconds: 300,
        gatewaysProvider: mockGatewaysProvider,
      });

      const cachedGateways = {
        gateways: ['https://cached.com'],
        timestamp: Date.now(),
        ttlSeconds: 300,
      };

      mockLocalStorage.setItem(
        'wayfinder|gateways',
        JSON.stringify(cachedGateways),
      );

      assert.ok(mockLocalStorage.getItem('wayfinder|gateways'));

      provider.clearCache();

      assert.strictEqual(
        mockLocalStorage.getItem('wayfinder|gateways'),
        null,
      );
    });

    it('should handle localStorage removeItem errors gracefully', () => {
      const provider = new LocalStorageGatewaysProvider({
        ttlSeconds: 300,
        gatewaysProvider: mockGatewaysProvider,
      });

      mockLocalStorage.removeItem = () => {
        throw new Error('Storage error');
      };

      assert.doesNotThrow(() => {
        provider.clearCache();
      });
    });
  });

  describe('cache validation', () => {
    it('should consider cache valid when within TTL', async () => {
      const provider = new LocalStorageGatewaysProvider({
        ttlSeconds: 300,
        gatewaysProvider: mockGatewaysProvider,
      });

      const recentCache = {
        gateways: ['https://recent.com'],
        timestamp: Date.now() - 100000, // 100 seconds ago
        ttlSeconds: 300,
      };

      mockLocalStorage.setItem(
        'wayfinder|gateways',
        JSON.stringify(recentCache),
      );

      const result = await provider.getGateways();

      assert.strictEqual(result[0].toString(), 'https://recent.com/');
    });

    it('should consider cache invalid when beyond TTL', async () => {
      const provider = new LocalStorageGatewaysProvider({
        ttlSeconds: 300,
        gatewaysProvider: mockGatewaysProvider,
      });

      const oldCache = {
        gateways: ['https://old.com'],
        timestamp: Date.now() - 400000, // 400 seconds ago
        ttlSeconds: 300,
      };

      mockLocalStorage.setItem(
        'wayfinder|gateways',
        JSON.stringify(oldCache),
      );

      const result = await provider.getGateways();

      assert.strictEqual(result[0].toString(), 'https://gateway1.com/');
    });

    it('should handle edge case when cache timestamp equals current time', async () => {
      const provider = new LocalStorageGatewaysProvider({
        ttlSeconds: 300,
        gatewaysProvider: mockGatewaysProvider,
      });

      const currentTime = Date.now();
      const exactCache = {
        gateways: ['https://exact.com'],
        timestamp: currentTime,
        ttlSeconds: 300,
      };

      mockLocalStorage.setItem(
        'wayfinder|gateways',
        JSON.stringify(exactCache),
      );

      const result = await provider.getGateways();

      assert.strictEqual(result[0].toString(), 'https://exact.com/');
    });
  });

  describe('integration scenarios', () => {
    it('should cache results after fetching from provider', async () => {
      const provider = new LocalStorageGatewaysProvider({
        ttlSeconds: 600,
        gatewaysProvider: mockGatewaysProvider,
      });

      await provider.getGateways();

      const cached = mockLocalStorage.getItem('wayfinder|gateways');
      assert.ok(cached);

      const parsedCache = JSON.parse(cached);
      assert.strictEqual(parsedCache.gateways.length, 2);
      assert.strictEqual(parsedCache.gateways[0], 'https://gateway1.com/');
      assert.strictEqual(parsedCache.gateways[1], 'https://gateway2.com/');
      assert.strictEqual(parsedCache.ttlSeconds, 600);
      assert.ok(typeof parsedCache.timestamp === 'number');
    });

    it('should only call gatewayProvider.getGateways once when called multiple times with no cache', async () => {
      let callCount = 0;
      const mockProvider = {
        async getGateways(): Promise<URL[]> {
          callCount++;
          // Simulate async operation
          return new Promise((resolve) => {
            setTimeout(() => {
              resolve([
                new URL('https://gateway1.com'),
                new URL('https://gateway2.com'),
              ]);
            }, 50);
          });
        },
      };

      const provider = new LocalStorageGatewaysProvider({
        ttlSeconds: 300,
        gatewaysProvider: mockProvider,
      });

      // Make multiple concurrent calls when no cache exists
      const promises = [
        provider.getGateways(),
        provider.getGateways(),
        provider.getGateways(),
      ];

      const results = await Promise.all(promises);

      // Verify all results are the same
      assert.strictEqual(results.length, 3);
      results.forEach((result) => {
        assert.strictEqual(result.length, 2);
        assert.strictEqual(result[0].toString(), 'https://gateway1.com/');
        assert.strictEqual(result[1].toString(), 'https://gateway2.com/');
      });

      // Most importantly, verify the underlying provider was only called once
      assert.strictEqual(
        callCount,
        1,
        'gatewayProvider.getGateways should only be called once',
      );
    });

    it('should work with different gateway providers', async () => {
      const customProvider = new MockGatewaysProvider([
        'https://custom1.com',
        'https://custom2.com',
        'https://custom3.com',
      ]);

      const provider = new LocalStorageGatewaysProvider({
        ttlSeconds: 300,
        gatewaysProvider: customProvider,
      });

      const result = await provider.getGateways();

      assert.strictEqual(result.length, 3);
      assert.strictEqual(result[0].toString(), 'https://custom1.com/');
      assert.strictEqual(result[1].toString(), 'https://custom2.com/');
      assert.strictEqual(result[2].toString(), 'https://custom3.com/');
    });

    it('should maintain separate cache instances', async () => {
      const provider1 = new LocalStorageGatewaysProvider({
        ttlSeconds: 300,
        gatewaysProvider: mockGatewaysProvider,
      });

      const provider2 = new LocalStorageGatewaysProvider({
        ttlSeconds: 600,
        gatewaysProvider: new MockGatewaysProvider(['https://different.com']),
      });

      await provider1.getGateways();
      provider1.clearCache();

      const result2 = await provider2.getGateways();
      assert.strictEqual(result2[0].toString(), 'https://different.com/');
    });
  });
});
