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
import { DataDigestProvider, DataRootProvider } from '../../types/wayfinder.js';
import { sandboxFromId } from '../wayfinder.js';

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

  constructor({
    trustedGateways,
    // TODO: add threshold for allowed hash difference (i.e. by count or ratio of total gateways checked)
  }: {
    trustedGateways: URL[];
  }) {
    this.trustedGateways = trustedGateways;
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
    // get the hash from every gateway, and ensure they all match
    const hashSet = new Set();
    const hashResults: { gateway: string; txIdHash: string }[] = [];
    const hashes = await Promise.all(
      this.trustedGateways.map(
        async (gateway: URL): Promise<string | undefined> => {
          const sandbox = sandboxFromId(txId);
          const urlWithSandbox = `${gateway.protocol}//${sandbox}.${gateway.hostname}/${txId}`;
          let txIdHash: string | undefined;
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
              return;
            }

            const fetchedTxIdHash = response.headers.get(
              arioGatewayHeaders.digest,
            );

            if (fetchedTxIdHash !== null && fetchedTxIdHash !== undefined) {
              txIdHash = fetchedTxIdHash;
              break;
            }
          }

          if (txIdHash === undefined) {
            // skip this gateway if we didn't get a hash
            return undefined;
          }

          hashResults.push({
            gateway: gateway.hostname,
            txIdHash,
          });

          return txIdHash;
        },
      ),
    );

    for (const hash of hashes) {
      if (hash !== undefined) {
        hashSet.add(hash);
      }
    }

    if (hashSet.size === 0) {
      throw new Error(`No trusted gateways returned a hash for txId ${txId}`);
    }

    if (hashSet.size > 1) {
      throw new Error(
        `Failed to get consistent hash from all trusted gateways. ${JSON.stringify(
          hashResults,
        )}`,
      );
    }
    return { hash: hashResults[0].txIdHash, algorithm: 'sha256' };
  }

  /**
   * Get the data root for a given txId from all trusted gateways and ensure they all match.
   * @param txId - The txId to get the data root for.
   * @returns The data root for the given txId.
   */
  async getDataRoot({ txId }: { txId: string }): Promise<string> {
    const dataRootSet = new Set();
    const dataRootResults: { gateway: string; dataRoot: string }[] = [];
    const dataRoots = await Promise.all(
      this.trustedGateways.map(async (gateway): Promise<string | undefined> => {
        const response = await fetch(
          `${gateway.toString()}tx/${txId}/data_root`,
        );
        if (!response.ok) {
          // skip this gateway
          return undefined;
        }
        const dataRoot = await response.text();
        dataRootResults.push({
          gateway: gateway.hostname,
          dataRoot,
        });
        return dataRoot;
      }),
    );

    for (const dataRoot of dataRoots) {
      if (dataRoot !== undefined) {
        dataRootSet.add(dataRoot);
      }
    }

    if (dataRootSet.size > 1) {
      throw new Error(
        `Failed to get consistent data root from all trusted gateways. ${JSON.stringify(
          dataRootResults,
        )}`,
      );
    }

    return dataRootSet.values().next().value as string;
  }
}
