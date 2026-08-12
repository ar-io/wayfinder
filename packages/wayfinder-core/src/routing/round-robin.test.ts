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

describe('RoundRobinRoutingStrategy contract', () => {
  it('cycles over a caller-supplied list when provider-backed', async () => {
    // A list pinned at construction keeps winning (asserted above). A
    // provider-backed strategy honours a supplied list, per the interface.
    const strategy = new RoundRobinRoutingStrategy({
      gatewaysProvider: {
        getGateways: async () => [new URL('https://from-provider.example')],
      },
    });
    const supplied = [
      new URL('https://a.example'),
      new URL('https://b.example'),
    ];

    const picks = [
      await strategy.selectGateway({ gateways: supplied }),
      await strategy.selectGateway({ gateways: supplied }),
      await strategy.selectGateway({ gateways: supplied }),
    ].map((u) => u.host);

    assert.deepStrictEqual(picks, ['a.example', 'b.example', 'a.example']);
  });

  /**
   * Caching belongs to the provider layer. Holding the first result forever
   * would make a `SimpleCacheGatewaysProvider` TTL meaningless and would never
   * pick up a list that narrows — which is how a blacklisted gateway stayed in
   * rotation in the Chrome extension.
   */
  it('re-reads the provider on every selection', async () => {
    let calls = 0;
    let pool = [
      new URL('https://first.example'),
      new URL('https://second.example'),
    ];
    const strategy = new RoundRobinRoutingStrategy({
      gatewaysProvider: {
        getGateways: async () => {
          calls++;
          return pool;
        },
      },
    });

    await strategy.selectGateway();
    assert.strictEqual(calls, 1);

    // the list narrows, as it would when a gateway is blacklisted
    pool = [new URL('https://second.example')];

    const picked = await strategy.selectGateway();
    assert.strictEqual(calls, 2);
    assert.strictEqual(picked.host, 'second.example');
  });

  it('throws when neither a supplied list nor a provider yields gateways', async () => {
    const strategy = new RoundRobinRoutingStrategy({
      gatewaysProvider: { getGateways: async () => [] },
    });

    await assert.rejects(
      () => strategy.selectGateway(),
      /No gateways available/,
    );
  });
});
