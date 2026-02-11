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

import { GqlRootTransactionSource } from './gql.js';

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

function createGqlResponse(node: unknown): typeof globalThis.fetch {
  return (async () => {
    return new Response(
      JSON.stringify({
        data: {
          transactions: {
            edges: node ? [{ node }] : [],
          },
        },
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }) as unknown as typeof globalThis.fetch;
}

describe('GqlRootTransactionSource', () => {
  it('should return data item info when bundledIn is present', async () => {
    const source = new GqlRootTransactionSource({
      gqlEndpoints: ['https://gql.example.com/graphql'],
      logger: mockLogger,
      fetch: createGqlResponse({
        id: testTxId,
        bundledIn: { id: testRootTxId },
      }),
    });

    const result = await source.getRootTransaction({ txId: testTxId });
    assert.equal(result.rootTransactionId, testRootTxId);
    assert.equal(result.isDataItem, true);
    assert.equal(result.rootDataItemOffset, undefined);
    assert.equal(result.rootDataOffset, undefined);
  });

  it('should return L1 identity when bundledIn is null', async () => {
    const source = new GqlRootTransactionSource({
      gqlEndpoints: ['https://gql.example.com/graphql'],
      logger: mockLogger,
      fetch: createGqlResponse({
        id: testTxId,
        bundledIn: null,
      }),
    });

    const result = await source.getRootTransaction({ txId: testTxId });
    assert.equal(result.rootTransactionId, testTxId);
    assert.equal(result.isDataItem, false);
  });

  it('should return L1 identity when bundledIn is absent', async () => {
    const source = new GqlRootTransactionSource({
      gqlEndpoints: ['https://gql.example.com/graphql'],
      logger: mockLogger,
      fetch: createGqlResponse({ id: testTxId }),
    });

    const result = await source.getRootTransaction({ txId: testTxId });
    assert.equal(result.rootTransactionId, testTxId);
    assert.equal(result.isDataItem, false);
  });

  it('should try next endpoint on failure', async () => {
    let callCount = 0;
    const mockFetch = (async () => {
      callCount++;
      if (callCount === 1) {
        return new Response(null, { status: 500 });
      }
      return new Response(
        JSON.stringify({
          data: {
            transactions: {
              edges: [
                { node: { id: testTxId, bundledIn: { id: testRootTxId } } },
              ],
            },
          },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }) as unknown as typeof globalThis.fetch;

    const source = new GqlRootTransactionSource({
      gqlEndpoints: [
        'https://failing.example.com/graphql',
        'https://working.example.com/graphql',
      ],
      logger: mockLogger,
      fetch: mockFetch,
    });

    const result = await source.getRootTransaction({ txId: testTxId });
    assert.equal(result.rootTransactionId, testRootTxId);
    assert.equal(result.isDataItem, true);
    assert.equal(callCount, 2);
  });

  it('should try next endpoint when transaction not found in response', async () => {
    let callCount = 0;
    const mockFetch = (async () => {
      callCount++;
      if (callCount === 1) {
        // Empty edges array - tx not found
        return new Response(
          JSON.stringify({
            data: { transactions: { edges: [] } },
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }
      return new Response(
        JSON.stringify({
          data: {
            transactions: {
              edges: [
                { node: { id: testTxId, bundledIn: { id: testRootTxId } } },
              ],
            },
          },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }) as unknown as typeof globalThis.fetch;

    const source = new GqlRootTransactionSource({
      gqlEndpoints: [
        'https://empty.example.com/graphql',
        'https://working.example.com/graphql',
      ],
      logger: mockLogger,
      fetch: mockFetch,
    });

    const result = await source.getRootTransaction({ txId: testTxId });
    assert.equal(result.rootTransactionId, testRootTxId);
    assert.equal(callCount, 2);
  });

  it('should throw when all endpoints fail', async () => {
    const source = new GqlRootTransactionSource({
      gqlEndpoints: [
        'https://gql1.example.com/graphql',
        'https://gql2.example.com/graphql',
      ],
      logger: mockLogger,
      fetch: (async () => {
        return new Response(null, { status: 500 });
      }) as unknown as typeof globalThis.fetch,
    });

    await assert.rejects(
      async () => source.getRootTransaction({ txId: testTxId }),
      /Failed to get root transaction info from any GQL endpoint/,
    );
  });

  it('should handle fetch errors gracefully and try next endpoint', async () => {
    let callCount = 0;
    const mockFetch = (async () => {
      callCount++;
      if (callCount === 1) {
        throw new Error('Network error');
      }
      return new Response(
        JSON.stringify({
          data: {
            transactions: {
              edges: [
                { node: { id: testTxId, bundledIn: { id: testRootTxId } } },
              ],
            },
          },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }) as unknown as typeof globalThis.fetch;

    const source = new GqlRootTransactionSource({
      gqlEndpoints: [
        'https://broken.example.com/graphql',
        'https://working.example.com/graphql',
      ],
      logger: mockLogger,
      fetch: mockFetch,
    });

    const result = await source.getRootTransaction({ txId: testTxId });
    assert.equal(result.rootTransactionId, testRootTxId);
    assert.equal(result.isDataItem, true);
  });

  it('should work with default constructor parameters', async () => {
    const source = new GqlRootTransactionSource({
      fetch: createGqlResponse({
        id: testTxId,
        bundledIn: { id: testRootTxId },
      }),
    });

    const result = await source.getRootTransaction({ txId: testTxId });
    assert.equal(result.rootTransactionId, testRootTxId);
    assert.equal(result.isDataItem, true);
  });

  it('should send correct GQL query with txId variable', async () => {
    let capturedBody: string | undefined;
    const capturingFetch = (async (_url: unknown, init: RequestInit) => {
      capturedBody = init.body as string;
      return new Response(
        JSON.stringify({
          data: {
            transactions: {
              edges: [{ node: { id: testTxId, bundledIn: null } }],
            },
          },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }) as unknown as typeof globalThis.fetch;

    const source = new GqlRootTransactionSource({
      gqlEndpoints: ['https://gql.example.com/graphql'],
      logger: mockLogger,
      fetch: capturingFetch,
    });

    await source.getRootTransaction({ txId: testTxId });

    assert.ok(capturedBody);
    const parsed = JSON.parse(capturedBody);
    assert.equal(parsed.variables.id, testTxId);
    assert.ok(parsed.query.includes('bundledIn'));
    assert.ok(parsed.query.includes('transactions'));
  });
});
