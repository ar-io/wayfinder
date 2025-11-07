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

import { arioHeaderNames } from '../constants.js';
import { defaultLogger } from '../logger.js';
import type { DataRetrievalStrategy, Logger } from '../types.js';

/**
 * Chunk data retrieval strategy that fetches transaction data in chunks
 * by first getting metadata from HEAD request, then streaming individual chunks
 */
export class ChunkDataRetrievalStrategy implements DataRetrievalStrategy {
  private logger: Logger;
  private fetch: typeof globalThis.fetch;

  constructor({
    logger = defaultLogger,
    fetch = globalThis.fetch,
  }: {
    logger?: Logger;
    fetch?: typeof globalThis.fetch;
  } = {}) {
    this.logger = logger;
    this.fetch = fetch;
  }

  async getData({
    gateway,
    requestUrl,
    headers,
  }: {
    gateway: URL;
    requestUrl: URL;
    headers?: Record<string, string>;
  }): Promise<Response> {
    this.logger.debug('Fetching chunked transaction data', {
      gateway: gateway.toString(),
      requestUrl: requestUrl.toString(),
    });

    // Make HEAD request to get metadata
    this.logger.debug('Making HEAD request to:', {
      url: requestUrl.toString(),
    });
    const headResponse = await this.fetch(requestUrl.toString(), {
      method: 'HEAD',
      headers,
    });

    if (!headResponse.ok) {
      throw new Error(`HEAD request failed: ${headResponse.status}`);
    }

    // Parse headers - check multiple possible header sources
    const rootTransactionId = headResponse.headers.get(
      arioHeaderNames.rootTransactionId,
    );

    if (!rootTransactionId) {
      this.logger.warn(
        'Missing root transaction ID header, cannot use chunk API',
      );
      throw new Error(
        'No root transaction ID header present - cannot use chunk API',
      );
    }

    const offsetHeader = headResponse.headers.get(
      arioHeaderNames.rootDataOffset,
    );

    if (!offsetHeader) {
      this.logger.warn('Missing root data offset header, cannot use chunk API');
      throw new Error(
        'No root data offset header present - cannot use chunk API',
      );
    }

    const contentLength = headResponse.headers.get('content-length');

    if (!contentLength) {
      throw new Error('Missing content-length header from HEAD response');
    }

    const offset = parseInt(offsetHeader, 10);
    const totalSize = parseInt(contentLength, 10);

    this.logger.debug('Chunk retrieval headers', {
      rootTransactionId,
      offset,
      totalSize,
    });

    // Store references for use inside the stream
    const logger = this.logger;
    const fetchFn = this.fetch;
    const chunkGateway = gateway;

    // Create a readable stream that fetches chunks on demand
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let currentOffset = offset; // Start from the absolute offset
        let bytesRead = 0;

        while (bytesRead < totalSize) {
          try {
            const chunkUrl = new URL(
              `/chunk/${currentOffset}/data`,
              chunkGateway,
            );

            logger.debug('Fetching chunk', {
              url: chunkUrl.toString(),
              currentOffset,
              bytesRead,
              totalSize,
            });

            const chunkResponse = await fetchFn(chunkUrl.toString(), {
              method: 'GET',
              headers: {
                ...headers,
                accept: 'application/octet-stream',
              },
            });

            if (!chunkResponse.ok) {
              throw new Error(
                `Chunk request failed at offset ${currentOffset}: ${chunkResponse.status} ${chunkResponse.statusText}`,
              );
            }

            // Get the chunk read offset header
            const chunkReadOffsetHeader = chunkResponse.headers.get(
              arioHeaderNames.chunkReadOffset,
            );

            // Get the chunk data
            const chunkData = await chunkResponse.arrayBuffer();
            const fullChunkArray = new Uint8Array(chunkData);

            // Extract data starting from chunk read offset if provided
            let dataToEnqueue = fullChunkArray;

            if (chunkReadOffsetHeader) {
              const chunkReadOffset = parseInt(chunkReadOffsetHeader, 10);
              dataToEnqueue = fullChunkArray.slice(chunkReadOffset);
            }

            // Limit data to only what we need (don't exceed totalSize)
            const remainingBytes = totalSize - bytesRead;
            if (dataToEnqueue.length > remainingBytes) {
              dataToEnqueue = dataToEnqueue.slice(0, remainingBytes);
            }

            // Enqueue the extracted data
            controller.enqueue(dataToEnqueue);

            // Update counters
            bytesRead += dataToEnqueue.length;

            // Calculate next chunk offset by adding the full chunk size to current chunk start offset
            // This is the key insight from the principal engineer's directive
            currentOffset += fullChunkArray.length;

            // If we've read all the data, close the stream
            if (bytesRead >= totalSize) {
              controller.close();
              break;
            }
          } catch (error) {
            controller.error(error);
            break;
          }
        }
      },
    });

    // Create a Response with the streaming body
    const response = new Response(stream, {
      status: 200,
      headers: {
        'content-type':
          headResponse.headers.get('content-type') ||
          'application/octet-stream',
        'content-length': contentLength,
        [arioHeaderNames.rootTransactionId]: rootTransactionId,
        [arioHeaderNames.rootDataOffset]: offsetHeader,
      },
    });

    return response;
  }
}
