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
import {
  Arweave,
  DataItem,
  deepHash,
  indexToType,
  stringToBuffer,
} from '@dha-team/arbundles';

import {
  DataStream,
  VerificationStrategy,
} from '../../types/wayfinder.js';
import { Logger, defaultLogger } from '../wayfinder.js';
import {
  isAsyncIterable,
  readableStreamToAsyncIterable,
} from '../utils/hash.js';
import { pLimit } from 'plimit-lit';
import { arioGatewayHeaders } from '../utils/ario.js';
import { bufferTob64Url } from 'arweave/node/lib/utils.js';
import { toB64Url } from '../utils/base64.js';

/**
 * Implementation of DataVerificationStrategy that verifies data item signatures
 * using trusted gateways to provide the metadata needed for verification.
 */
export class Ans104SignatureVerificationStrategy
  implements VerificationStrategy
{
  private readonly trustedGateways: URL[];
  private readonly maxConcurrency: number;
  private readonly logger: Logger;
  constructor({ trustedGateways, maxConcurrency = 1, logger = defaultLogger }: { trustedGateways: URL[], maxConcurrency?: number, logger?: Logger }) {
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
          // TODO: add sandbox support to the URL - useful to test against localhost with it disabled
          // const sandbox = sandboxFromId(txId);
          const url = `${gateway.protocol}//${gateway.hostname}:${gateway.port}/${txId}`;

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
   * Fetches just the bytes needed for signature verification from the root transaction
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
    // TODO: classify if the tx id is an L1 transaction of ANS-104 data item
    // For ANS-104 data items, we get the data item attributes directly from trusted gateways
    // For L1 transactions, we can go to the network to get signature data of the transaction
    const { rootTransactionId, dataItemOffset, dataItemDataOffset } =
      await this.getDataItemAttributes(txId);

    // Calculate the byte range for the request
    const rangeStart = dataItemOffset;
    const rangeEnd = dataItemDataOffset - 1;

    // TODO: we are fetching data here via range request - we may not want to do this concurrently and instead shuffle gateways before iterating through each
    for (const gateway of this.trustedGateways) {
      try {
        const url = `${gateway.toString()}${rootTransactionId}`;
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

        
        // create the data item object from just the signature bytes, so we can get the components easily
        const trustedDataItemHeaderBytes = Buffer.from(await response.arrayBuffer());
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
        // Continue to the next gateway if there's an error
        continue;
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
   */
  async verifyData({
    data,
    txId,
  }: {
    data: DataStream;
    txId: string;
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

    const { signatureType, signature, owner, target, anchor, tags } = trustedSignatureData;

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
  private readonly trustedGateways: URL[];
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
    owner: Uint8Array;
    target: Uint8Array;
    anchor: Uint8Array;
    quantity: Uint8Array;
    reward: Uint8Array;
    data_root: Uint8Array;
    last_tx: Uint8Array;
    tags: Uint8Array;
    signature: Uint8Array;
  }> {
    this.logger.debug('Getting signature data for txId', {
      txId,
      trustedGateways: this.trustedGateways,
    });

    // Try each gateway sequentially until we get the signature data
    for (const gateway of this.trustedGateways) {
      try {
        const arweave = new Arweave({
          host: gateway.hostname,
          port: gateway.port,
          protocol: gateway.protocol.replace(':', ''),
        });

        const tx = await arweave.transactions.get(txId);
        return {
          format: tx.format,
          owner: tx.rawOwner,
          target: tx.rawTarget,
          anchor: tx.rawAnchor,
          quantity: tx.rawQuantity,
          reward: tx.rawReward,
          data_root: tx.rawDataRoot,
          last_tx: tx.rawLastTx,
          tags: tx.rawTags,
          signature: tx.rawSignature,
        };
      } catch (error: any) {
        this.logger.debug('Error fetching signature data', {
          error: error.message,
          stack: error.stack,
          txId,
          gateway: gateway.toString(),
        });
        // Continue to the next gateway if there's an error
        continue;
      }
    }

    throw new Error('Failed to fetch signature data from any trusted gateway', {
      cause: { txId },
    });
  }

  async verifyData({ data, txId }: { data: DataStream; txId: string }): Promise<void> {

    const { format, owner, target, anchor, quantity, reward, data_root, last_tx, tags, signature } = await this.getSignatureData({ txId });

    const asyncIterable = isAsyncIterable(data)
      ? data
      : readableStreamToAsyncIterable(data);

    const signatureData = await deepHash([
      stringToBuffer(`${format}`),
      stringToBuffer(`${quantity}`),
      stringToBuffer(`${reward}`),
      stringToBuffer(`${data_root}`),
      stringToBuffer(`${last_tx}`),
      new Uint8Array(owner),
      new Uint8Array(target),
      new Uint8Array(anchor),
      new Uint8Array(tags),
      asyncIterable as unknown as AsyncIterable<Buffer>,
    ]);

    const computedId = bufferTob64Url(signatureData);

    if (txId !== computedId) {
      throw new Error('Transaction ID does not match the computed ID', {
        cause: { txId, computedId },
      });
    }

    // TODO; use crypto.verify to verify the signature
    const isValid = await Arweave.crypto.verify(toB64Url(owner), signatureData, signature);
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
  constructor({ trustedGateways, maxConcurrency = 1, logger = defaultLogger }: { trustedGateways: URL[], maxConcurrency?: number, logger?: Logger }) {
    this.ans104 = new Ans104SignatureVerificationStrategy({ trustedGateways, maxConcurrency, logger });
    this.transaction = new TransactionSignatureVerificationStrategy({ trustedGateways, logger });
  }

  async classify({ txId }: { txId: string }): Promise<'ans104' | 'transaction'> {
    console.log('classifying', txId);
    // TODO: implement classification logic
    return 'transaction';
  }

  async verifyData({ data, txId }: { data: DataStream; txId: string }): Promise<void> {
    const strategy = await this.classify({ txId });
    switch (strategy) {
      case 'ans104':
        return this.ans104.verifyData({ data, txId });
      case 'transaction':
        return this.transaction.verifyData({ data, txId });
      default:
        throw new Error('Unknown strategy', {
          cause: { strategy },
        });
    }
  }
}
