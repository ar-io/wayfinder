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
 * by first getting metadata from HEAD request, then streaming individual
 * chunks from /chunk/{offset}/data endpoint.
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
    this.logger.debug(
      'Fetching data via ChunkDataRetrievalStrategy from gateway',
      {
        gateway: gateway.toString(),
        requestUrl: requestUrl.toString(),
      },
    );

    const headResponse = await this.fetch(requestUrl.toString(), {
      method: 'HEAD',
      headers,
    });

    if (!headResponse.ok) {
      throw new Error(`HEAD request failed: ${headResponse.status}`);
    }

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

    const relativeRootOffsetHeader = headResponse.headers.get(
      arioHeaderNames.rootDataOffset,
    );

    if (!relativeRootOffsetHeader) {
      this.logger.warn('Missing root data offset header, cannot use chunk API');
      throw new Error(
        'No root data offset header present - cannot use chunk API',
      );
    }

    const relativeRootOffset = parseInt(relativeRootOffsetHeader, 10);

    // get the absolute offset of the root transaction id from the gateway via /offset path
    const offsetForRootTransactionIdUrl = new URL(
      `/tx/${rootTransactionId}/offset`,
      gateway,
    );

    const offsetResponse = await this.fetch(
      offsetForRootTransactionIdUrl.toString(),
      {
        method: 'GET',
        redirect: 'follow',
        headers,
      },
    );

    if (!offsetResponse.ok) {
      throw new Error(
        `Failed to fetch offset for root transaction ID: ${offsetResponse.status}`,
      );
    }

    const {
      offset: offsetForRootTransactionIdString,
      size: rootTransactionSizeString,
    } = (await offsetResponse.json()) as {
      offset: string;
      size: string;
    };

    const rootTransactionEndOffset = parseInt(
      offsetForRootTransactionIdString,
      10,
    );
    const rootTransactionSize = parseInt(rootTransactionSizeString, 10);

    // The /tx/{id}/offset endpoint returns the END offset of the transaction
    // We need to calculate the START offset: endOffset - size + 1
    const absoluteOffsetForRootTransaction =
      rootTransactionEndOffset - rootTransactionSize + 1;
    const absoluteOffsetForDataItem =
      absoluteOffsetForRootTransaction + relativeRootOffset;

    const contentLength = headResponse.headers.get('content-length');

    if (!contentLength) {
      throw new Error('Missing content-length header from HEAD response');
    }

    const totalSize = parseInt(contentLength, 10);

    this.logger.debug('Successfully retrieved necessary offset information', {
      rootTransactionId,
      relativeRootOffset,
      rootTransactionEndOffset,
      rootTransactionSize,
      absoluteOffsetForRootTransaction,
      absoluteOffsetForDataItem,
      totalSize,
    });

    // Store references for use inside the stream
    const logger = this.logger;
    const fetchFn = this.fetch;
    const chunkGateway = gateway;

    // Create a readable stream that fetches chunks on demand
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let currentOffset = absoluteOffsetForDataItem; // Start from where our data item actually is
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
              redirect: 'follow',
              headers,
            });

            if (!chunkResponse.ok) {
              throw new Error(
                `Chunk request failed at offset ${currentOffset}: ${chunkResponse.status} ${chunkResponse.statusText}`,
              );
            }

            // Get chunk metadata headers
            const chunkReadOffsetHeader = chunkResponse.headers.get(
              arioHeaderNames.chunkReadOffset,
            );
            const chunkStartOffsetHeader = chunkResponse.headers.get(
              arioHeaderNames.chunkStartOffset,
            );
            const chunkTxId = chunkResponse.headers.get(
              arioHeaderNames.chunkTxId,
            );

            if (!chunkReadOffsetHeader) {
              throw new Error(
                'Missing chunk read offset header from chunk response',
              );
            }

            // Assert that the chunk belongs to our root transaction
            if (chunkTxId !== rootTransactionId) {
              logger.error('Chunk belongs to wrong transaction', {
                currentOffset,
                expectedTxId: rootTransactionId,
                actualTxId: chunkTxId,
                chunkStartOffset: chunkStartOffsetHeader,
                chunkReadOffset: chunkReadOffsetHeader,
              });
              throw new Error(
                `Chunk transaction ID mismatch at offset ${currentOffset}. Expected: ${rootTransactionId}, Got: ${chunkTxId}`,
              );
            }

            logger.debug('Chunk belongs to correct root transaction', {
              chunkTxId,
              rootTransactionId,
              offset: currentOffset,
            });

            const chunkData = await chunkResponse.arrayBuffer();
            const fullChunkArray = new Uint8Array(chunkData);
            const chunkReadOffset = parseInt(chunkReadOffsetHeader, 10);

            // Extract data starting from chunk read offset
            let dataToEnqueue = fullChunkArray.slice(chunkReadOffset);

            // Limit data to only what we need (don't exceed totalSize)
            const remainingBytes = totalSize - bytesRead;
            if (dataToEnqueue.length > remainingBytes) {
              dataToEnqueue = dataToEnqueue.slice(0, remainingBytes);
            }

            // Enqueue the extracted data
            controller.enqueue(dataToEnqueue);

            // Update counters
            bytesRead += dataToEnqueue.length;

            // Calculate next offset for multi-chunk files
            const chunkStartOffset = parseInt(
              chunkStartOffsetHeader || currentOffset.toString(),
              10,
            );
            currentOffset = chunkStartOffset + fullChunkArray.length;

            // If we've read all the data, close the stream
            if (bytesRead >= totalSize) {
              logger.info('Successfully retrieved all data', {
                totalBytesRead: bytesRead,
                totalSize,
              });
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

    const response = new Response(stream, {
      status: 200,
      headers: {
        // all the original ario headers from the HEAD request
        ...Object.fromEntries(headResponse.headers as any),
        'x-wayfinder-data-retrieval-strategy': 'chunk',
      },
    });

    return response;
  }
}
