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

import { FastestPingRoutingStrategy, PingRoutingStrategy } from './ping.js';
import { RandomRoutingStrategy } from './random.js';
import { StaticRoutingStrategy } from './static.js';

describe('FastestPingRoutingStrategy', () => {
  // Original fetch function
  const originalFetch = global.fetch;

  // Mock response options for each gateway
  const mockResponses = new Map<string, { status: number; delayMs: number }>();

  beforeEach(() => {
    // reset mock responses
    mockResponses.clear();

    // mock fetch to simulate network latency and response status
    // @ts-expect-error - we're mocking the fetch function
    global.fetch = async (url: string | URL) => {
      const urlString = url.toString();

      // find the matching gateway
      let matchingGateway = '';
      for (const gateway of mockResponses.keys()) {
        if (urlString.startsWith(gateway)) {
          matchingGateway = gateway;
          break;
        }
      }

      if (!matchingGateway) {
        return Promise.reject(
          new Error(`No mock response for URL: ${urlString}`),
        );
      }

      const { status, delayMs } = mockResponses.get(matchingGateway)!;

      // simulate network delay
      await new Promise((resolve) => setTimeout(resolve, delayMs));

      return new Response(null, { status });
    };
  });

  // restore original fetch after tests
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('selects the gateway with the lowest latency', async () => {
    const gateways = [
      new URL('https://slow.com'),
      new URL('https://fast.com'),
      new URL('https://medium.com'),
    ];

    // configure mock responses
    mockResponses.set('https://slow.com', { status: 200, delayMs: 300 });
    mockResponses.set('https://fast.com', { status: 200, delayMs: 50 });
    mockResponses.set('https://medium.com', { status: 200, delayMs: 150 });

    const strategy = new FastestPingRoutingStrategy({ timeoutMs: 500 });

    // select the gateway with the lowest latency
    const selectedGateway = await strategy.selectGateway({
      gateways,
    });

    assert.equal(
      selectedGateway.toString(),
      'https://fast.com/',
      'Should select the gateway with the lowest latency',
    );
  });

  // The probe targets the gateway itself, not the sandboxed content URL, so a
  // request carrying a subdomain is still measured against the gateway host.
  it('probes the gateway host rather than the request subdomain', async () => {
    const gateways = [
      new URL('https://slow.com'),
      new URL('https://fast.com'),
      new URL('https://medium.com'),
    ];

    // only the bare gateway hosts are mocked — a probe sent to
    // `subdomain.<host>` would find no mock and reject
    mockResponses.set('https://slow.com', { status: 200, delayMs: 300 });
    mockResponses.set('https://fast.com', { status: 200, delayMs: 50 });
    mockResponses.set('https://medium.com', { status: 200, delayMs: 150 });

    const strategy = new FastestPingRoutingStrategy({ timeoutMs: 500 });

    const selectedGateway = await strategy.selectGateway({
      gateways,
      subdomain: 'subdomain',
    });

    assert.equal(
      selectedGateway.toString(),
      'https://fast.com/',
      'Should select the gateway with the lowest latency for a subdomain',
    );
  });

  it('probes a custom probePath when configured', async () => {
    const gateways = [new URL('https://gateway.com')];
    mockResponses.set('https://gateway.com/ar-io/healthcheck', {
      status: 200,
      delayMs: 10,
    });

    const strategy = new FastestPingRoutingStrategy({
      timeoutMs: 500,
      probePath: '/ar-io/healthcheck',
    });

    const selectedGateway = await strategy.selectGateway({ gateways });

    assert.equal(selectedGateway.toString(), 'https://gateway.com/');
  });

  it('selects the lowest-latency gateway regardless of the request path', async () => {
    const gateways = [
      new URL('https://slow.com'),
      new URL('https://fast.com'),
      new URL('https://medium.com'),
    ];

    // the request path does not influence the probe target, so the bare
    // gateway hosts are what gets measured
    mockResponses.set('https://slow.com/', { status: 200, delayMs: 300 });
    mockResponses.set('https://fast.com/', { status: 200, delayMs: 50 });
    mockResponses.set('https://medium.com/', { status: 200, delayMs: 150 });

    const strategy = new FastestPingRoutingStrategy({ timeoutMs: 500 });

    const selectedGateway = await strategy.selectGateway({
      gateways,
      path: '/path',
    });

    assert.equal(
      selectedGateway.toString(),
      'https://fast.com/',
      'Should select the gateway with the lowest latency for a path',
    );
  });

  it('ignores gateways that return non-200 status codes', async () => {
    const gateways = [
      new URL('https://error.com'),
      new URL('https://success.com'),
      new URL('https://another-error.com'),
    ];

    // configure mock responses
    mockResponses.set('https://error.com', { status: 404, delayMs: 50 });
    mockResponses.set('https://success.com', { status: 200, delayMs: 100 });
    mockResponses.set('https://another-error.com', {
      status: 500,
      delayMs: 75,
    });

    const strategy = new FastestPingRoutingStrategy({ timeoutMs: 500 });

    // select the gateway with the lowest latency
    const selectedGateway = await strategy.selectGateway({
      gateways,
    });

    assert.equal(
      selectedGateway.toString(),
      'https://success.com/',
      'Should select the gateway that returns a 200 status code',
    );
  });

  it('throws an error when all gateways fail', async () => {
    const gateways = [
      new URL('https://error1.com'),
      new URL('https://error2.com'),
    ];

    // configure mock responses
    mockResponses.set('https://error1.com', { status: 404, delayMs: 50 });
    mockResponses.set('https://error2.com', { status: 500, delayMs: 75 });

    const strategy = new FastestPingRoutingStrategy({ timeoutMs: 500 });

    // select the gateway with the lowest latency
    await assert.rejects(
      async () => await strategy.selectGateway({ gateways }),
      'Should throw an error when all gateways fail',
    );
  });

  it('handles network errors gracefully', async () => {
    const gateways = [
      new URL('https://network-error.com'),
      new URL('https://success.com'),
    ];

    // configure mock responses
    mockResponses.set('https://success.com', { status: 200, delayMs: 100 });

    // override fetch for the network error case
    const originalFetchMock = global.fetch;
    // @ts-expect-error - we're mocking the fetch function
    global.fetch = async (url: string | URL) => {
      if (url.toString().includes('network-error')) {
        throw new Error('Network error');
      }
      return originalFetchMock(url);
    };

    const strategy = new FastestPingRoutingStrategy({ timeoutMs: 500 });

    // select the gateway with the lowest latency
    const selectedGateway = await strategy.selectGateway({
      gateways,
    });

    assert.equal(
      selectedGateway.toString(),
      'https://success.com/',
      'Should handle network errors and select the working gateway',
    );
  });

  it('respects the timeout parameter', async () => {
    const gateways = [
      new URL('https://timeout.com'),
      new URL('https://fast.com'),
    ];

    // configure mock responses
    mockResponses.set('https://timeout.com', { status: 200, delayMs: 300 });
    mockResponses.set('https://fast.com', { status: 200, delayMs: 50 });

    // set a short timeout
    const strategy = new FastestPingRoutingStrategy({ timeoutMs: 100 });

    const selectedGateway = await strategy.selectGateway({
      gateways,
    });

    assert.equal(
      selectedGateway.toString(),
      'https://fast.com/',
      'Should respect the timeout and select only gateways that respond within the timeout',
    );
  });

  it('throws an error when no gateways are provided', async () => {
    const gateways: URL[] = [];
    const strategy = new FastestPingRoutingStrategy();

    // select the gateway with the lowest latency
    await assert.rejects(
      async () => await strategy.selectGateway({ gateways }),
      /No gateways provided/,
      'Should throw an error when no gateways are provided',
    );
  });
});

describe('PingRoutingStrategy', () => {
  const originalFetch = global.fetch;
  const mockResponses = new Map<string, { status: number; delayMs: number }>();

  beforeEach(() => {
    mockResponses.clear();

    // @ts-expect-error - we're mocking the fetch function
    global.fetch = async (url: string | URL, init?: RequestInit) => {
      const urlString = url.toString();

      let matchingGateway = '';
      for (const gateway of mockResponses.keys()) {
        if (urlString.startsWith(gateway)) {
          matchingGateway = gateway;
          break;
        }
      }

      if (!matchingGateway) {
        return Promise.reject(
          new Error(`No mock response for URL: ${urlString}`),
        );
      }

      const { status, delayMs } = mockResponses.get(matchingGateway)!;
      await new Promise((resolve, reject) =>
        setTimeout(() => {
          if (init?.signal?.aborted) {
            reject(new Error('Request timed out'));
          }
          resolve(null);
        }, delayMs),
      );
      return new Response(null, { status });
    };
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns first gateway when HEAD check succeeds', async () => {
    const gateways = [new URL('https://good.com'), new URL('https://bad.com')];

    mockResponses.set('https://good.com', { status: 200, delayMs: 50 });
    mockResponses.set('https://bad.com', { status: 404, delayMs: 50 });

    const baseStrategy = new StaticRoutingStrategy({
      gateway: 'https://good.com',
    });
    const strategy = new PingRoutingStrategy({ routingStrategy: baseStrategy });

    const result = await strategy.selectGateway({ gateways });
    assert.equal(result.toString(), 'https://good.com/');
  });

  it('retries with different gateway when HEAD check fails', async () => {
    const gateways = [new URL('https://bad.com'), new URL('https://good.com')];

    mockResponses.set('https://bad.com', { status: 404, delayMs: 50 });
    mockResponses.set('https://good.com', { status: 200, delayMs: 50 });

    let callCount = 0;
    const mockBaseStrategy = {
      async selectGateway() {
        return gateways[callCount++ % gateways.length];
      },
    };

    const strategy = new PingRoutingStrategy({
      routingStrategy: mockBaseStrategy,
    });

    const result = await strategy.selectGateway({ gateways });
    assert.equal(result.toString(), 'https://good.com/');
  });

  it('throws error after all retries fail', async () => {
    const gateways = [new URL('https://bad1.com'), new URL('https://bad2.com')];

    mockResponses.set('https://bad1.com', { status: 404, delayMs: 50 });
    mockResponses.set('https://bad2.com', { status: 500, delayMs: 50 });

    let callCount = 0;
    const mockBaseStrategy = {
      async selectGateway() {
        return gateways[callCount++ % gateways.length];
      },
    };

    const strategy = new PingRoutingStrategy({
      routingStrategy: mockBaseStrategy,
      retries: 2,
    });

    await assert.rejects(
      () => strategy.selectGateway({ gateways }),
      /Failed to find working gateway after HEAD checks/,
    );
  });

  it('handles network errors and retries', async () => {
    const gateways = [
      new URL('https://error.com'),
      new URL('https://good.com'),
    ];

    mockResponses.set('https://good.com', { status: 200, delayMs: 50 });

    let callCount = 0;
    const mockBaseStrategy = {
      async selectGateway() {
        return gateways[callCount++ % gateways.length];
      },
    };

    // Override fetch for network error case
    const originalFetchMock = global.fetch;
    // @ts-expect-error - we're mocking the fetch function
    global.fetch = async (url: string | URL) => {
      if (url.toString().includes('error.com')) {
        throw new Error('Network error');
      }
      return originalFetchMock(url);
    };

    const strategy = new PingRoutingStrategy({
      routingStrategy: mockBaseStrategy,
    });

    const result = await strategy.selectGateway({ gateways });
    assert.equal(result.toString(), 'https://good.com/');
  });

  it('probes the gateway root, not the sandboxed request URL', async () => {
    const gateways = [new URL('https://gateway.com')];

    // Only the gateway root is mocked. Probing `sub.gateway.com/test/path`
    // would find no mock and reject, so this passing proves the probe targets
    // the gateway itself.
    mockResponses.set('https://gateway.com/', { status: 200, delayMs: 50 });

    const baseStrategy = new StaticRoutingStrategy({
      gateway: 'https://gateway.com',
    });
    const strategy = new PingRoutingStrategy({
      routingStrategy: baseStrategy,
    });

    const result = await strategy.selectGateway({
      gateways,
      subdomain: 'sub',
      path: '/test/path',
    });

    assert.equal(result.toString(), 'https://gateway.com/');
  });

  it('probes a custom probePath when configured', async () => {
    const gateways = [new URL('https://gateway.com')];
    mockResponses.set('https://gateway.com/ar-io/healthcheck', {
      status: 200,
      delayMs: 10,
    });

    const baseStrategy = new StaticRoutingStrategy({
      gateway: 'https://gateway.com',
    });
    const strategy = new PingRoutingStrategy({
      routingStrategy: baseStrategy,
      probePath: '/ar-io/healthcheck',
    });

    const result = await strategy.selectGateway({ gateways });

    assert.equal(result.toString(), 'https://gateway.com/');
  });

  it('respects custom timeout and retries', async () => {
    const gateways = [new URL('https://slow.com')];

    mockResponses.set('https://slow.com', { status: 200, delayMs: 200 });

    const baseStrategy = new StaticRoutingStrategy({
      gateway: 'https://slow.com',
    });
    const strategy = new PingRoutingStrategy({
      routingStrategy: baseStrategy,
      timeoutMs: 100,
      retries: 1,
    });

    await assert.rejects(
      () => strategy.selectGateway({ gateways }),
      /Failed to find working gateway after HEAD checks/,
    );
  });

  it('throws error when no gateways provided', async () => {
    const baseStrategy = new StaticRoutingStrategy({
      gateway: 'https://test.com',
    });
    const strategy = new PingRoutingStrategy({
      routingStrategy: baseStrategy,
    });

    await assert.rejects(
      () => strategy.selectGateway({ gateways: [] }),
      /No gateways available/,
    );
  });
});

describe('ping strategies exclude', () => {
  const originalFetch = global.fetch;
  let pinged: string[];

  beforeEach(() => {
    pinged = [];
    // every gateway answers the HEAD check unless its host starts with "bad"
    // @ts-expect-error - we're mocking the fetch function
    global.fetch = async (url: string | URL) => {
      const { host } = new URL(url.toString());
      pinged.push(host);
      return new Response(null, { status: host.startsWith('bad') ? 503 : 200 });
    };
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('FastestPingRoutingStrategy', () => {
    it('does not ping or return excluded gateways', async () => {
      const strategy = new FastestPingRoutingStrategy({ timeoutMs: 500 });
      const result = await strategy.selectGateway({
        gateways: [new URL('https://failed.com'), new URL('https://ok.com')],
        exclude: [new URL('https://failed.com')],
      });
      assert.equal(result.toString(), 'https://ok.com/');
      assert.ok(!pinged.includes('failed.com'));
    });

    it('falls back to the full list when every gateway is excluded', async () => {
      const gateways = [new URL('https://failed.com')];
      const strategy = new FastestPingRoutingStrategy({ timeoutMs: 500 });
      const result = await strategy.selectGateway({
        gateways,
        exclude: gateways,
      });
      assert.equal(result.toString(), 'https://failed.com/');
    });
  });

  describe('PingRoutingStrategy', () => {
    it('passes the caller exclude list to the wrapped strategy', async () => {
      const exclude = [new URL('https://failed.com')];
      let received: URL[] | undefined;
      const strategy = new PingRoutingStrategy({
        routingStrategy: {
          async selectGateway(params) {
            received = params.exclude;
            return new URL('https://ok.com');
          },
        },
      });

      await strategy.selectGateway({ exclude });
      assert.deepEqual(
        received?.map((g) => g.toString()),
        ['https://failed.com/'],
      );
    });

    it('excludes each gateway that fails its HEAD check on later retries', async () => {
      const calls: string[][] = [];
      const strategy = new PingRoutingStrategy({
        routingStrategy: new RandomRoutingStrategy(),
        retries: 3,
      });
      const wrapped = strategy.routingStrategy;
      const originalSelect = wrapped.selectGateway.bind(wrapped);
      wrapped.selectGateway = async (params) => {
        calls.push((params.exclude ?? []).map((g) => g.toString()));
        return originalSelect(params);
      };

      const result = await strategy.selectGateway({
        gateways: [
          new URL('https://bad1.com'),
          new URL('https://bad2.com'),
          new URL('https://ok.com'),
        ],
      });

      assert.equal(result.toString(), 'https://ok.com/');
      // each gateway is probed at most once
      assert.equal(new Set(pinged).size, pinged.length);
      // the exclude list grows by one per failed HEAD check
      for (let i = 1; i < calls.length; i++) {
        assert.equal(calls[i].length, i);
      }
    });

    it('still returns a static gateway that the caller excluded', async () => {
      const strategy = new PingRoutingStrategy({
        routingStrategy: new StaticRoutingStrategy({
          gateway: 'https://only.com',
        }),
      });
      const result = await strategy.selectGateway({
        exclude: [new URL('https://only.com')],
      });
      assert.equal(result.toString(), 'https://only.com/');
    });
  });
});
