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
 * Gateway discovery against the live AR.IO network.
 *
 * This is the coverage gap the rest of the suite was missing: every existing
 * test stubs the gateways provider, so nothing exercised the path from the
 * on-chain (Solana) registry to a usable list of gateway URLs.
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';
import { ARIO } from '@ar.io/sdk';
import { createSolanaRpc } from '@solana/kit';
import { CompositeGatewaysProvider } from '../gateways/composite.js';
import { NetworkGatewaysProvider } from '../gateways/network.js';
import { SimpleCacheGatewaysProvider } from '../gateways/simple-cache.js';
import { StaticGatewaysProvider } from '../gateways/static.js';
import { TrustedPeersGatewaysProvider } from '../gateways/trusted-peers.js';
import {
  E2E_TIMEOUT_MS,
  SOLANA_RPC_URL,
  TRUSTED_GATEWAY,
  quietLogger,
  withRpcRetry,
} from './fixtures.js';

const ario = ARIO.init({ rpc: createSolanaRpc(SOLANA_RPC_URL) });

/**
 * One registry read shared by every test that needs ground truth. Each read is
 * a ~1.9MB `getProgramAccounts` call, so re-fetching per test is what trips the
 * public RPC's rate limit.
 */
let registrySnapshot: Promise<any[]> | undefined;
const joinedGateways = () => {
  registrySnapshot ??= withRpcRetry(() =>
    ario.getGateways({ limit: 1000 }),
  ).then(({ items }) =>
    items.filter((gateway: any) => gateway.status === 'joined'),
  );
  return registrySnapshot;
};

describe('e2e: gateway discovery', { timeout: E2E_TIMEOUT_MS }, () => {
  describe('NetworkGatewaysProvider (Solana registry)', () => {
    it('returns a non-empty list of joined gateways', async () => {
      const gateways = await withRpcRetry(() =>
        new NetworkGatewaysProvider({
          ario,
          logger: quietLogger,
        }).getGateways(),
      );

      assert.ok(
        gateways.length > 0,
        'AR.IO Solana registry returned no joined gateways',
      );
      for (const gateway of gateways) {
        assert.ok(gateway instanceof URL);
        assert.match(gateway.protocol, /^https?:$/);
        assert.ok(gateway.hostname.length > 0);
      }
    });

    it('honours the limit parameter', async () => {
      const gateways = await withRpcRetry(() =>
        new NetworkGatewaysProvider({
          ario,
          limit: 5,
          logger: quietLogger,
        }).getGateways(),
      );

      assert.ok(gateways.length <= 5, `expected <= 5, got ${gateways.length}`);
      assert.ok(gateways.length > 0);
    });

    it('applies the filter predicate', async () => {
      const gateways = await withRpcRetry(() =>
        new NetworkGatewaysProvider({
          ario,
          filter: () => false,
          logger: quietLogger,
        }).getGateways(),
      );

      assert.strictEqual(gateways.length, 0);
    });

    /**
     * The Solana backend of @ar.io/sdk accepts `sortBy` / `sortOrder` but its
     * `paginate()` helper never applies them, so the provider sorts
     * client-side. These two tests check the ranking against ground truth
     * computed from the full registry — if the SDK ever starts sorting (or
     * stops), a `limit` smaller than the registry must still select the
     * top-ranked gateways rather than an arbitrary slice.
     */
    for (const sortOrder of ['desc', 'asc'] as const) {
      it(`ranks gateways correctly for operatorStake ${sortOrder}`, async () => {
        const joined = await joinedGateways();
        const stakeByFqdn = new Map<string, number>(
          joined.map((gateway: any) => [
            gateway.settings.fqdn,
            Number(gateway.operatorStake),
          ]),
        );
        const ranked = joined
          .map((gateway: any) => Number(gateway.operatorStake))
          .sort((a: number, b: number) =>
            sortOrder === 'asc' ? a - b : b - a,
          );

        const actual = await withRpcRetry(() =>
          new NetworkGatewaysProvider({
            ario,
            limit: 5,
            sortBy: 'operatorStake',
            sortOrder,
            logger: quietLogger,
          }).getGateways(),
        );

        // Compare stake values rather than hostnames: the bottom of the
        // distribution is full of ties, so which of several equally-staked
        // gateways comes back is not deterministic (and doesn't matter).
        assert.deepStrictEqual(
          actual.map((url) => stakeByFqdn.get(url.hostname)),
          ranked.slice(0, 5),
          `limit=5 did not return the top 5 stakes for operatorStake ${sortOrder}`,
        );
      });
    }
  });

  describe('TrustedPeersGatewaysProvider', () => {
    /**
     * The default gateway source for `createWayfinderClient()`. An empty
     * result here is not cosmetic: routing strategies throw
     * "No gateways available" and the default client cannot serve a request.
     */
    it('returns a non-empty peer list from the trusted gateway', async () => {
      const gateways = await new TrustedPeersGatewaysProvider({
        trustedGateway: TRUSTED_GATEWAY,
        logger: quietLogger,
      }).getGateways();

      assert.ok(
        gateways.length > 0,
        `${TRUSTED_GATEWAY}/ar-io/peers returned an empty "gateways" map. ` +
          'The default wayfinder client cannot route with an empty peer list.',
      );
    });

    it('returns a peer list consistently across repeated calls', async () => {
      const provider = new TrustedPeersGatewaysProvider({
        trustedGateway: TRUSTED_GATEWAY,
        logger: quietLogger,
      });

      const runs = await Promise.all(
        Array.from({ length: 5 }, () => provider.getGateways()),
      );
      const empty = runs.filter((r) => r.length === 0).length;

      assert.strictEqual(
        empty,
        0,
        `${empty}/5 calls to ${TRUSTED_GATEWAY}/ar-io/peers returned zero ` +
          'gateways. Peer discovery is non-deterministic, so the default ' +
          'client fails intermittently.',
      );
    });
  });

  describe('composition', () => {
    /**
     * CompositeGatewaysProvider is a fallback chain: it returns the first
     * provider that yields a non-empty list. That makes it the intended
     * mitigation for a flaky primary source — worth proving it actually
     * falls through, both for an empty result and for a throwing provider.
     */
    it('CompositeGatewaysProvider falls through an empty provider to the registry', async () => {
      const gateways = await withRpcRetry(() =>
        new CompositeGatewaysProvider({
          providers: [
            { getGateways: async () => [] },
            new NetworkGatewaysProvider({
              ario,
              limit: 3,
              logger: quietLogger,
            }),
          ],
          logger: quietLogger,
        }).getGateways(),
      );

      assert.ok(gateways.length > 0, 'composite did not fall through');
      assert.ok(gateways.length <= 3);
    });

    it('CompositeGatewaysProvider falls through a throwing provider', async () => {
      const gateways = await new CompositeGatewaysProvider({
        providers: [
          {
            getGateways: async () => {
              throw new Error('primary source is down');
            },
          },
          new StaticGatewaysProvider({ gateways: [TRUSTED_GATEWAY] }),
        ],
        logger: quietLogger,
      }).getGateways();

      assert.deepStrictEqual(gateways.map(String), [
        new URL(TRUSTED_GATEWAY).toString(),
      ]);
    });

    it('SimpleCacheGatewaysProvider serves the second call from cache', async () => {
      let calls = 0;
      const cached = new SimpleCacheGatewaysProvider({
        gatewaysProvider: {
          getGateways: async () => {
            calls++;
            return withRpcRetry(() =>
              new NetworkGatewaysProvider({
                ario,
                limit: 3,
                logger: quietLogger,
              }).getGateways(),
            );
          },
        },
        ttlSeconds: 60,
        logger: quietLogger,
      });

      const first = await cached.getGateways();
      const second = await cached.getGateways();

      assert.ok(first.length > 0);
      assert.deepStrictEqual(
        second.map(String),
        first.map(String),
        'cached call returned a different list',
      );
      assert.strictEqual(calls, 1, 'cache did not prevent a second fetch');
    });

    /**
     * An empty upstream result must not be cached as if it were valid,
     * otherwise one bad response poisons routing for the whole TTL.
     */
    it('SimpleCacheGatewaysProvider does not cache an empty list', async () => {
      let calls = 0;
      const cached = new SimpleCacheGatewaysProvider({
        gatewaysProvider: {
          getGateways: async () => {
            calls++;
            return [];
          },
        },
        ttlSeconds: 600,
        logger: quietLogger,
      });

      await cached.getGateways();
      await cached.getGateways();

      assert.strictEqual(calls, 2, 'an empty gateway list was cached');
    });
  });
});
