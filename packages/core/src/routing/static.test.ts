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

import { StaticRoutingStrategy } from './static.js';

describe('StaticRoutingStrategy', () => {
  it('returns the configured gateway regardless of the gateways parameter', async () => {
    const staticGateway = 'https://static-example.com/';
    const strategy = new StaticRoutingStrategy({
      gateway: staticGateway,
    });

    const result1 = await strategy.selectGateway();
    const result2 = await strategy.selectGateway();
    const result3 = await strategy.selectGateway();

    assert.equal(
      result1.toString(),
      staticGateway,
      'Should return the static gateway',
    );
    assert.equal(
      result2.toString(),
      staticGateway,
      'Should return the static gateway',
    );
    assert.equal(
      result3.toString(),
      staticGateway,
      'Should return the static gateway even when no gateways are provided',
    );
  });

  it('logs a warning when gateways are provided', async () => {
    const staticGateway = 'https://static-example.com/';

    const strategy = new StaticRoutingStrategy({
      gateway: staticGateway,
    });

    const providedGateways = [
      new URL('https://example1.com'),
      new URL('https://example2.com'),
    ];

    await strategy.selectGateway({ gateways: providedGateways });
  });

  it('throws an error when an invalid URL is provided', () => {
    assert.throws(
      () =>
        new StaticRoutingStrategy({
          gateway: 'not-a-valid-url',
        }),
      /Invalid URL/,
      'Should throw an error when an invalid URL is provided',
    );
  });
});
