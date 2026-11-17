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
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import type { RoutingStrategy } from '../types.js';
import { SimpleCacheRoutingStrategy } from './simple-cache.js';

describe('SimpleCacheRoutingStrategy', () => {
  let mockStrategy: RoutingStrategy;
  let callCount: number;
  let gatewayToReturn: URL;

  beforeEach(() => {
    callCount = 0;
    gatewayToReturn = new URL('https://example.com');

    mockStrategy = {
      async selectGateway() {
        callCount++;
        return gatewayToReturn;
      },
    };
  });

  it('should cache gateway for subsequent calls', async () => {
    const strategy = new SimpleCacheRoutingStrategy({
      routingStrategy: mockStrategy,
      ttlSeconds: 3600,
    });

    const params = { gateways: [gatewayToReturn] };

    const result1 = await strategy.selectGateway(params);
    const result2 = await strategy.selectGateway(params);

    assert.equal(result1.toString(), gatewayToReturn.toString());
    assert.equal(result2.toString(), gatewayToReturn.toString());
    assert.equal(callCount, 1, 'Should only call underlying strategy once');
  });

  it('should refresh cache when TTL expires', async () => {
    const strategy = new SimpleCacheRoutingStrategy({
      routingStrategy: mockStrategy,
      ttlSeconds: 0.1, // 100ms
    });

    const params = { gateways: [gatewayToReturn] };

    await strategy.selectGateway(params);
    assert.equal(callCount, 1);

    // Wait for cache to expire
    await new Promise((resolve) => setTimeout(resolve, 150));

    await strategy.selectGateway(params);
    assert.equal(
      callCount,
      2,
      'Should call underlying strategy again after TTL expires',
    );
  });

  it('should handle errors by returning cached gateway if available', async () => {
    const strategy = new SimpleCacheRoutingStrategy({
      routingStrategy: mockStrategy,
      ttlSeconds: 0.1,
    });

    const params = { gateways: [gatewayToReturn] };

    // First call succeeds and caches
    const result1 = await strategy.selectGateway(params);
    assert.equal(result1.toString(), gatewayToReturn.toString());

    // Wait for cache to expire
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Make underlying strategy throw error
    mockStrategy.selectGateway = async () => {
      callCount++;
      throw new Error('Gateway selection failed');
    };

    // Should return cached gateway despite error
    const result2 = await strategy.selectGateway(params);
    assert.equal(result2.toString(), gatewayToReturn.toString());
  });

  it('should throw error when no cached gateway and selection fails', async () => {
    mockStrategy.selectGateway = async () => {
      callCount++;
      throw new Error('Gateway selection failed');
    };

    const strategy = new SimpleCacheRoutingStrategy({
      routingStrategy: mockStrategy,
    });

    const params = { gateways: [gatewayToReturn] };

    await assert.rejects(
      async () => await strategy.selectGateway(params),
      /Gateway selection failed/,
    );
  });

  it('should handle concurrent requests', async () => {
    let resolvePromise: (value: URL) => void;
    const gatewayPromise = new Promise<URL>((resolve) => {
      resolvePromise = resolve;
    });

    mockStrategy.selectGateway = async () => {
      callCount++;
      return gatewayPromise;
    };

    const strategy = new SimpleCacheRoutingStrategy({
      routingStrategy: mockStrategy,
    });

    const params = { gateways: [gatewayToReturn] };

    // Start multiple concurrent requests
    const promise1 = strategy.selectGateway(params);
    const promise2 = strategy.selectGateway(params);
    const promise3 = strategy.selectGateway(params);

    // Resolve the underlying promise
    resolvePromise!(gatewayToReturn);

    const [result1, result2, result3] = await Promise.all([
      promise1,
      promise2,
      promise3,
    ]);

    assert.equal(result1.toString(), gatewayToReturn.toString());
    assert.equal(result2.toString(), gatewayToReturn.toString());
    assert.equal(result3.toString(), gatewayToReturn.toString());
    assert.equal(
      callCount,
      1,
      'Should only call underlying strategy once for concurrent requests',
    );
  });
});

describe('SimpleCacheRoutingStrategy exclude', () => {
  it('bypasses an excluded cached gateway and caches the new pick', async () => {
    const received: (URL[] | undefined)[] = [];
    const picks = [new URL('https://first.com'), new URL('https://second.com')];
    let call = 0;
    const cache = new SimpleCacheRoutingStrategy({
      routingStrategy: {
        async selectGateway(params) {
          received.push(params.exclude);
          return picks[call++];
        },
      },
      ttlSeconds: 60,
    });

    assert.equal(
      (await cache.selectGateway({})).toString(),
      'https://first.com/',
    );

    const exclude = [new URL('https://first.com')];
    assert.equal(
      (await cache.selectGateway({ exclude })).toString(),
      'https://second.com/',
    );
    assert.deepEqual(received[1], exclude);

    // the new pick is cached
    assert.equal(
      (await cache.selectGateway({})).toString(),
      'https://second.com/',
    );
    assert.equal(call, 2);
  });

  it('keeps serving the cache when the cached gateway is not excluded', async () => {
    let call = 0;
    const cache = new SimpleCacheRoutingStrategy({
      routingStrategy: {
        async selectGateway() {
          call++;
          return new URL('https://cached.com');
        },
      },
    });
    await cache.selectGateway({});
    await cache.selectGateway({ exclude: [new URL('https://other.com')] });
    assert.equal(call, 1);
  });

  it('does not hand back an excluded gateway from an in-flight selection', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let call = 0;
    const cache = new SimpleCacheRoutingStrategy({
      routingStrategy: {
        async selectGateway(params) {
          call++;
          if (call === 1) {
            await gate;
            return new URL('https://failed.com');
          }
          assert.deepEqual(
            params.exclude?.map((g) => g.toString()),
            ['https://failed.com/'],
          );
          return new URL('https://other.com');
        },
      },
    });

    const first = cache.selectGateway({});
    const second = cache.selectGateway({
      exclude: [new URL('https://failed.com')],
    });
    release();

    assert.equal((await first).toString(), 'https://failed.com/');
    assert.equal((await second).toString(), 'https://other.com/');
    assert.equal(call, 2);
  });

  it('shares an in-flight selection that is not excluded', async () => {
    let call = 0;
    const cache = new SimpleCacheRoutingStrategy({
      routingStrategy: {
        async selectGateway() {
          call++;
          await new Promise((resolve) => setTimeout(resolve, 10));
          return new URL('https://ok.com');
        },
      },
    });

    const [a, b] = await Promise.all([
      cache.selectGateway({}),
      cache.selectGateway({ exclude: [new URL('https://failed.com')] }),
    ]);
    assert.equal(a.toString(), 'https://ok.com/');
    assert.equal(b.toString(), 'https://ok.com/');
    assert.equal(call, 1);
  });
});
