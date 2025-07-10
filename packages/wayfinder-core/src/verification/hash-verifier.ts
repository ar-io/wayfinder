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
import { pLimit } from 'plimit-lit';
import { defaultLogger } from '../logger.js';
import type { DataStream, Logger, VerificationStrategy } from '../types.js';
import { arioGatewayHeaders } from '../utils/ario.js';
import { sandboxFromId } from '../utils/base64.js';
import { hashDataStreamToB64Url } from '../utils/hash.js';

export class HashVerificationStrategy implements VerificationStrategy {
  public readonly trustedGateways: URL[];
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

  async verifyData({
    data,
    txId,
  }: {
    data: DataStream;
    txId: string;
  }): Promise<void> {
    // kick off the hash computation, but don't wait for it until we compute our own hash
    const [computedHash, fetchedHash] = await Promise.all([
      hashDataStreamToB64Url({ stream: data }),
      this.getDigest({ txId }),
    ]);
    // await on the hash promise and compare to get a little concurrency when computing hashes over larger data
    if (computedHash === undefined) {
      throw new Error('Hash could not be computed');
    }
    if (computedHash !== fetchedHash.hash) {
      throw new Error('Hash does not match', {
        cause: { computedHash, trustedHash: fetchedHash },
      });
    }
  }
}
