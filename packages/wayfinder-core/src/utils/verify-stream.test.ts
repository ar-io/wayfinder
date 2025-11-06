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
import { describe, it } from 'node:test';
import { WayfinderEmitter } from '../emitter.js';
import { tapAndVerifyReadableStream } from './verify-stream.js';

describe('tapAndVerifyReadableStream', () => {
  describe('strict mode enabled', () => {
    it('should duplicate the ReadableStream, verify the first and return the second if verification passes', async () => {
      // create a simple readable
      const chunks = [
        Buffer.from('foo'),
        Buffer.from('bar'),
        Buffer.from('baz'),
      ];
      const contentLength = chunks.reduce((sum, c) => sum + c.length, 0);

      // a stream that will emit chunks
      const originalStream = new ReadableStream({
        start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(chunk);
          }
          controller.close();
        },
      });
      let seen = Buffer.alloc(0);
      const verifyData = async ({
        data,
      }: {
        data: AsyncIterable<Uint8Array>;
      }): Promise<void> => {
        // verify the data
        for await (const chunk of data) {
          seen = Buffer.concat([seen, chunk]);
        }
        return;
      };

      const txId = 'test-tx-1';
      const emitter = new WayfinderEmitter();
      const events: any[] = [];
      emitter.on('verification-progress', (e) =>
        events.push({ type: 'verification-progress', ...e }),
      );
      emitter.on('verification-succeeded', (e) =>
        events.push({ type: 'verification-succeeded', ...e }),
      );

      // tap with verification
      const tapped = tapAndVerifyReadableStream({
        originalStream,
        contentLength,
        verifyData,
        txId,
        emitter,
        strict: true,
      });

      // read the stream
      const out: Buffer[] = [];
      for await (const chunk of tapped) {
        out.push(chunk);
      }

      // assert the stream is the same
      assert.strictEqual(
        Buffer.concat(out).toString(),
        Buffer.concat(chunks).toString(),
        'The tapped stream should emit exactly the original data',
      );

      assert.ok(
        events.find((e) => e.type === 'verification-progress'),
        'Should emit at least one verification-progress',
      );
      assert.ok(
        events.find(
          (e) => e.type === 'verification-succeeded' && e.txId === txId,
        ),
        'Should emit at least one verification-succeeded',
      );
    });

    it('should throw an error on the client stream if verification fails', async () => {
      const chunks = [
        Buffer.from('foo'),
        Buffer.from('bar'),
        Buffer.from('baz'),
      ];
      const contentLength = chunks.reduce((sum, c) => sum + c.length, 0);

      // a stream that will emit chunks
      const originalStream = new ReadableStream({
        start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(chunk);
          }
          controller.close();
        },
      });
      const verifyData = async ({
        txId,
      }: {
        txId: string;
      }): Promise<void> => {
        throw new Error('Verification failed for txId: ' + txId);
      };

      const txId = 'test-tx-1';
      const emitter = new WayfinderEmitter();
      const events: any[] = [];
      emitter.on('verification-progress', (e) =>
        events.push({ type: 'verification-progress', ...e }),
      );
      emitter.on('verification-failed', (e) =>
        events.push({ type: 'verification-failed', ...e }),
      );

      // tap with verification (using strict mode)
      const tapped = tapAndVerifyReadableStream({
        originalStream,
        contentLength,
        verifyData,
        txId,
        emitter,
        strict: true,
      });

      // read the stream and expect verification to fail
      try {
        const out: Buffer[] = [];
        const reader = tapped.getReader();
        while (true) {
          try {
            const { done, value } = await reader.read();
            if (done) break;
            out.push(Buffer.from(value));
          } catch {
            // This is expected - verification should fail
            break;
          }
        }
        // If we get here, verification didn't throw as expected
        assert.fail('Should have thrown an error during verification');
      } catch {
        // Wait a bit for the event to be emitted
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Now we should have the verification-failed event
        assert.ok(events.length > 0, 'Should have emitted events');

        // Check if one of them is verification-failed
        const failedEvent = events.find(
          (e) => e.type === 'verification-failed',
        );
        assert.ok(
          failedEvent,
          'Should emit at least one verification-failed event',
        );
      }
    });
  });
});
