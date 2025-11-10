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
import { ContiguousDataRetrievalStrategy } from './contiguous.js';

describe('ContiguousDataRetrievalStrategy', () => {
  const mockLogger = {
    debug: mock.fn(),
    info: mock.fn(),
    warn: mock.fn(),
    error: mock.fn(),
  };

  const testTxId = 'AAocz1fpnnc9OMAHkbB5ehdLdiiHZcPP3Jl0NWiuMeg';
  const testRootTxId = '3FxLK9BkvS4U-pwyPEIc8X1c2-Wbrs9Kq6p8utVRdLY';
  const testDataContent = 'Test data content for unit testing';
  const testGateway = new URL('http://localhost:3000');

  it('should fetch data using direct GET request', async () => {
    const mockResponseHeaders = new Headers({
      'content-length': testDataContent.length.toString(),
      [arioHeaderNames.rootTransactionId]: testRootTxId,
      [arioHeaderNames.rootDataOffset]: '1234',
      'x-wayfinder-data-retrieval-strategy': 'contiguous',
    });

    const mockFetch = mock.fn(
      async (url: string | URL | Request, init?: any) => {
        assert.strictEqual(
          url.toString(),
          'http://localhost:3000/AAocz1fpnnc9OMAHkbB5ehdLdiiHZcPP3Jl0NWiuMeg',
        );
        assert.strictEqual(init?.method, 'GET');

        return new Response(testDataContent, {
          status: 200,
          headers: mockResponseHeaders,
        });
      },
    );

    const strategy = new ContiguousDataRetrievalStrategy({
      logger: mockLogger,
      fetch: mockFetch,
    });

    const requestUrl = new URL(`/${testTxId}`, testGateway);
    const response = await strategy.getData({
      requestUrl,
      headers: { 'test-header': 'test-value' },
    });

    assert.strictEqual(response.ok, true);
    assert.strictEqual(response.status, 200);
    assert.strictEqual(await response.text(), testDataContent);
    assert.strictEqual(mockFetch.mock.callCount(), 1);
    assert.strictEqual(
      response.headers.get('x-wayfinder-data-retrieval-strategy'),
      'contiguous',
    );
  });

  it('should handle 404 response gracefully', async () => {
    const mockFetch = mock.fn(
      async (_url: string | URL | Request, _init?: any) => {
        return new Response('Not Found', { status: 404 });
      },
    );

    const strategy = new ContiguousDataRetrievalStrategy({
      logger: mockLogger,
      fetch: mockFetch,
    });

    const requestUrl = new URL(`/${testTxId}`, testGateway);
    const response = await strategy.getData({
      requestUrl,
    });

    assert.strictEqual(response.status, 404);
    assert.strictEqual(await response.text(), 'Not Found');
    assert.strictEqual(mockFetch.mock.callCount(), 1);
  });

  it('should pass through request headers', async () => {
    const testHeaders = {
      Authorization: 'Bearer token123',
      'Custom-Header': 'custom-value',
    };

    const mockFetch = mock.fn(
      async (_url: string | URL | Request, init?: any) => {
        assert.strictEqual(init?.headers?.['Authorization'], 'Bearer token123');
        assert.strictEqual(init?.headers?.['Custom-Header'], 'custom-value');

        return new Response(testDataContent, {
          status: 200,
          headers: { 'content-length': testDataContent.length.toString() },
        });
      },
    );

    const strategy = new ContiguousDataRetrievalStrategy({
      logger: mockLogger,
      fetch: mockFetch,
    });

    const requestUrl = new URL(`/${testTxId}`, testGateway);
    await strategy.getData({
      requestUrl,
      headers: testHeaders,
    });

    assert.strictEqual(mockFetch.mock.callCount(), 1);
  });

  it('should log debug information', async () => {
    const freshMockLogger = {
      debug: mock.fn(),
      info: mock.fn(),
      warn: mock.fn(),
      error: mock.fn(),
    };

    const mockFetch = mock.fn(
      async (_url: string | URL | Request, _init?: any) => {
        return new Response(testDataContent, { status: 200 });
      },
    );

    const strategy = new ContiguousDataRetrievalStrategy({
      logger: freshMockLogger,
      fetch: mockFetch,
    });

    const requestUrl = new URL(`/${testTxId}`, testGateway);
    await strategy.getData({
      requestUrl,
    });

    assert.strictEqual(freshMockLogger.debug.mock.callCount(), 1);
    assert.strictEqual(
      freshMockLogger.debug.mock.calls[0]?.arguments[0],
      'Fetching contiguous transaction data',
    );
  });
});
