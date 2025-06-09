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

import {
  DataRootProvider,
  DataStream,
  DataVerificationStrategy,
} from '../../types/wayfinder.js';
import { toB64Url } from '../utils/base64.js';
import {
  isAsyncIterable,
  readableStreamToAsyncIterable,
} from '../utils/hash.js';

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

export class DataRootVerificationStrategy implements DataVerificationStrategy {
  private readonly trustedDataRootProvider: DataRootProvider;
  constructor({
    trustedDataRootProvider,
  }: {
    trustedDataRootProvider: DataRootProvider;
  }) {
    this.trustedDataRootProvider = trustedDataRootProvider;
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
      this.trustedDataRootProvider.getDataRoot({
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
