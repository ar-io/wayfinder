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
import { RemoteVerificationStrategy } from './remote-verification.js';

describe('RemoteVerificationStrategy', () => {
  describe('constructor', () => {
    it('should initialize with empty trustedGateways array', () => {
      const strategy = new RemoteVerificationStrategy();
      assert.deepStrictEqual(strategy.trustedGateways, []);
    });
  });

  describe('verifyData', () => {
    it('should pass verification when x-ar-io-verified header is "true"', async () => {
      const strategy = new RemoteVerificationStrategy();
      await assert.doesNotReject(async () => {
        await strategy.verifyData({
          headers: {
            'x-ar-io-verified': 'true',
            'content-type': 'application/json',
          },
          txId: 'test-tx-id',
        });
      });
    });

    it('should throw error when x-ar-io-verified header is missing', async () => {
      const strategy = new RemoteVerificationStrategy();

      await assert.rejects(
        async () => {
          await strategy.verifyData({
            headers: {
              'content-type': 'application/json',
            },
            txId: 'test-tx-id',
          });
        },
        {
          name: 'Error',
          message: 'Data was not verified by gateway.',
        },
      );
    });

    it('should throw error when x-ar-io-verified header is "false"', async () => {
      const strategy = new RemoteVerificationStrategy();

      await assert.rejects(
        async () => {
          await strategy.verifyData({
            headers: {
              'x-ar-io-verified': 'false',
              'content-type': 'application/json',
            },
            txId: 'test-tx-id',
          });
        },
        {
          name: 'Error',
          message: 'Data was not verified by gateway.',
        },
      );
    });

    it('should throw error when x-ar-io-verified header is not "true" (case sensitive)', async () => {
      const strategy = new RemoteVerificationStrategy();

      const testCases = ['True', 'TRUE', 'yes', '1', 'verified'];

      for (const headerValue of testCases) {
        await assert.rejects(
          async () => {
            await strategy.verifyData({
              headers: {
                'x-ar-io-verified': headerValue,
                'content-type': 'application/json',
              },
              txId: 'test-tx-id',
            });
          },
          {
            name: 'Error',
            message: 'Data was not verified by gateway.',
          },
          `Should reject header value: ${headerValue}`,
        );
      }
    });

    it('should handle empty headers object', async () => {
      const strategy = new RemoteVerificationStrategy();

      await assert.rejects(
        async () => {
          await strategy.verifyData({
            headers: {},
            txId: 'test-tx-id',
          });
        },
        {
          name: 'Error',
          message: 'Data was not verified by gateway.',
        },
      );
    });

    it('should handle headers with different casing (case insensitive)', async () => {
      const strategy = new RemoteVerificationStrategy();

      await assert.doesNotReject(async () => {
        await strategy.verifyData({
          headers: {
            'X-AR-IO-VERIFIED': 'true',
            'Content-Type': 'application/json',
          },
          txId: 'test-tx-id',
        });
      });
    });

    it('should ignore data stream and only check headers', async () => {
      const strategy = new RemoteVerificationStrategy();

      const mockData = new ReadableStream({
        start(controller) {
          controller.error(new Error('Stream error'));
        },
      });

      await assert.doesNotReject(async () => {
        await strategy.verifyData({
          data: mockData,
          headers: {
            'x-ar-io-verified': 'true',
          },
          txId: 'test-tx-id',
        });
      });
    });

    it('should work with async iterable data stream', async () => {
      const strategy = new RemoteVerificationStrategy();

      async function* mockAsyncIterable() {
        yield new Uint8Array([1, 2, 3]);
        yield new Uint8Array([4, 5, 6]);
      }

      await assert.doesNotReject(async () => {
        await strategy.verifyData({
          data: mockAsyncIterable(),
          headers: {
            'x-ar-io-verified': 'true',
          },
          txId: 'test-tx-id',
        });
      });
    });

    it('should work with null data stream', async () => {
      const strategy = new RemoteVerificationStrategy();

      await assert.doesNotReject(async () => {
        await strategy.verifyData({
          data: null as any,
          headers: {
            'x-ar-io-verified': 'true',
          },
          txId: 'test-tx-id',
        });
      });
    });

    it('should work with undefined txId', async () => {
      const strategy = new RemoteVerificationStrategy();

      await assert.doesNotReject(async () => {
        await strategy.verifyData({
          headers: {
            'x-ar-io-verified': 'true',
          },
          txId: undefined as any,
        });
      });
    });

    it('should handle headers with whitespace in value', async () => {
      const strategy = new RemoteVerificationStrategy();
      await assert.doesNotReject(async () => {
        await strategy.verifyData({
          headers: {
            'x-ar-io-verified': ' true ',
            'content-type': 'application/json',
          },
          txId: 'test-tx-id',
        });
      });
    });

    it('should handle multiple headers with x-ar-io-verified', async () => {
      const strategy = new RemoteVerificationStrategy();

      await assert.doesNotReject(async () => {
        await strategy.verifyData({
          headers: {
            'x-ar-io-verified': 'true',
            'content-type': 'application/json',
            'x-custom-header': 'custom-value',
          },
          txId: 'test-tx-id',
        });
      });
    });
  });

  describe('integration with VerificationStrategy interface', () => {
    it('should implement VerificationStrategy interface correctly', () => {
      const strategy = new RemoteVerificationStrategy();

      assert.ok(Array.isArray(strategy.trustedGateways));
      assert.strictEqual(typeof strategy.verifyData, 'function');
      assert.strictEqual(strategy.verifyData.length, 1);
    });

    it('should have correct trustedGateways property type', () => {
      const strategy = new RemoteVerificationStrategy();

      assert.ok(strategy.trustedGateways instanceof Array);
      assert.strictEqual(strategy.trustedGateways.length, 0);
    });
  });
});
