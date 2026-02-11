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

import { TrustedGatewayRootTransactionSource } from './trusted-gateway.js';

const mockLogger = {
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

const testTxId = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const testRootTxId = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

function createMockFetch(
  responseHeaders: Record<string, string>,
  status = 200,
): typeof globalThis.fetch {
  return (async () => {
    return new Response(null, {
      status,
      headers: new Headers(responseHeaders),
    });
  }) as unknown as typeof globalThis.fetch;
}

describe('TrustedGatewayRootTransactionSource', () => {
  it('should return data item info when root-transaction-id header differs from txId', async () => {
    const source = new TrustedGatewayRootTransactionSource({
      trustedGateways: [new URL('https://gateway1.example.com')],
      logger: mockLogger,
      fetch: createMockFetch({
        'x-ar-io-root-transaction-id': testRootTxId,
        'x-ar-io-root-data-item-offset': '512',
        'x-ar-io-root-data-offset': '1024',
      }),
    });

    const result = await source.getRootTransaction({ txId: testTxId });
    assert.equal(result.rootTransactionId, testRootTxId);
    assert.equal(result.rootDataItemOffset, 512);
    assert.equal(result.rootDataOffset, 1024);
    assert.equal(result.isDataItem, true);
  });

  it('should return L1 identity when root-transaction-id matches txId', async () => {
    const source = new TrustedGatewayRootTransactionSource({
      trustedGateways: [new URL('https://gateway1.example.com')],
      logger: mockLogger,
      fetch: createMockFetch({
        'x-ar-io-root-transaction-id': testTxId,
      }),
    });

    const result = await source.getRootTransaction({ txId: testTxId });
    assert.equal(result.rootTransactionId, testTxId);
    assert.equal(result.isDataItem, false);
  });

  it('should return L1 identity when root-transaction-id header is absent', async () => {
    const source = new TrustedGatewayRootTransactionSource({
      trustedGateways: [new URL('https://gateway1.example.com')],
      logger: mockLogger,
      fetch: createMockFetch({}),
    });

    const result = await source.getRootTransaction({ txId: testTxId });
    assert.equal(result.rootTransactionId, testTxId);
    assert.equal(result.isDataItem, false);
  });

  it('should extract rootDataItemOffset and rootDataOffset from headers', async () => {
    const source = new TrustedGatewayRootTransactionSource({
      trustedGateways: [new URL('https://gateway1.example.com')],
      logger: mockLogger,
      fetch: createMockFetch({
        'x-ar-io-root-transaction-id': testRootTxId,
        'x-ar-io-root-data-item-offset': '256',
        'x-ar-io-root-data-offset': '512',
      }),
    });

    const result = await source.getRootTransaction({ txId: testTxId });
    assert.equal(result.rootDataItemOffset, 256);
    assert.equal(result.rootDataOffset, 512);
  });

  it('should try next gateway on failure', async () => {
    let callCount = 0;
    const mockFetch = (async () => {
      callCount++;
      if (callCount === 1) {
        return new Response(null, { status: 500 });
      }
      return new Response(null, {
        status: 200,
        headers: new Headers({
          'x-ar-io-root-transaction-id': testRootTxId,
        }),
      });
    }) as unknown as typeof globalThis.fetch;

    const source = new TrustedGatewayRootTransactionSource({
      trustedGateways: [
        new URL('https://failing-gateway.example.com'),
        new URL('https://working-gateway.example.com'),
      ],
      logger: mockLogger,
      fetch: mockFetch,
    });

    const result = await source.getRootTransaction({ txId: testTxId });
    assert.equal(result.rootTransactionId, testRootTxId);
    assert.equal(result.isDataItem, true);
    assert.equal(callCount, 2);
  });

  it('should throw when all gateways fail', async () => {
    const source = new TrustedGatewayRootTransactionSource({
      trustedGateways: [
        new URL('https://gateway1.example.com'),
        new URL('https://gateway2.example.com'),
      ],
      logger: mockLogger,
      fetch: createMockFetch({}, 500),
    });

    await assert.rejects(
      async () => source.getRootTransaction({ txId: testTxId }),
      /Failed to get root transaction info from any trusted gateway/,
    );
  });

  it('should handle fetch errors gracefully and try next gateway', async () => {
    let callCount = 0;
    const mockFetch = (async () => {
      callCount++;
      if (callCount === 1) {
        throw new Error('Network error');
      }
      return new Response(null, {
        status: 200,
        headers: new Headers({
          'x-ar-io-root-transaction-id': testRootTxId,
        }),
      });
    }) as unknown as typeof globalThis.fetch;

    const source = new TrustedGatewayRootTransactionSource({
      trustedGateways: [
        new URL('https://broken-gateway.example.com'),
        new URL('https://working-gateway.example.com'),
      ],
      logger: mockLogger,
      fetch: mockFetch,
    });

    const result = await source.getRootTransaction({ txId: testTxId });
    assert.equal(result.rootTransactionId, testRootTxId);
    assert.equal(result.isDataItem, true);
  });
});
