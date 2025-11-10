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

import assert from 'node:assert';
import { describe, it, mock } from 'node:test';

import { arioHeaderNames } from '../constants.js';
import { ChunkDataRetrievalStrategy } from './chunk.js';

describe('ChunkDataRetrievalStrategy', () => {
  const mockLogger = {
    debug: mock.fn(),
    info: mock.fn(),
    warn: mock.fn(),
    error: mock.fn(),
  };

  // Test data based on our actual transaction
  const testTxId = 'AAocz1fpnnc9OMAHkbB5ehdLdiiHZcPP3Jl0NWiuMeg';
  const testRootTxId = '3FxLK9BkvS4U-pwyPEIc8X1c2-Wbrs9Kq6p8utVRdLY';
  const testRootTxSize = '2018666';
  const testRootTxEndOffset = '2018665'; // End offset from /tx/{id}/offset
  const testRelativeRootOffset = '2016'; // From X-AR-IO-Root-Data-Offset header
  const testDataContent = 'Test bundled data item content for unit testing';
  const testGateway = new URL('http://localhost:3000');

  // Calculated values based on our real data
  const expectedRootTxStartOffset =
    parseInt(testRootTxEndOffset) - parseInt(testRootTxSize) + 1; // -1048001
  const expectedDataItemOffset =
    expectedRootTxStartOffset + parseInt(testRelativeRootOffset); // -1045985

  function createMockChunkResponse(
    content: string,
    options: {
      chunkStartOffset?: string;
      chunkReadOffset?: string;
      chunkTxId?: string;
    } = {},
  ) {
    const {
      chunkStartOffset = expectedDataItemOffset.toString(),
      chunkReadOffset = '0',
      chunkTxId = testRootTxId,
    } = options;

    const chunkData = new Uint8Array(256000); // Standard chunk size
    const contentBytes = new TextEncoder().encode(content);
    chunkData.set(contentBytes, parseInt(chunkReadOffset));

    return new Response(chunkData, {
      status: 200,
      headers: {
        [arioHeaderNames.chunkStartOffset]: chunkStartOffset,
        [arioHeaderNames.chunkReadOffset]: chunkReadOffset,
        [arioHeaderNames.chunkTxId]: chunkTxId,
      },
    });
  }

  it('should fetch data using chunk API with correct offset calculations', async () => {
    let callCount = 0;

    const mockFetch = mock.fn(
      async (_url: string | URL | Request, _init?: any) => {
        callCount++;

        if (callCount === 1) {
          // HEAD request
          assert.ok(_url.toString().includes(testTxId));
          assert.strictEqual(_init?.method, 'HEAD');

          return new Response(null, {
            status: 200,
            headers: {
              'content-length': testDataContent.length.toString(),
              [arioHeaderNames.rootTransactionId]: testRootTxId,
              [arioHeaderNames.rootDataOffset]: testRelativeRootOffset,
            },
          });
        } else if (callCount === 2) {
          // Offset request
          assert.strictEqual(
            _url.toString(),
            `http://localhost:3000/tx/${testRootTxId}/offset`,
          );
          assert.strictEqual(_init?.method, 'GET');

          return new Response(
            JSON.stringify({
              offset: testRootTxEndOffset,
              size: testRootTxSize,
            }),
            {
              status: 200,
              headers: { 'content-type': 'application/json' },
            },
          );
        } else if (callCount === 3) {
          // Chunk request
          assert.strictEqual(
            _url.toString(),
            `http://localhost:3000/chunk/${expectedDataItemOffset}/data`,
          );
          assert.strictEqual(_init?.method, 'GET');

          return createMockChunkResponse(testDataContent);
        }

        throw new Error(`Unexpected call ${callCount} to ${_url.toString()}`);
      },
    );

    const strategy = new ChunkDataRetrievalStrategy({
      logger: mockLogger,
      fetch: mockFetch,
    });

    const requestUrl = new URL(`/${testTxId}`, testGateway);
    const response = await strategy.getData({
      gateway: testGateway,
      requestUrl,
      headers: { 'test-header': 'test-value' },
    });

    assert.strictEqual(response.ok, true);
    assert.strictEqual(response.status, 200);
    assert.strictEqual(
      response.headers.get('x-wayfinder-data-retrieval-strategy'),
      'chunk',
    );

    // Verify the content is correctly extracted from chunks
    const responseData = await response.text();
    assert.strictEqual(responseData, testDataContent);
    assert.strictEqual(mockFetch.mock.callCount(), 3);
  });

  it('should handle missing root transaction ID header', async () => {
    const mockFetch = mock.fn(
      async (_url: string | URL | Request, init?: any) => {
        if (init?.method === 'HEAD') {
          return new Response(null, {
            status: 200,
            headers: {
              'content-length': testDataContent.length.toString(),
              // Missing X-AR-IO-Root-Transaction-Id header
            },
          });
        }
        throw new Error('Unexpected request');
      },
    );

    const strategy = new ChunkDataRetrievalStrategy({
      logger: mockLogger,
      fetch: mockFetch,
    });

    const requestUrl = new URL(`/${testTxId}`, testGateway);

    await assert.rejects(
      async () => {
        await strategy.getData({
          gateway: testGateway,
          requestUrl,
        });
      },
      {
        message: 'No root transaction ID header present - cannot use chunk API',
      },
    );
  });

  it('should handle missing root data offset header', async () => {
    const mockFetch = mock.fn(
      async (_url: string | URL | Request, init?: any) => {
        if (init?.method === 'HEAD') {
          return new Response(null, {
            status: 200,
            headers: {
              'content-length': testDataContent.length.toString(),
              [arioHeaderNames.rootTransactionId]: testRootTxId,
              // Missing X-AR-IO-Root-Data-Offset header
            },
          });
        }
        throw new Error('Unexpected request');
      },
    );

    const strategy = new ChunkDataRetrievalStrategy({
      logger: mockLogger,
      fetch: mockFetch,
    });

    const requestUrl = new URL(`/${testTxId}`, testGateway);

    await assert.rejects(
      async () => {
        await strategy.getData({
          gateway: testGateway,
          requestUrl,
        });
      },
      {
        message: 'No root data offset header present - cannot use chunk API',
      },
    );
  });

  it('should handle failed offset request', async () => {
    let callCount = 0;

    const mockFetch = mock.fn(
      async (_url: string | URL | Request, _init?: any) => {
        callCount++;

        if (callCount === 1) {
          // HEAD request
          return new Response(null, {
            status: 200,
            headers: {
              'content-length': testDataContent.length.toString(),
              [arioHeaderNames.rootTransactionId]: testRootTxId,
              [arioHeaderNames.rootDataOffset]: testRelativeRootOffset,
            },
          });
        } else if (callCount === 2) {
          // Failed offset request
          return new Response('Not Found', { status: 404 });
        }

        throw new Error(`Unexpected call ${callCount}`);
      },
    );

    const strategy = new ChunkDataRetrievalStrategy({
      logger: mockLogger,
      fetch: mockFetch,
    });

    const requestUrl = new URL(`/${testTxId}`, testGateway);

    await assert.rejects(
      async () => {
        await strategy.getData({
          gateway: testGateway,
          requestUrl,
        });
      },
      {
        message: 'Failed to fetch offset for root transaction ID: 404',
      },
    );
  });

  it('should validate chunk transaction ID matches root transaction ID', async () => {
    let callCount = 0;

    const mockFetch = mock.fn(
      async (_url: string | URL | Request, _init?: any) => {
        callCount++;

        if (callCount === 1) {
          // HEAD request
          return new Response(null, {
            status: 200,
            headers: {
              'content-length': testDataContent.length.toString(),
              [arioHeaderNames.rootTransactionId]: testRootTxId,
              [arioHeaderNames.rootDataOffset]: testRelativeRootOffset,
            },
          });
        } else if (callCount === 2) {
          // Offset request
          return new Response(
            JSON.stringify({
              offset: testRootTxEndOffset,
              size: testRootTxSize,
            }),
            {
              status: 200,
              headers: { 'content-type': 'application/json' },
            },
          );
        } else if (callCount === 3) {
          // Chunk request with wrong transaction ID
          return createMockChunkResponse(testDataContent, {
            chunkTxId: 'WrongTransactionId123456789012345678901234567',
          });
        }

        throw new Error(`Unexpected call ${callCount}`);
      },
    );

    const strategy = new ChunkDataRetrievalStrategy({
      logger: mockLogger,
      fetch: mockFetch,
    });

    const requestUrl = new URL(`/${testTxId}`, testGateway);

    await assert.rejects(
      async () => {
        const response = await strategy.getData({
          gateway: testGateway,
          requestUrl,
        });

        // Consume the stream to trigger the validation
        await response.text();
      },
      (error: Error) => {
        return error.message.includes('Chunk transaction ID mismatch');
      },
    );
  });

  it('should handle single-chunk data retrieval with chunk read offset', async () => {
    let callCount = 0;
    const actualContent = 'This is our actual content.';
    const readOffset = 30; // Start reading from this offset in the chunk

    const mockFetch = mock.fn(
      async (_url: string | URL | Request, _init?: any) => {
        callCount++;

        if (callCount === 1) {
          // HEAD request
          return new Response(null, {
            status: 200,
            headers: {
              'content-length': actualContent.length.toString(),
              [arioHeaderNames.rootTransactionId]: testRootTxId,
              [arioHeaderNames.rootDataOffset]: testRelativeRootOffset,
            },
          });
        } else if (callCount === 2) {
          // Offset request
          return new Response(
            JSON.stringify({
              offset: testRootTxEndOffset,
              size: testRootTxSize,
            }),
            {
              status: 200,
              headers: { 'content-type': 'application/json' },
            },
          );
        } else if (callCount === 3) {
          // Create chunk with data at the read offset
          const chunkData = new Uint8Array(256000);
          const contentBytes = new TextEncoder().encode(actualContent);
          chunkData.set(contentBytes, readOffset); // Put content at the read offset

          return new Response(chunkData, {
            status: 200,
            headers: {
              [arioHeaderNames.chunkStartOffset]:
                expectedDataItemOffset.toString(),
              [arioHeaderNames.chunkReadOffset]: readOffset.toString(),
              [arioHeaderNames.chunkTxId]: testRootTxId,
            },
          });
        }

        throw new Error(`Unexpected call ${callCount} to ${_url.toString()}`);
      },
    );

    const strategy = new ChunkDataRetrievalStrategy({
      logger: mockLogger,
      fetch: mockFetch,
    });

    const requestUrl = new URL(`/${testTxId}`, testGateway);
    const response = await strategy.getData({
      gateway: testGateway,
      requestUrl,
    });

    const responseData = await response.text();
    assert.strictEqual(responseData, actualContent);
    assert.strictEqual(mockFetch.mock.callCount(), 3);
  });

  it('should pass through request headers to all requests', async () => {
    let callCount = 0;
    const testHeaders = {
      Authorization: 'Bearer token123',
      'Custom-Header': 'custom-value',
    };

    const mockFetch = mock.fn(
      async (_url: string | URL | Request, _init?: any) => {
        callCount++;

        // Verify headers are passed to all requests
        assert.strictEqual(
          _init?.headers?.['Authorization'],
          'Bearer token123',
        );
        assert.strictEqual(_init?.headers?.['Custom-Header'], 'custom-value');

        if (callCount === 1) {
          return new Response(null, {
            status: 200,
            headers: {
              'content-length': testDataContent.length.toString(),
              [arioHeaderNames.rootTransactionId]: testRootTxId,
              [arioHeaderNames.rootDataOffset]: testRelativeRootOffset,
            },
          });
        } else if (callCount === 2) {
          return new Response(
            JSON.stringify({
              offset: testRootTxEndOffset,
              size: testRootTxSize,
            }),
            {
              status: 200,
              headers: { 'content-type': 'application/json' },
            },
          );
        } else if (callCount === 3) {
          return createMockChunkResponse(testDataContent);
        }

        throw new Error(`Unexpected call ${callCount}`);
      },
    );

    const strategy = new ChunkDataRetrievalStrategy({
      logger: mockLogger,
      fetch: mockFetch,
    });

    const requestUrl = new URL(`/${testTxId}`, testGateway);
    const response = await strategy.getData({
      gateway: testGateway,
      requestUrl,
      headers: testHeaders,
    });

    await response.text();
    assert.strictEqual(mockFetch.mock.callCount(), 3);
  });
});
