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
import { arioHeaderNames } from '../constants.js';
import { defaultLogger } from '../logger.js';
import type { DataStream, Logger, VerificationStrategy } from '../types.js';
import { normalizeHeaders } from '../utils/ario.js';
import { hashDataStreamToB64Url } from '../utils/hash.js';
import { constructVerificationUrl } from '../utils/verification-url.js';

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
   * @param raw - When true, fetch from /raw/{txId} endpoint instead of /{txId}.
   * @returns The digest for the given txId.
   */
  async getDigest({
    txId,
    raw = false,
  }: {
    txId: string;
    raw?: boolean;
  }): Promise<{ hash: string; algorithm: 'sha256' }> {
    this.logger.debug('Getting digest for txId', {
      txId,
      raw,
      maxConcurrency: this.maxConcurrency,
      trustedGateways: this.trustedGateways,
    });

    // TODO: shuffle gateways to avoid bias
    const throttle = pLimit(this.maxConcurrency);
    const hashPromises = this.trustedGateways.map(
      async (gateway: URL): Promise<{ hash: string; gateway: URL }> => {
        return throttle(async () => {
          const url = constructVerificationUrl({ gateway, txId, raw });
          /**
           * This is a problem because we're not able to verify the hash of the data item if the gateway doesn't have the data in its cache. We start with a HEAD request, if it fails, we do a GET request to hydrate the cache and then a HEAD request again to get the cached digest.
           *
           * Note: Not all gateways return x-ar-io-digest for /raw/ endpoints (e.g., turbo-gateway.com doesn't, but ardrive.net does).
           * The implementation tries multiple trusted gateways until one returns the digest.
           */
          for (const method of ['HEAD', 'GET', 'HEAD']) {
            const response = await fetch(url, {
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
                  raw,
                  gateway: gateway.toString(),
                },
              });
            }

            const fetchedTxIdHash = response.headers.get(
              arioHeaderNames.digest,
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
              raw,
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
        raw,
        hash,
        gateway: gateway.toString(),
      },
    );
    return { hash, algorithm: 'sha256' };
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
    const normalizedHeaders = normalizeHeaders(headers);

    // Extract header values for manifest/ArNS detection
    const headerDataId =
      normalizedHeaders[arioHeaderNames.dataId.toLowerCase()];
    const headerResolvedId =
      normalizedHeaders[arioHeaderNames.arnsResolvedId.toLowerCase()];

    // Determine what data was actually served and what ID to verify against:
    // - x-ar-io-data-id: The actual content served (e.g., index.html for manifests)
    // - x-arns-resolved-id: The resolved txId from ArNS (could be manifest or direct)
    //
    // Manifest detection:
    // - If dataId !== resolvedId → it's a manifest, dataId is the index content
    // - If dataId === resolvedId (or only one present) → direct content
    // - If neither present → fall back to original txId
    const isManifest =
      headerDataId && headerResolvedId && headerDataId !== headerResolvedId;

    // The ID to verify against - always verify the actual bytes we received
    const verificationId = headerDataId || headerResolvedId || txId;

    // Determine if we need to use raw verification:
    // - raw=true explicitly set AND we're not looking at resolved manifest content
    // - For manifests (dataId !== resolvedId), we received index content, verify normally
    // - For raw manifest fetch (raw=true, no manifest resolution), use /raw/ endpoint
    const isRawVerification = raw && !isManifest;

    this.logger.debug('Starting hash verification', {
      txId,
      headerDataId,
      headerResolvedId,
      verificationId,
      isManifest,
      raw,
      isRawVerification,
    });

    // Always verify against trusted gateways - never trust source gateway headers
    const [computedHash, expectedHash] = await Promise.all([
      hashDataStreamToB64Url({ stream: data }),
      this.getDigest({ txId: verificationId, raw: isRawVerification }),
    ]);

    if (computedHash === undefined) {
      throw new Error('Hash could not be computed');
    }
    if (computedHash !== expectedHash.hash) {
      throw new Error('Hash does not match', {
        cause: {
          computedHash,
          trustedHash: expectedHash,
          txId,
          verificationId,
          isManifest,
          raw: isRawVerification,
        },
      });
    }
  }
}
