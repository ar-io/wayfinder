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
import Arweave from 'arweave';
import {
  Chunk,
  MAX_CHUNK_SIZE,
  MIN_CHUNK_SIZE,
  buildLayers,
  generateLeaves,
} from 'arweave/node/lib/merkle.js';

import { pLimit } from 'plimit-lit';
import {
  DataClassifier,
  DataStream,
  Logger,
  VerificationStrategy,
} from '../../types/wayfinder.js';
import { GqlClassifier } from '../classifiers/gql-classifier.js';
import { defaultLogger } from '../logger.js';
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

// TODO: this is a TransactionDataRootVerificationStrategy, we will hold of on implementing Ans104DataRootVerificationStrategy for now
export class DataRootVerificationStrategy implements VerificationStrategy {
  private readonly trustedGateways: URL[];
  private readonly maxConcurrency: number;
  private readonly logger: Logger;
  private readonly classifier: DataClassifier;
  constructor({
    trustedGateways,
    maxConcurrency = 1,
    logger = defaultLogger,
    classifier = new GqlClassifier({ logger }),
  }: {
    trustedGateways: URL[];
    maxConcurrency?: number;
    logger?: Logger;
    classifier?: DataClassifier;
  }) {
    this.trustedGateways = trustedGateways;
    this.maxConcurrency = maxConcurrency;
    this.logger = logger;
    this.classifier = classifier;
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
    // classify the data, if ans104 throw an error
    const dataType = await this.classifier.classify({ txId });
    if (dataType === 'ans104') {
      throw new Error(
        'ANS-104 data is not supported for data root verification',
        {
          cause: { txId },
        },
      );
    }

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
