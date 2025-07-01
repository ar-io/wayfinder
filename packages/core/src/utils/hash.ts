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
import { createHash } from 'crypto';
import { defaultLogger } from '../logger.js';
import type { DataStream, Logger } from '../types.js';
import { toB64Url } from './base64.js';

export function isAsyncIterable(
  obj: unknown,
): obj is AsyncIterable<Uint8Array> {
  return (
    obj !== null &&
    typeof obj === 'object' &&
    Symbol.asyncIterator in obj &&
    typeof (obj as AsyncIterable<Uint8Array>)[Symbol.asyncIterator] ===
      'function'
  );
}

export async function* readableStreamToAsyncIterable(
  stream: ReadableStream<Uint8Array>,
): AsyncIterable<Uint8Array> {
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        return;
      }
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

export async function hashDataStreamToB64Url({
  stream,
  algorithm = 'sha256',
  logger = defaultLogger,
}: {
  stream: DataStream;
  algorithm?: string;
  logger?: Logger;
}): Promise<string | undefined> {
  try {
    logger.debug('Starting to hash data stream', {
      algorithm,
      streamType: isAsyncIterable(stream) ? 'AsyncIterable' : 'ReadableStream',
    });

    const asyncIterable = isAsyncIterable(stream)
      ? stream
      : readableStreamToAsyncIterable(stream);

    const hash = createHash(algorithm);
    let bytesProcessed = 0;

    for await (const chunk of asyncIterable) {
      hash.update(chunk);
      bytesProcessed += chunk.length;

      // Log progress occasionally (every ~1MB)
      if (bytesProcessed % (1024 * 1024) < chunk.length) {
        logger.debug('Hashing progress', {
          bytesProcessed,
          algorithm,
        });
      }
    }

    const hashResult = toB64Url(new Uint8Array(hash.digest()));
    logger.debug('Finished hashing data stream', {
      bytesProcessed,
      algorithm,
      hashResult,
    });

    return hashResult;
  } catch (error: any) {
    logger.error('Error hashing data stream', {
      error: error.message,
      stack: error.stack,
      algorithm,
    });
    return undefined;
  }
}
