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
import Arweave from 'arweave';
import {
  Chunk,
  MAX_CHUNK_SIZE,
  MIN_CHUNK_SIZE,
  buildLayers,
  generateLeaves,
} from 'arweave/node/lib/merkle.js';

import { pLimit } from 'plimit-lit';
import { DataStream, VerificationStrategy } from '../../types/wayfinder.js';
import { toB64Url } from '../utils/base64.js';
import {
  isAsyncIterable,
  readableStreamToAsyncIterable,
} from '../utils/hash.js';
import { Logger, defaultLogger } from '../wayfinder.js';

export const convertDataStreamToDataRoot = async ({
  stream,
}: {
  stream: DataStream;
}): Promise<string> => {
  const chunks: Chunk[] = [];
  let leftover = new Uint8Array(0);
  let cursor = 0;

  const asyncIterable = isAsyncIterable(stream)
    ? stream
    : readableStreamToAsyncIterable(stream);

  for await (const data of asyncIterable) {
    const inputChunk = new Uint8Array(
      data.buffer,
      data.byteOffset,
      data.byteLength,
    );
    const combined = new Uint8Array(leftover.length + inputChunk.length);
    combined.set(leftover, 0);
    combined.set(inputChunk, leftover.length);

    let startIndex = 0;
    while (combined.length - startIndex >= MAX_CHUNK_SIZE) {
      let chunkSize = MAX_CHUNK_SIZE;
      const remainderAfterThis = combined.length - startIndex - MAX_CHUNK_SIZE;
      if (remainderAfterThis > 0 && remainderAfterThis < MIN_CHUNK_SIZE) {
        chunkSize = Math.ceil((combined.length - startIndex) / 2);
      }

      const chunkData = combined.slice(startIndex, startIndex + chunkSize);
      const dataHash = await Arweave.crypto.hash(chunkData);

      chunks.push({
        dataHash,
        minByteRange: cursor,
        maxByteRange: cursor + chunkSize,
      });

      cursor += chunkSize;
      startIndex += chunkSize;
    }

    leftover = combined.slice(startIndex);
  }

  if (leftover.length > 0) {
    // TODO: ensure a web friendly crypto hash function is used in web
    const dataHash = await Arweave.crypto.hash(leftover);
    chunks.push({
      dataHash,
      minByteRange: cursor,
      maxByteRange: cursor + leftover.length,
    });
  }

  const leaves = await generateLeaves(chunks);
  const root = await buildLayers(leaves);
  return toB64Url(new Uint8Array(root.id));
};

export class DataRootVerificationStrategy implements VerificationStrategy {
  private readonly trustedGateways: URL[];
  private readonly maxConcurrency: number;
  private readonly logger: Logger;
  constructor({
    trustedGateways,
    maxConcurrency = 1,
    logger = defaultLogger,
  }: {
    trustedGateways: URL[];
    maxConcurrency?: number;
    logger?: Logger;
  }) {
    this.trustedGateways = trustedGateways;
    this.maxConcurrency = maxConcurrency;
    this.logger = logger;
  }

  /**
   * Get the data root for a given txId from all trusted gateways and ensure they all match.
   * @param txId - The txId to get the data root for.
   * @returns The data root for the given txId.
   */
  async getDataRoot({ txId }: { txId: string }): Promise<string> {
    this.logger.debug('Getting data root for txId', {
      txId,
      maxConcurrency: this.maxConcurrency,
      trustedGateways: this.trustedGateways,
    });

    // TODO: shuffle gateways to avoid bias
    const throttle = pLimit(this.maxConcurrency);
    const dataRootPromises = this.trustedGateways.map(
      async (gateway): Promise<{ dataRoot: string; gateway: URL }> => {
        return throttle(async () => {
          const response = await fetch(
            `${gateway.toString()}tx/${txId}/data_root`,
          );
          if (!response.ok) {
            // skip this gateway
            throw new Error('Failed to fetch data root for txId', {
              cause: {
                txId,
                gateway: gateway.toString(),
              },
            });
          }
          const dataRoot = await response.text();
          return { dataRoot, gateway };
        });
      },
    );

    const { dataRoot, gateway } = await Promise.any(dataRootPromises);
    this.logger.debug('Successfully fetched data root for txId', {
      txId,
      dataRoot,
      gateway: gateway.toString(),
    });
    return dataRoot;
  }

  async verifyData({
    data,
    txId,
  }: {
    data: DataStream;
    txId: string;
  }): Promise<void> {
    const [computedDataRoot, trustedDataRoot] = await Promise.all([
      convertDataStreamToDataRoot({
        stream: data,
      }),
      this.getDataRoot({
        txId,
      }),
    ]);
    if (computedDataRoot !== trustedDataRoot) {
      throw new Error('Data root does not match', {
        cause: { computedDataRoot, trustedDataRoot },
      });
    }
  }
}
