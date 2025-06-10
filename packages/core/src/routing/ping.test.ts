/**
 * WayFinder
 * Copyright (C) 2022-2025 Permanent Data Solutions, Inc. All Rights Reserved.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { FastestPingRoutingStrategy } from './ping.js';

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

    // mock AbortSignal.timeout
    if (!AbortSignal.timeout) {
      (AbortSignal as any).timeout = (ms: number) => {
        const controller = new AbortController();
        setTimeout(() => controller.abort(), ms);
        return controller.signal;
      };
    }
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

    // console.log(await strategy.selectGateway({ gateways }), 'test');

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
