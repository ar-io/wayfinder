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
import { pLimit } from 'plimit-lit';
import { DataDigestProvider, DataRootProvider } from '../../types/wayfinder.js';
import { Logger, defaultLogger, sandboxFromId } from '../wayfinder.js';

const arioGatewayHeaders = {
  digest: 'x-ar-io-digest',
  verified: 'x-ar-io-verified',
  txId: 'x-arns-resolved-tx-id',
  processId: 'x-arns-resolved-process-id',
};

export class TrustedGatewaysProvider
  implements DataDigestProvider, DataRootProvider
{
  private trustedGateways: URL[];
  private logger: Logger;
  private maxConcurrency: number;

  constructor({
    trustedGateways,
    maxConcurrency = 1,
    logger = defaultLogger,
    // TODO: add threshold for allowed hash difference (i.e. by count or ratio of total gateways checked)
  }: {
    trustedGateways: URL[];
    logger?: Logger;
    maxConcurrency?: number;
  }) {
    this.trustedGateways = trustedGateways;
    this.logger = logger;
    this.maxConcurrency = maxConcurrency;
  }

  /**
   * Gets the digest for a given txId from all trusted gateways and ensures they all match.
   * @param txId - The txId to get the digest for.
   * @returns The digest for the given txId.
   */
  async getDigest({
    txId,
  }: {
    txId: string;
  }): Promise<{ hash: string; algorithm: 'sha256' }> {
    this.logger.debug('Getting digest for txId', {
      txId,
      maxConcurrency: this.maxConcurrency,
      trustedGateways: this.trustedGateways,
    });

    // TODO: shuffle gateways to avoid bias
    const throttle = pLimit(this.maxConcurrency);
    const hashPromises = this.trustedGateways.map(
      async (gateway: URL): Promise<{ hash: string; gateway: URL }> => {
        return throttle(async () => {
          const sandbox = sandboxFromId(txId);
          const urlWithSandbox = `${gateway.protocol}//${sandbox}.${gateway.hostname}/${txId}`;
          /**
           * This is a problem because we're not able to verify the hash of the data item if the gateway doesn't have the data in its cache. We start with a HEAD request, if it fails, we do a GET request to hydrate the cache and then a HEAD request again to get the cached digest.
           */
          for (const method of ['HEAD', 'GET', 'HEAD']) {
            const response = await fetch(urlWithSandbox, {
              method,
              redirect: 'follow',
              mode: 'cors',
              headers: {
                'Cache-Control': 'no-cache',
              },
            });
            if (!response.ok) {
              // skip if the request failed or the digest is not present
              throw new Error('Failed to fetch digest for txId', {
                cause: {
                  txId,
                  gateway: gateway.toString(),
                },
              });
            }

            const fetchedTxIdHash = response.headers.get(
              arioGatewayHeaders.digest,
            );

            if (fetchedTxIdHash) {
              // avoid hitting other gateways if we've found the hash
              throttle.clearQueue();
              return { hash: fetchedTxIdHash, gateway };
            }
          }

          throw new Error('No hash found for txId', {
            cause: {
              txId,
              gateway: gateway.toString(),
            },
          });
        });
      },
    );

    const { hash, gateway } = await Promise.any(hashPromises);
    this.logger.debug(
      'Successfully fetched digest for txId from trusted gateway',
      {
        txId,
        hash,
        gateway: gateway.toString(),
      },
    );
    return { hash, algorithm: 'sha256' };
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
}
