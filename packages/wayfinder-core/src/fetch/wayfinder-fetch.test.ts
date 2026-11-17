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
import { afterEach, beforeEach, describe, it } from 'node:test';

import { FastestPingRoutingStrategy } from '../routing/ping.js';
import { PreferredWithFallbackRoutingStrategy } from '../routing/preferred-with-fallback.js';
import { RandomRoutingStrategy } from '../routing/random.js';
import type { Logger, RoutingStrategy } from '../types.js';
import { createWayfinderFetch } from './wayfinder-fetch.js';

const TX_ID = 'c7wkwt6TKgcWJUfgvpJ5q5qi4DIZyJ1_TqhjXgURh0U';

const silentLogger: Logger = {
  debug: () => {
    /* no-op for testing */
  },
  info: () => {
    /* no-op for testing */
  },
  warn: () => {
    /* no-op for testing */
  },
  error: () => {
    /* no-op for testing */
  },
};

/**
 * The gateway a request went to. Data requests use a sandbox subdomain
 * (`<sandbox>.good.com`), so match on the last two labels.
 */
const gatewayOf = (url: string | URL | Request): string => {
  const href = url instanceof Request ? url.url : url.toString();
  return new URL(href).hostname.split('.').slice(-2).join('.');
};

describe('createWayfinderFetch retry', () => {
  const originalFetch = global.fetch;
  let requests: string[];
  let behaviour: Record<string, number | 'throw'>;
  // gateways whose HEAD check fails
  let headFails: Set<string>;
  // gateways that return 503 to their first N data requests, then 200
  let transientFailures: Record<string, number>;

  const mockFetch = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const gateway = gatewayOf(input);
    // PingRoutingStrategy HEAD checks always pass: these gateways are up but
    // fail data requests, which is the case a HEAD check cannot catch
    if (init?.method === 'HEAD') {
      return new Response(null, { status: headFails.has(gateway) ? 503 : 200 });
    }
    requests.push(gateway);
    const transient = transientFailures[gateway];
    if (transient && transient > 0) {
      transientFailures[gateway] = transient - 1;
      return new Response('error', { status: 503 });
    }
    const result = behaviour[gateway] ?? 200;
    if (result === 'throw') {
      throw new TypeError(`fetch failed for ${gateway}`);
    }
    return new Response(result === 200 ? 'data' : 'error', { status: result });
  };

  beforeEach(() => {
    requests = [];
    behaviour = {};
    headFails = new Set();
    transientFailures = {};
    // PingRoutingStrategy HEAD checks go through the global fetch
    global.fetch = mockFetch as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  const createFetch = (routingStrategy: RoutingStrategy) =>
    createWayfinderFetch({
      logger: silentLogger,
      fetch: mockFetch as typeof fetch,
      routingStrategy,
    });

  it('does not retry a gateway that returned a 5xx when another is available', async () => {
    behaviour = { 'bad.com': 502 };
    const wayfinderFetch = createFetch(
      new RandomRoutingStrategy({
        gatewaysProvider: {
          getGateways: async () => [
            new URL('https://bad.com'),
            new URL('https://good.com'),
          ],
        },
      }),
    );

    // a random draw that could repeat bad.com would fail this within a few runs
    for (let i = 0; i < 25; i++) {
      requests = [];
      const response = await wayfinderFetch(`ar://${TX_ID}`);
      assert.equal(response.status, 200);
      assert.equal(await response.text(), 'data');
      assert.ok(
        requests.filter((g) => g === 'bad.com').length <= 1,
        `bad.com was requested more than once: ${requests.join(', ')}`,
      );
    }
  });

  it('passes every failed gateway to the routing strategy as exclude', async () => {
    behaviour = { 'bad1.com': 500, 'bad2.com': 'throw' };
    const pool = [
      new URL('https://bad1.com'),
      new URL('https://bad2.com'),
      new URL('https://good.com'),
    ];
    const excludes: string[][] = [];
    const wayfinderFetch = createFetch({
      async selectGateway({ exclude }) {
        excludes.push((exclude ?? []).map((g) => g.toString()));
        return pool[excludes.length - 1];
      },
    });

    const response = await wayfinderFetch(`ar://${TX_ID}`);
    assert.equal(response.status, 200);
    assert.deepEqual(excludes, [
      [],
      ['https://bad1.com/'],
      ['https://bad1.com/', 'https://bad2.com/'],
    ]);
  });

  it('falls back from a failing preferred gateway to the fallback strategy', async () => {
    behaviour = { 'preferred.com': 503 };
    const wayfinderFetch = createFetch(
      new PreferredWithFallbackRoutingStrategy({
        preferredGateway: 'https://preferred.com',
        fallbackStrategy: {
          selectGateway: async () => new URL('https://fallback.com'),
        },
        logger: silentLogger,
      }),
    );

    const response = await wayfinderFetch(`ar://${TX_ID}`);
    assert.equal(response.status, 200);
    assert.deepEqual(requests, ['preferred.com', 'fallback.com']);
  });

  it('retries an excluded gateway when FastestPing finds no other gateway up', async () => {
    // a.com fails one data request; b.com is down
    transientFailures = { 'a.com': 1 };
    headFails = new Set(['b.com']);
    const wayfinderFetch = createFetch(
      new FastestPingRoutingStrategy({
        timeoutMs: 500,
        logger: silentLogger,
        gatewaysProvider: {
          getGateways: async () => [
            new URL('https://a.com'),
            new URL('https://b.com'),
          ],
        },
      }),
    );

    const response = await wayfinderFetch(`ar://${TX_ID}`);
    assert.equal(response.status, 200);
    assert.deepEqual(requests, ['a.com', 'a.com']);
  });

  it('does not retry a 4xx response', async () => {
    behaviour = { 'missing.com': 404 };
    let calls = 0;
    const wayfinderFetch = createFetch({
      async selectGateway() {
        calls++;
        return new URL('https://missing.com');
      },
    });

    const response = await wayfinderFetch(`ar://${TX_ID}`);
    assert.equal(response.status, 404);
    assert.equal(calls, 1);
  });

  it('returns the last 5xx response after three attempts', async () => {
    behaviour = { 'bad1.com': 500, 'bad2.com': 502, 'bad3.com': 503 };
    const pool = ['bad1.com', 'bad2.com', 'bad3.com'];
    let calls = 0;
    const wayfinderFetch = createFetch({
      async selectGateway() {
        return new URL(`https://${pool[calls++]}`);
      },
    });

    const response = await wayfinderFetch(`ar://${TX_ID}`);
    assert.equal(response.status, 503);
    assert.equal(calls, 3);
  });

  it('throws the last error when every attempt throws', async () => {
    behaviour = { 'down.com': 'throw' };
    const wayfinderFetch = createFetch({
      selectGateway: async () => new URL('https://down.com'),
    });

    await assert.rejects(
      () => wayfinderFetch(`ar://${TX_ID}`),
      /fetch failed for down.com/,
    );
    assert.equal(requests.length, 3);
  });
});
