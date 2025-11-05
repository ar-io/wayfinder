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
import { describe, it } from 'node:test';
import { createWayfinderClient } from './client.js';
import { SimpleCacheGatewaysProvider } from './gateways/simple-cache.js';
import { RandomRoutingStrategy } from './routing/random.js';

describe('createWayfinderClient', () => {
  it('should create a Wayfinder instance with default settings', () => {
    const wayfinder = createWayfinderClient();

    assert(wayfinder);
    assert(wayfinder.routingSettings);
    assert(wayfinder.routingSettings.strategy);
  });

  it('should use caching by default in Node.js environment', () => {
    const wayfinder = createWayfinderClient();

    // Check that the routing strategy is RandomRoutingStrategy
    assert(wayfinder.routingSettings.strategy instanceof RandomRoutingStrategy);

    // Access the gateways provider through the routing strategy
    const routingStrategy = wayfinder.routingSettings
      .strategy as RandomRoutingStrategy;
    // @ts-expect-error accessing protected member
    assert(routingStrategy.gatewaysProvider);

    // Verify it's using the cached provider
    // @ts-expect-error accessing protected member
    assert(
      routingStrategy.gatewaysProvider instanceof SimpleCacheGatewaysProvider,
    );
  });

  it('should accept custom fetch implementation', () => {
    const customFetch = async () => {
      return new Response('custom');
    };

    const wayfinder = createWayfinderClient({
      fetch: customFetch as typeof fetch,
    });

    assert(wayfinder);
  });

  it('should accept custom routing settings', () => {
    const customStrategy = new RandomRoutingStrategy();

    const wayfinder = createWayfinderClient({
      routingSettings: {
        strategy: customStrategy,
      },
    });

    assert.strictEqual(wayfinder.routingSettings.strategy, customStrategy);
  });

  it('should accept verification settings', () => {
    const wayfinder = createWayfinderClient({
      verificationSettings: {
        enabled: true,
        strict: true,
      },
    });

    assert.strictEqual(wayfinder.verificationSettings.enabled, true);
    assert.strictEqual(wayfinder.verificationSettings.strict, true);
  });

  it('should accept telemetry settings', () => {
    const wayfinder = createWayfinderClient({
      telemetrySettings: {
        enabled: true,
        sampleRate: 0.5,
      },
    });

    assert.strictEqual(wayfinder.telemetrySettings.enabled, true);
    assert.strictEqual(wayfinder.telemetrySettings.sampleRate, 0.5);
  });
});
