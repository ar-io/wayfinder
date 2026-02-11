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

const BUNDLED_IN_QUERY = `
  query GetBundledIn($id: ID!) {
    transactions(ids: [$id]) {
      edges {
        node {
          id
          bundledIn {
            id
          }
        }
      }
    }
  }
`;

type GqlRootTransactionSourceParams = {
  gqlEndpoints?: string[];
  logger?: Logger;
  fetch?: typeof globalThis.fetch;
};

/**
 * Resolves data item IDs to root transaction IDs using GraphQL queries
 * to look up the `bundledIn` field.
 *
 * This is web-compatible and does not require any Node.js-specific APIs.
 * Note: GQL does not provide rootDataItemOffset or rootDataOffset.
 */
export class GqlRootTransactionSource implements RootTransactionSource {
  private gqlEndpoints: string[];
  private logger: Logger;
  private fetch: typeof globalThis.fetch;

  constructor({
    gqlEndpoints = ['https://arweave-search.goldsky.com/graphql'],
    logger = defaultLogger,
    fetch: fetchFn = globalThis.fetch,
  }: GqlRootTransactionSourceParams = {}) {
    this.gqlEndpoints = gqlEndpoints;
    this.logger = logger;
    this.fetch = fetchFn;
  }

  async getRootTransaction({
    txId,
  }: {
    txId: string;
  }): Promise<RootTransactionInfo> {
    for (const endpoint of this.gqlEndpoints) {
      try {
        this.logger.debug('Querying GQL for bundledIn', { txId, endpoint });

        const response = await this.fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            query: BUNDLED_IN_QUERY,
            variables: { id: txId },
          }),
        });

        if (!response.ok) {
          this.logger.debug('GQL request failed', {
            txId,
            endpoint,
            status: response.status,
          });
          continue;
        }

        const result = await response.json();
        const node = result.data?.transactions?.edges?.[0]?.node;

        if (!node) {
          this.logger.debug('Transaction not found in GQL response', {
            txId,
            endpoint,
          });
          continue;
        }

        const bundledInId = node.bundledIn?.id;

        if (bundledInId) {
          return {
            rootTransactionId: bundledInId,
            isDataItem: true,
          };
        }

        return {
          rootTransactionId: txId,
          isDataItem: false,
        };
      } catch (error: any) {
        this.logger.debug('Error querying GQL endpoint', {
          txId,
          endpoint,
          error: error.message,
        });
      }
    }

    throw new Error(
      'Failed to get root transaction info from any GQL endpoint',
      { cause: { txId } },
    );
  }
}
