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
