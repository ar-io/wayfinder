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
 * Data retrieval strategies against live gateways.
 *
 * The chunk strategy has more moving parts than it appears: it needs the
 * `x-ar-io-root-*` headers on the data response, a working `/tx/<root>/offset`
 * endpoint, and a gateway that serves `/chunk/<offset>/data` with the
 * `X-Arweave-Chunk-*` headers. Each prerequisite is asserted separately so a
 * failure names the layer that broke instead of just "chunk retrieval failed".
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';
import { ChunkDataRetrievalStrategy } from '../retrieval/chunk.js';
import { ContiguousDataRetrievalStrategy } from '../retrieval/contiguous.js';
import { StaticRoutingStrategy } from '../routing/static.js';
import type { DataRetrievalStrategy } from '../types.js';
import { Wayfinder } from '../wayfinder.js';
import {
  E2E_TIMEOUT_MS,
  FALLBACK_GATEWAYS,
  FIXTURES,
  TRUSTED_GATEWAY,
  quietLogger,
} from './fixtures.js';

async function fetchWith(
  dataRetrievalStrategy: DataRetrievalStrategy,
  gateway = TRUSTED_GATEWAY,
): Promise<Uint8Array> {
  const wayfinder = new Wayfinder({
    logger: quietLogger,
    routingSettings: {
      strategy: new StaticRoutingStrategy({ gateway, logger: quietLogger }),
    },
    dataRetrievalStrategy,
  });

  const response = await wayfinder.request(
    `ar://${FIXTURES.bundledDataItem.id}`,
  );
  assert.strictEqual(response.status, 200);
  return new Uint8Array(await response.arrayBuffer());
}

describe('e2e: data retrieval strategies', { timeout: E2E_TIMEOUT_MS }, () => {
  it('ContiguousDataRetrievalStrategy fetches the full payload', async () => {
    const data = await fetchWith(
      new ContiguousDataRetrievalStrategy({ logger: quietLogger }),
    );

    assert.strictEqual(data.byteLength, FIXTURES.bundledDataItem.size);
  });

  describe('chunk retrieval prerequisites', () => {
    it('the data response carries the x-ar-io-root headers', async () => {
      const response = await fetch(
        `${TRUSTED_GATEWAY}/${FIXTURES.bundledDataItem.id}`,
        { redirect: 'follow', signal: AbortSignal.timeout(30_000) },
      );
      await response.arrayBuffer();

      assert.strictEqual(
        response.headers.get('x-ar-io-root-transaction-id'),
        FIXTURES.bundledDataItem.rootTxId,
      );
      assert.ok(
        response.headers.get('x-ar-io-root-data-offset'),
        'missing x-ar-io-root-data-offset header',
      );
    });

    it('the /tx/<root>/offset endpoint responds', async () => {
      const response = await fetch(
        `${TRUSTED_GATEWAY}/tx/${FIXTURES.bundledDataItem.rootTxId}/offset`,
        { signal: AbortSignal.timeout(30_000) },
      );

      assert.ok(response.ok, `offset endpoint returned ${response.status}`);
      const body = (await response.json()) as {
        offset: string;
        size: string;
      };
      assert.ok(Number(body.offset) > 0);
      assert.ok(Number(body.size) > 0);
    });

    /**
     * The chunk endpoint must return the `X-Arweave-Chunk-*` headers that the
     * strategy uses to confirm each chunk belongs to the expected transaction.
     * A 200 without those headers is worse than a 404 — it looks like success.
     */
    it('a gateway serves /chunk/<offset>/data with the X-Arweave-Chunk headers', async () => {
      const offsetResponse = await fetch(
        `${TRUSTED_GATEWAY}/tx/${FIXTURES.bundledDataItem.rootTxId}/offset`,
        { signal: AbortSignal.timeout(30_000) },
      );
      const { offset, size } = (await offsetResponse.json()) as {
        offset: string;
        size: string;
      };
      const startOffset = BigInt(offset) - BigInt(size) + 1n;

      const attempts: string[] = [];
      for (const gateway of [TRUSTED_GATEWAY, ...FALLBACK_GATEWAYS]) {
        const response = await fetch(`${gateway}/chunk/${startOffset}/data`, {
          signal: AbortSignal.timeout(30_000),
        }).catch(() => undefined);

        if (response?.ok && response.headers.get('X-Arweave-Chunk-Tx-Id')) {
          await response.arrayBuffer();
          return;
        }
        attempts.push(
          `${gateway} -> ${response ? response.status : 'network error'}` +
            (response?.ok ? ' (200 but no X-Arweave-Chunk-Tx-Id header)' : ''),
        );
        await response?.arrayBuffer().catch(() => undefined);
      }

      assert.fail(
        `No gateway served a usable chunk response. ${attempts.join('; ')}`,
      );
    });
  });

  it('ChunkDataRetrievalStrategy returns bytes identical to contiguous retrieval', async () => {
    const [contiguous, chunked] = await Promise.all([
      fetchWith(new ContiguousDataRetrievalStrategy({ logger: quietLogger })),
      fetchWith(new ChunkDataRetrievalStrategy({ logger: quietLogger })),
    ]);

    assert.strictEqual(chunked.byteLength, contiguous.byteLength);
    assert.ok(
      Buffer.from(chunked).equals(Buffer.from(contiguous)),
      'chunked bytes differ from contiguous bytes',
    );
  });

  it('ChunkDataRetrievalStrategy reports a clear error for a plain L1 transaction', async () => {
    // L1 transactions carry no x-ar-io-root-* headers, so the chunk strategy
    // cannot apply. It should say why rather than fail obscurely.
    const wayfinder = new Wayfinder({
      logger: quietLogger,
      routingSettings: {
        strategy: new StaticRoutingStrategy({
          gateway: TRUSTED_GATEWAY,
          logger: quietLogger,
        }),
      },
      dataRetrievalStrategy: new ChunkDataRetrievalStrategy({
        logger: quietLogger,
      }),
    });

    // The exact message depends on where it gives up first (the metadata HEAD
    // or the missing root headers); what matters is that it fails loudly
    // instead of returning bytes it could not assemble.
    await assert.rejects(async () => {
      const response = await wayfinder.request(
        `ar://${FIXTURES.l1FormatOne.id}`,
      );
      await response.arrayBuffer();
    }, /root transaction ID|root data offset|HEAD request failed/i);
  });
});
