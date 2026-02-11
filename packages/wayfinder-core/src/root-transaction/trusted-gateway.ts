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

import { defaultLogger } from '../logger.js';
import type {
  Logger,
  RootTransactionInfo,
  RootTransactionSource,
} from '../types.js';
import { arioGatewayHeaders } from '../utils/ario.js';

type TrustedGatewayRootTransactionSourceParams = {
  trustedGateways: URL[];
  logger?: Logger;
  fetch?: typeof globalThis.fetch;
};

/**
 * Resolves data item IDs to root transaction IDs using HEAD requests
 * to trusted AR.IO gateways. Reads root transaction info from response headers.
 */
export class TrustedGatewayRootTransactionSource
  implements RootTransactionSource
{
  private trustedGateways: URL[];
  private logger: Logger;
  private fetch: typeof globalThis.fetch;

  constructor({
    trustedGateways,
    logger = defaultLogger,
    fetch: fetchFn = globalThis.fetch,
  }: TrustedGatewayRootTransactionSourceParams) {
    this.trustedGateways = trustedGateways;
    this.logger = logger;
    this.fetch = fetchFn;
  }

  async getRootTransaction({
    txId,
  }: {
    txId: string;
  }): Promise<RootTransactionInfo> {
    for (const trustedGateway of this.trustedGateways) {
      try {
        const url = new URL(`/${txId}`, trustedGateway);

        this.logger.debug('Making HEAD request to trusted gateway', {
          url: url.toString(),
          txId,
        });

        const response = await this.fetch(url, {
          method: 'HEAD',
          redirect: 'follow',
        });

        if (!response.ok) {
          this.logger.debug('HEAD request failed', {
            txId,
            gateway: trustedGateway.toString(),
            status: response.status,
          });
          continue;
        }

        const rootTransactionId = response.headers.get(
          arioGatewayHeaders.rootTransactionId,
        );

        const rootDataItemOffsetStr = response.headers.get(
          arioGatewayHeaders.rootDataItemOffset,
        );
        const rootDataOffsetStr = response.headers.get(
          arioGatewayHeaders.rootDataOffset,
        );

        const rootDataItemOffset =
          rootDataItemOffsetStr != null
            ? parseInt(rootDataItemOffsetStr, 10)
            : undefined;
        const rootDataOffset =
          rootDataOffsetStr != null
            ? parseInt(rootDataOffsetStr, 10)
            : undefined;

        if (rootTransactionId && rootTransactionId !== txId) {
          return {
            rootTransactionId,
            rootDataItemOffset,
            rootDataOffset,
            isDataItem: true,
          };
        }

        return {
          rootTransactionId: txId,
          isDataItem: false,
        };
      } catch (error: any) {
        this.logger.debug('Error fetching root transaction info', {
          txId,
          gateway: trustedGateway.toString(),
          error: error.message,
        });
      }
    }

    throw new Error(
      'Failed to get root transaction info from any trusted gateway',
      { cause: { txId } },
    );
  }
}
