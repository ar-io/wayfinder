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

/**
 * Every routing strategy, driven end to end against live gateways.
 *
 * The existing integration suite only ever exercised RandomRoutingStrategy
 * over a stubbed single-gateway provider, so strategy-specific behaviour
 * (HEAD probing, caching, fallback) was never run against a real network.
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';
import { createWayfinderClient } from '../client.js';
import { StaticGatewaysProvider } from '../gateways/static.js';
import { CompositeRoutingStrategy } from '../routing/composite.js';
import {
  FastestPingRoutingStrategy,
  PingRoutingStrategy,
} from '../routing/ping.js';
import { PreferredWithFallbackRoutingStrategy } from '../routing/preferred-with-fallback.js';
import { RandomRoutingStrategy } from '../routing/random.js';
import { RoundRobinRoutingStrategy } from '../routing/round-robin.js';
import { SimpleCacheRoutingStrategy } from '../routing/simple-cache.js';
import { StaticRoutingStrategy } from '../routing/static.js';
import type { RoutingStrategy } from '../types.js';
import { Wayfinder } from '../wayfinder.js';
import {
  E2E_TIMEOUT_MS,
  FALLBACK_GATEWAYS,
  FIXTURES,
  TRUSTED_GATEWAY,
  drain,
  quietLogger,
} from './fixtures.js';

const POOL = [TRUSTED_GATEWAY, ...FALLBACK_GATEWAYS];
const gatewaysProvider = () =>
  new StaticGatewaysProvider({ gateways: POOL, logger: quietLogger });

/** Runs a real ar:// request through the given strategy. */
async function fetchThrough(strategy: RoutingStrategy): Promise<Response> {
  const wayfinder = new Wayfinder({
    logger: quietLogger,
    routingSettings: { strategy },
  });
  return wayfinder.request(`ar://${FIXTURES.bundledDataItem.id}`);
}

describe('e2e: routing strategies', { timeout: E2E_TIMEOUT_MS }, () => {
  const strategies: Array<[string, () => RoutingStrategy]> = [
    [
      'RandomRoutingStrategy',
      () =>
        new RandomRoutingStrategy({
          gatewaysProvider: gatewaysProvider(),
          logger: quietLogger,
        }),
    ],
    [
      'RoundRobinRoutingStrategy',
      () =>
        new RoundRobinRoutingStrategy({
          gatewaysProvider: gatewaysProvider(),
          logger: quietLogger,
        }),
    ],
    [
      'StaticRoutingStrategy',
      () =>
        new StaticRoutingStrategy({
          gateway: TRUSTED_GATEWAY,
          logger: quietLogger,
        }),
    ],
    [
      'FastestPingRoutingStrategy',
      () =>
        new FastestPingRoutingStrategy({
          gatewaysProvider: gatewaysProvider(),
          logger: quietLogger,
        }),
    ],
    [
      'PingRoutingStrategy',
      () =>
        new PingRoutingStrategy({
          routingStrategy: new RandomRoutingStrategy({
            gatewaysProvider: gatewaysProvider(),
            logger: quietLogger,
          }),
          gatewaysProvider: gatewaysProvider(),
          logger: quietLogger,
        }),
    ],
    [
      'PreferredWithFallbackRoutingStrategy',
      () =>
        new PreferredWithFallbackRoutingStrategy({
          preferredGateway: TRUSTED_GATEWAY,
          fallbackStrategy: new RandomRoutingStrategy({
            gatewaysProvider: gatewaysProvider(),
            logger: quietLogger,
          }),
          logger: quietLogger,
        }),
    ],
    [
      'SimpleCacheRoutingStrategy',
      () =>
        new SimpleCacheRoutingStrategy({
          routingStrategy: new RandomRoutingStrategy({
            gatewaysProvider: gatewaysProvider(),
            logger: quietLogger,
          }),
          logger: quietLogger,
        }),
    ],
    [
      'CompositeRoutingStrategy',
      () =>
        new CompositeRoutingStrategy({
          strategies: [
            new StaticRoutingStrategy({
              gateway: TRUSTED_GATEWAY,
              logger: quietLogger,
            }),
          ],
          logger: quietLogger,
        }),
    ],
  ];

  for (const [name, build] of strategies) {
    it(`${name} routes an ar:// request to a working gateway`, async () => {
      const response = await fetchThrough(build());
      const bytes = await drain(response);

      assert.strictEqual(response.status, 200, `${name} returned non-200`);
      assert.strictEqual(
        bytes,
        FIXTURES.bundledDataItem.size,
        `${name} returned ${bytes} bytes, expected ${FIXTURES.bundledDataItem.size}`,
      );
    });
  }

  /**
   * The zero-argument constructor is the first thing anyone tries, and it was
   * once unable to serve a single request: the default `PingRoutingStrategy`
   * was built without a gateways provider, so it resolved an empty candidate
   * list and threw "No gateways available" on every call. Nothing caught it,
   * because the existing default-configuration test only inspects the object
   * graph and never issues a request.
   */
  it('new Wayfinder() with no configuration can serve a request', async () => {
    const wayfinder = new Wayfinder({ logger: quietLogger });

    const response = await wayfinder.request(
      `ar://${FIXTURES.bundledDataItem.id}`,
    );
    const bytes = await drain(response);

    assert.strictEqual(response.status, 200);
    assert.strictEqual(bytes, FIXTURES.bundledDataItem.size);
  });

  it('createWayfinderClient() with no configuration can serve a request', async () => {
    const wayfinder = createWayfinderClient();

    const response = await wayfinder.request(
      `ar://${FIXTURES.bundledDataItem.id}`,
    );
    const bytes = await drain(response);

    assert.strictEqual(response.status, 200);
    assert.strictEqual(bytes, FIXTURES.bundledDataItem.size);
  });

  it('PreferredWithFallbackRoutingStrategy falls back when the preferred gateway is dead', async () => {
    const strategy = new PreferredWithFallbackRoutingStrategy({
      preferredGateway: 'https://gateway.invalid',
      fallbackStrategy: new StaticRoutingStrategy({
        gateway: TRUSTED_GATEWAY,
        logger: quietLogger,
      }),
      logger: quietLogger,
    });

    const selected = await strategy.selectGateway({ path: '/' });

    assert.strictEqual(selected.host, new URL(TRUSTED_GATEWAY).host);
  });

  it('RoundRobinRoutingStrategy cycles through the pool', async () => {
    const strategy = new RoundRobinRoutingStrategy({
      gatewaysProvider: gatewaysProvider(),
      logger: quietLogger,
    });

    const seen: string[] = [];
    for (let i = 0; i < POOL.length; i++) {
      seen.push((await strategy.selectGateway({ path: '/' })).host);
    }

    assert.strictEqual(
      new Set(seen).size,
      POOL.length,
      `expected ${POOL.length} distinct gateways, saw ${seen.join(', ')}`,
    );
  });

  it('resolveUrl maps an ArNS name onto the selected gateway', async () => {
    const wayfinder = new Wayfinder({
      logger: quietLogger,
      routingSettings: {
        strategy: new StaticRoutingStrategy({
          gateway: TRUSTED_GATEWAY,
          logger: quietLogger,
        }),
      },
    });

    const url = await wayfinder.resolveUrl({
      originalUrl: `ar://${FIXTURES.arnsName}`,
    });

    assert.strictEqual(
      url.host,
      `${FIXTURES.arnsName}.${new URL(TRUSTED_GATEWAY).host}`,
    );
  });

  it('serves an ArNS name end to end', async () => {
    const wayfinder = new Wayfinder({
      logger: quietLogger,
      routingSettings: {
        strategy: new StaticRoutingStrategy({
          gateway: TRUSTED_GATEWAY,
          logger: quietLogger,
        }),
      },
    });

    const response = await wayfinder.request(`ar://${FIXTURES.arnsName}`);
    await drain(response);

    assert.strictEqual(response.status, 200);
    assert.ok(
      response.headers.has('x-arns-resolved-id'),
      'expected ArNS resolution headers on the response',
    );
  });
});
