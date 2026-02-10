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
import {
  Arweave,
  DataItem,
  deepHash,
  indexToType,
  stringToBuffer,
} from '@dha-team/arbundles';

import { pLimit } from 'plimit-lit';
import { defaultLogger } from '../logger.js';
import { GqlRootTransactionSource } from '../root-transaction/gql.js';
import type {
  DataClassifier,
  DataStream,
  Logger,
  RootTransactionSource,
  VerificationStrategy,
} from '../types.js';
import { arioGatewayHeaders } from '../utils/ario.js';
import { fromB64Url } from '../utils/base64.js';
import {
  isAsyncIterable,
  readableStreamToAsyncIterable,
} from '../utils/hash.js';
import {
  constructGatewayUrl,
  constructVerificationUrl,
} from '../utils/verification-url.js';
import { convertDataStreamToDataRoot } from './data-root-verification.js';

/**
 * Implementation of DataVerificationStrategy that verifies data item signatures
 * using trusted gateways to provide the metadata needed for verification.
 */
export class Ans104SignatureVerificationStrategy
  implements VerificationStrategy
{
  public readonly trustedGateways: URL[];
  private readonly maxConcurrency: number;
  private readonly logger: Logger;
  constructor({
    trustedGateways,
    maxConcurrency = 1,
    logger = defaultLogger,
  }: { trustedGateways: URL[]; maxConcurrency?: number; logger?: Logger }) {
    this.trustedGateways = trustedGateways;
    this.maxConcurrency = maxConcurrency;
    this.logger = logger;
  }

  /**
   * Gets data item information from trusted gateways
   *
   * @param txId - The transaction ID to get information for
   * @returns Object containing offsets and root transaction ID
   */
  private async getDataItemAttributes(txId: string): Promise<{
    dataItemOffset: number;
    dataItemDataOffset: number;
    rootTransactionId: string;
    dataItemSize: number;
  }> {
    // Try each gateway until we get the information we need
    const throttle = pLimit(this.maxConcurrency);
    const dataItemAttributesPromises = this.trustedGateways.map(
      async (
        gateway,
      ): Promise<{
        dataItemOffset: number;
        dataItemDataOffset: number;
        rootTransactionId: string;
        dataItemSize: number;
        gateway: URL;
      }> => {
        return throttle(async () => {
          const url = constructVerificationUrl({ gateway, txId });

          // Make a HEAD request to get headers without fetching the full data
          const response = await fetch(url, {
            method: 'HEAD',
            redirect: 'follow',
            mode: 'cors',
            headers: {
              'Cache-Control': 'no-cache',
            },
          });

          if (!response.ok) {
            throw new Error(
              'Failed to fetch data item info from trusted gateway',
              {
                cause: {
                  txId,
                  gateway: gateway.toString(),
                },
              },
            );
          }

          const dataItemOffset = response.headers.get(
            arioGatewayHeaders.dataItemOffset,
          );
          const dataItemDataOffset = response.headers.get(
            arioGatewayHeaders.dataItemDataOffset,
          );
          const rootTransactionId = response.headers.get(
            arioGatewayHeaders.rootTransactionId,
          );
          const dataItemSize = response.headers.get(
            arioGatewayHeaders.dataItemSize,
          );

          // if any are undefined, throw an error
          if (
            dataItemOffset &&
            dataItemDataOffset &&
            rootTransactionId &&
            dataItemSize
          ) {
            throttle.clearQueue();
            return {
              gateway,
              dataItemOffset: parseInt(dataItemOffset, 10),
              dataItemDataOffset: parseInt(dataItemDataOffset, 10),
              rootTransactionId,
              dataItemSize: parseInt(dataItemSize, 10),
            };
          }

          // if we get here, we didn't get the information we need from this gateway
          throw new Error('Missing data item attributes from trusted gateway', {
            cause: {
              txId,
              gateway: gateway.toString(),
              dataItemOffset,
              dataItemDataOffset,
              rootTransactionId,
              dataItemSize,
            },
          });
        });
      },
    );

    const {
      gateway,
      dataItemOffset,
      dataItemDataOffset,
      rootTransactionId,
      dataItemSize,
    } = await Promise.any(dataItemAttributesPromises);
    this.logger.debug('Successfully fetched data item attributes for txId', {
      txId,
      dataItemOffset,
      dataItemDataOffset,
      rootTransactionId,
      dataItemSize,
      gateway: gateway.toString(),
    });
    return {
      dataItemOffset,
      dataItemDataOffset,
      rootTransactionId,
      dataItemSize,
    };
  }

  /**
   * Fetches just the bytes header data of a data item from a trusted gateway needed for signature verification.
   *
   * @param txId - The transaction ID to get signature data for
   * @returns The bytes containing the data item up to the data section
   */
  async getSignatureData({
    txId,
  }: {
    txId: string;
  }): Promise<{
    signatureType: number;
    signature: Uint8Array;
    owner: Uint8Array;
    target: Uint8Array;
    anchor: Uint8Array;
    tags: Uint8Array;
  }> {
    const { rootTransactionId, dataItemOffset, dataItemDataOffset } =
      await this.getDataItemAttributes(txId);

    // this byte range is the header data of the data item within it's parent transaction, containing all the header data needed for signature verification
    const rangeStart = dataItemOffset;
    const rangeEnd = dataItemDataOffset - 1;

    // TODO: we are fetching data here via range request - we may not want to do this concurrently and instead shuffle gateways before iterating through each
    for (const gateway of this.trustedGateways) {
      try {
        const url = constructVerificationUrl({
          gateway,
          txId: rootTransactionId,
        });
        const response = await fetch(url, {
          method: 'GET',
          redirect: 'follow',
          mode: 'cors',
          headers: {
            Range: `bytes=${rangeStart}-${rangeEnd}`,
            'Cache-Control': 'no-cache',
          },
        });

        if (!response.ok || response.body === null) {
          continue;
        }

        // create the data item object from just the headers, so we can get the components easily
        // this is somewhat of a hack as we are not including the data when creating the DataItem object
        const trustedDataItemHeaderBytes = Buffer.from(
          await response.arrayBuffer(),
        );
        const dataItem = new DataItem(trustedDataItemHeaderBytes);

        // first verify the data item id matches the txId before we do any other verification
        const dataItemId = await dataItem.id;
        if (dataItemId !== txId) {
          throw new Error('Data item ID does not match txId', {
            cause: { dataItemId, txId },
          });
        }

        // now get the components needed for verification from the DataItem
        const signatureType = dataItem.signatureType;
        const signature = dataItem.rawSignature;
        const owner = dataItem.rawOwner;
        const target = dataItem.rawTarget;
        const anchor = dataItem.rawAnchor;
        const tags = dataItem.rawTags;

        return {
          signatureType,
          signature,
          owner,
          target,
          anchor,
          tags,
        };
      } catch (error: any) {
        this.logger.debug('Failed to fetch data item signature bytes', {
          error: error.message,
          stack: error.stack,
          txId,
        });
      }
    }

    throw new Error('Failed to fetch data item signature bytes', {
      cause: { txId, rootTransactionId, dataItemOffset, dataItemDataOffset },
    });
  }

  /**
   * Verifies the signature of a data item using trusted gateways to get the signature data
   * and then verifying it against the data payload.
   *
   * This implementation follows the ANS-104 standard for verifying data item signatures:
   * 1. Get the signature data from the trusted gateway
   * 2. Parse the signature components (owner, signature type, tags, etc.)
   * 3. Calculate the deep hash of all components and the data
   * 4. Verify the signature against the deep hash
   *
   * @param data - The data stream to verify
   * @param txId - The transaction ID of the data
   * @param headers - Optional response headers (not used in signature verification)
   * @param raw - Optional flag for raw verification (not applicable for signature verification)
   */
  async verifyData({
    data,
    txId,
    headers: _headers = {},
    raw: _raw = false,
  }: {
    data: DataStream;
    txId: string;
    headers?: Record<string, string>;
    raw?: boolean;
  }): Promise<void> {
    // fetch signature data from trusted gateway
    const trustedSignatureData = await this.getSignatureData({ txId });

    if (!DataItem.isDataItem(trustedSignatureData)) {
      throw new Error('TxId is not a data item', {
        cause: { txId },
      });
    }

    // ensure data is in the right format for verification
    const asyncIterable = isAsyncIterable(data)
      ? data
      : readableStreamToAsyncIterable(data);

    const { signatureType, signature, owner, target, anchor, tags } =
      trustedSignatureData;

    // calculate the deep hash of all components including the data stream
    // this follows the arbundles DataItem.verify() approach but prevents loading the entire data stream into memory
    const signatureData = await deepHash([
      stringToBuffer('dataitem'),
      stringToBuffer('1'),
      stringToBuffer(`${signatureType}`),
      new Uint8Array(owner),
      new Uint8Array(target),
      new Uint8Array(anchor),
      new Uint8Array(tags),
      asyncIterable as unknown as AsyncIterable<Buffer>,
    ]);

    const signer = indexToType[signatureType];
    const isValid = await signer.verify(
      new Uint8Array(owner),
      signatureData,
      new Uint8Array(signature),
    );

    if (!isValid) {
      throw new Error('Data item signature verification failed', {
        cause: { txId },
      });
    }
  }
}

/**
 * Implementation of SignatureDataProvider that fetches signature data directly
 * from a trusted gateway's /tx/<tx-id>/signature endpoint.
 */
export class TransactionSignatureVerificationStrategy
  implements VerificationStrategy
{
  public readonly trustedGateways: URL[];
  private readonly logger: Logger;

  constructor({
    trustedGateways,
    logger = defaultLogger,
  }: {
    trustedGateways: URL[];
    maxConcurrency?: number;
    logger?: Logger;
  }) {
    this.trustedGateways = trustedGateways;
    this.logger = logger;
  }

  /**
   * Fetches signature data directly from a trusted gateway's /tx/<tx-id>/signature endpoint.
   *
   * @param txId - The transaction ID to get signature data for
   * @returns The signature data as a Uint8Array
   */
  async getSignatureData({
    txId,
  }: {
    txId: string;
  }): Promise<{
    format: number;
    owner: string;
    target: string;
    anchor: string;
    quantity: string;
    reward: string;
    dataRoot: string;
    dataSize: number;
    lastTx: string;
    tags: { name: string; value: string }[];
    signature: string;
  }> {
    this.logger.debug('Getting signature data for txId', {
      txId,
      trustedGateways: this.trustedGateways,
    });

    // TODO: shuffle gateways before iterating through each and potentially allow for concurrent requests
    for (const gateway of this.trustedGateways) {
      try {
        const url = constructGatewayUrl({ gateway, path: `/tx/${txId}` });
        const response = await fetch(url, {
          method: 'GET',
          redirect: 'follow',
          mode: 'cors',
          headers: {
            'Cache-Control': 'no-cache',
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          throw new Error(
            'Failed to fetch signature data from trusted gateway',
            {
              cause: { txId, gateway: gateway.toString() },
            },
          );
        }

        const tx = await response.json();

        return {
          format: tx.format,
          owner: tx.owner,
          target: tx.target,
          anchor: tx.anchor,
          quantity: tx.quantity,
          reward: tx.reward,
          dataRoot: tx.data_root,
          dataSize: tx.data_size,
          lastTx: tx.last_tx,
          tags: tx.tags,
          signature: tx.signature,
        };
      } catch (error: any) {
        this.logger.debug('Error fetching signature data', {
          error: error.message,
          stack: error.stack,
          txId,
          gateway: gateway.toString(),
        });
      }
    }

    throw new Error('Failed to fetch signature data from any trusted gateway', {
      cause: { txId },
    });
  }

  async verifyData({
    data,
    txId,
    headers: _headers = {},
    raw: _raw = false,
  }: {
    data: DataStream;
    txId: string;
    headers?: Record<string, string>;
    raw?: boolean;
  }): Promise<void> {
    // Note: The raw parameter is not applicable for transaction signature verification
    // as this strategy verifies the cryptographic signature of the transaction itself.
    // The parameter is accepted for interface compatibility but ignored.

    const {
      format,
      owner,
      target,
      quantity,
      reward,
      dataSize,
      lastTx,
      tags,
      signature,
    } = await this.getSignatureData({ txId });

    const tagList: [Uint8Array, Uint8Array][] = tags.map(
      (tag: { name: string; value: string }) => [
        fromB64Url(tag.name),
        fromB64Url(tag.value),
      ],
    );

    // use the provided data stream to compute the data root for the signature data
    const computedDataRoot = await convertDataStreamToDataRoot({
      stream: data,
    });

    // compute the signature data using the computed data root and retrieved signature data
    const signatureData = await deepHash([
      stringToBuffer(format.toString()),
      fromB64Url(owner),
      fromB64Url(target),
      stringToBuffer(quantity),
      stringToBuffer(reward),
      fromB64Url(lastTx),
      tagList,
      stringToBuffer(dataSize.toString()),
      fromB64Url(computedDataRoot),
    ]);

    // verify the signature using the computed signature data and the computed signature data
    const isValid = await Arweave.crypto.verify(
      owner,
      signatureData,
      fromB64Url(signature),
    );
    if (!isValid) {
      throw new Error('Transaction signature verification failed', {
        cause: { txId },
      });
    }
  }
}

export const SignatureVerificationStrategies = {
  ans104: Ans104SignatureVerificationStrategy,
  transaction: TransactionSignatureVerificationStrategy,
  // TODO: ans102
};

export class SignatureVerificationStrategy {
  private readonly ans104: Ans104SignatureVerificationStrategy;
  private readonly transaction: TransactionSignatureVerificationStrategy;
  private readonly rootTransactionSource: RootTransactionSource;
  public readonly trustedGateways: URL[];
  constructor({
    trustedGateways,
    maxConcurrency = 1,
    logger = defaultLogger,
    rootTransactionSource = new GqlRootTransactionSource({ logger }),
  }: {
    trustedGateways: URL[];
    maxConcurrency?: number;
    logger?: Logger;
    rootTransactionSource?: RootTransactionSource;
    /** @deprecated Use rootTransactionSource instead */
    classifier?: DataClassifier;
  }) {
    this.trustedGateways = trustedGateways;
    this.ans104 = new Ans104SignatureVerificationStrategy({
      trustedGateways,
      maxConcurrency,
      logger,
    });
    this.transaction = new TransactionSignatureVerificationStrategy({
      trustedGateways,
      logger,
    });
    this.rootTransactionSource = rootTransactionSource;
  }

  async verifyData({
    data,
    txId,
    headers = {},
    raw = false,
  }: {
    data: DataStream;
    txId: string;
    headers?: Record<string, string>;
    raw?: boolean;
  }): Promise<void> {
    const rootTxInfo = await this.rootTransactionSource.getRootTransaction({
      txId,
    });
    if (rootTxInfo.isDataItem) {
      return this.ans104.verifyData({ data, txId, headers, raw });
    }
    return this.transaction.verifyData({ data, txId, headers, raw });
  }
}
