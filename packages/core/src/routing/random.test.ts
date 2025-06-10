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
