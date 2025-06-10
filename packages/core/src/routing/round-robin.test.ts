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

import { RoundRobinRoutingStrategy } from './round-robin.js';
describe('RoundRobinRoutingStrategy', () => {
  it('selects gateways in order and cycles back to the beginning', async () => {
    const gateways = [
      new URL('https://example1.com'),
      new URL('https://example2.com'),
      new URL('https://example3.com'),
    ];

    const strategy = new RoundRobinRoutingStrategy({ gateways });

    const selection1 = await strategy.selectGateway();
    assert.equal(
      selection1.toString(),
      gateways[0].toString(),
      'Should select the first gateway first',
    );

    const selection2 = await strategy.selectGateway();
    assert.equal(
      selection2.toString(),
      gateways[1].toString(),
      'Should select the second gateway second',
    );

    const selection3 = await strategy.selectGateway();
    assert.equal(
      selection3.toString(),
      gateways[2].toString(),
      'Should select the third gateway third',
    );

    // should cycle back to the first gateway
    const selection4 = await strategy.selectGateway();
    assert.equal(
      selection4.toString(),
      gateways[0].toString(),
      'Should cycle back to the first gateway',
    );
  });

  it('uses the internal list even when a different list is provided', async () => {
    const initialGateways = [
      new URL('https://example1.com'),
      new URL('https://example2.com'),
    ];

    const newGateways = [
      new URL('https://example3.com'),
      new URL('https://example4.com'),
    ];

    const strategy = new RoundRobinRoutingStrategy({
      gateways: initialGateways,
    });

    const selection1 = await strategy.selectGateway({
      gateways: newGateways,
    });
    assert.equal(
      selection1.toString(),
      initialGateways[0].toString(),
      'Should use the internal list even when a different list is provided',
    );

    const selection2 = await strategy.selectGateway({
      gateways: newGateways,
    });
    assert.equal(
      selection2.toString(),
      initialGateways[1].toString(),
      'Should use the internal list even when a different list is provided',
    );
  });

  it('handles a single gateway by returning it repeatedly', async () => {
    const gateways = [new URL('https://example1.com')];
    const strategy = new RoundRobinRoutingStrategy({
      gateways,
    });

    const selection1 = await strategy.selectGateway({
      gateways: [new URL('https://example2.com')],
    });
    assert.equal(
      selection1.toString(),
      gateways[0].toString(),
      'Should return the single gateway',
    );

    const selection2 = await strategy.selectGateway({
      gateways: [new URL('https://example2.com')],
    });
    assert.equal(
      selection2.toString(),
      gateways[0].toString(),
      'Should return the single gateway again',
    );
  });
});
