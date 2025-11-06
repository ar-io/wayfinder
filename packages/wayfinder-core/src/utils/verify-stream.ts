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

import { WayfinderEmitter } from '../index.js';
import { VerificationStrategy } from '../types.js';

/**
 * Utility to tap a ReadableStream for verification while passing through data to the client.
 *
 * @param originalStream The original ReadableStream from the fetch response.
 * @param contentLength The total content length of the stream, used for progress reporting.
 * @param verifyData The verification function to process the tapped stream.
 * @param txId The transaction ID associated with the data.
 * @param emitter Optional WayfinderEmitter to emit verification events.
 * @param headers Optional headers to pass to the verification function.
 * @param strict If true, the client stream will error if verification fails; otherwise, verification runs asynchronously.
 * @returns A ReadableStream that passes through data to the client while verifying in parallel.
 */
export const tapAndVerifyReadableStream = ({
  originalStream,
  contentLength,
  verifyData,
  txId,
  emitter,
  headers = {},
  strict = false,
}: {
  originalStream: ReadableStream;
  contentLength: number;
  headers?: Record<string, string>;
  verifyData: VerificationStrategy['verifyData'];
  txId: string;
  emitter?: WayfinderEmitter;
  strict?: boolean;
}): ReadableStream => {
  if (
    originalStream instanceof ReadableStream &&
    typeof originalStream.tee === 'function'
  ) {
    /**
     * NOTE: tee requires the streams both streams to be consumed, so we need to make sure we consume the client branch
     * by the caller. This means when `request` is called, the client stream must be consumed by the caller via await request.text()
     * for verification to complete.
     *
     * It is feasible to make the verification stream not to depend on the client branch being consumed, should the DX not be obvious.
     */
    const [verifyBranch, clientBranch] = originalStream.tee();

    // setup our promise to verify the data
    const verificationPromise = verifyData({
      data: verifyBranch,
      txId,
      headers,
    });

    let bytesProcessed = 0;
    const reader = clientBranch.getReader();
    const clientStreamWithVerification = new ReadableStream({
      async pull(controller) {
        const { done, value } = await reader.read();
        if (done) {
          if (strict) {
            // in strict mode, we wait for verification to complete before closing the controller
            try {
              await verificationPromise;
              emitter?.emit('verification-succeeded', { txId });
              controller.close();
            } catch (err) {
              // emit the verification failed event
              emitter?.emit('verification-failed', err);

              // In strict mode, we report the error to the client stream
              controller.error(
                new Error('Verification failed', { cause: err }),
              );
            }
          } else {
            // in non-strict mode, we close the controller immediately and handle verification asynchronously
            controller.close();
            // trigger the verification promise and emit events for the result
            verificationPromise
              .then(() => {
                emitter?.emit('verification-succeeded', { txId });
              })
              .catch((error: unknown) => {
                emitter?.emit('verification-failed', error);
              });
          }
        } else {
          bytesProcessed += value.length;
          emitter?.emit('verification-progress', {
            txId,
            totalBytes: contentLength,
            processedBytes: bytesProcessed,
          });
          controller.enqueue(value);
        }
      },
      cancel(reason) {
        // cancel the reader regardless of verification status
        reader.cancel(reason);

        // emit the verification cancellation event
        emitter?.emit('verification-failed', {
          txId,
          error: new Error('Verification cancelled', {
            cause: {
              reason,
            },
          }),
        });
      },
    });
    return clientStreamWithVerification;
  }
  throw new Error('Unsupported body type for cloning');
};
