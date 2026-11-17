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
import { describe, it } from 'node:test';

import { RandomRoutingStrategy } from './random.js';

describe('RandomRoutingStrategy', () => {
  it('selects a gateway from the provided list', async () => {
    // Arrange
    const gateways = [
      new URL('https://example1.com'),
      new URL('https://example2.com'),
      new URL('https://example3.com'),
    ];
    const strategy = new RandomRoutingStrategy();
    const selectedGateway = await strategy.selectGateway({ gateways });
    assert.ok(
      gateways.includes(selectedGateway),
      'The selected gateway should be one of the gateways provided',
    );
  });

  it('throws error when no gateways are provided', async () => {
    const gateways: URL[] = [];
    const strategy = new RandomRoutingStrategy();
    await assert.rejects(
      async () => await strategy.selectGateway({ gateways }),
      /No gateways available/,
      'Should throw an error when no gateways are provided',
    );
  });

  it('should distribute gateway selection somewhat randomly', async () => {
    const gateways = [
      new URL('https://example1.com'),
      new URL('https://example2.com'),
      new URL('https://example3.com'),
      new URL('https://example4.com'),
      new URL('https://example5.com'),
    ];
    const strategy = new RandomRoutingStrategy();
    const selections = new Map<string, number>();

    // select gateways multiple times
    const iterations = 100;
    for (let i = 0; i < iterations; i++) {
      const gateway = await strategy.selectGateway({ gateways });
      const key = gateway.toString();
      selections.set(key, (selections.get(key) || 0) + 1);
    }

    // each gateway should be selected at least once
    for (const gateway of gateways) {
      const key = gateway.toString();
      assert.ok(
        selections.has(key),
        `Gateway ${key} should be selected at least once`,
      );
    }

    // no gateway should be selected more than 50% of the time
    for (const [key, count] of selections.entries()) {
      assert.ok(
        count < iterations * 0.5,
        `Gateway ${key} was selected ${count} times, which is more than 50% of iterations`,
      );
    }
  });
});

describe('RandomRoutingStrategy exclude', () => {
  const gateways = [
    new URL('https://a.com'),
    new URL('https://b.com'),
    new URL('https://c.com'),
  ];

  it('never returns an excluded gateway when another is available', async () => {
    const strategy = new RandomRoutingStrategy();
    const exclude = [new URL('https://a.com'), new URL('https://b.com')];
    for (let i = 0; i < 50; i++) {
      const gateway = await strategy.selectGateway({ gateways, exclude });
      assert.equal(gateway.toString(), 'https://c.com/');
    }
  });

  it('filters a provider-supplied list too', async () => {
    const strategy = new RandomRoutingStrategy({
      gatewaysProvider: { getGateways: async () => gateways },
    });
    const exclude = [new URL('https://b.com'), new URL('https://c.com')];
    for (let i = 0; i < 20; i++) {
      const gateway = await strategy.selectGateway({ exclude });
      assert.equal(gateway.toString(), 'https://a.com/');
    }
  });

  it('falls back to the full pool when every gateway is excluded', async () => {
    const strategy = new RandomRoutingStrategy();
    const gateway = await strategy.selectGateway({
      gateways,
      exclude: gateways,
    });
    assert.ok(gateways.some((g) => g.toString() === gateway.toString()));
  });
});
