/**
 * WayFinder
 * Copyright (C) 2022-2025 Permanent Data Solutions, Inc. All Rights Reserved.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */
import { createHash } from 'crypto';
import { DataStream } from '../../types/wayfinder.js';
import { Logger, defaultLogger } from '../wayfinder.js';
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
  algorithm = 'SHA-256',
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
