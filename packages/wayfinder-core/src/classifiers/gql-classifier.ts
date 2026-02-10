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
import type { DataClassifier, Logger } from '../types.js';

/**
 * @deprecated Use {@link GqlRootTransactionSource} from `../root-transaction/gql.js` instead.
 */
export class GqlClassifier implements DataClassifier {
  private readonly gqlEndpoint: URL;
  private readonly logger: Logger;

  constructor({
    gqlEndpoint = 'https://arweave-search.goldsky.com/graphql',
    logger = defaultLogger,
  }: {
    gqlEndpoint?: string;
    logger?: Logger;
  } = {}) {
    this.gqlEndpoint = new URL(gqlEndpoint);
    this.logger = logger;
  }

  async classify({
    txId,
  }: { txId: string }): Promise<'ans104' | 'transaction'> {
    const response = await fetch(this.gqlEndpoint.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: `
            query GetTransaction($id: ID!) {
              transactions(ids: [$id]) {
                edges {
                  node {
                    bundledIn {
                      id
                    }
                  }
                }
              }
            }
          `,
        variables: {
          id: txId,
        },
      }),
    });

    if (!response.ok) {
      this.logger.debug('Failed to fetch transaction from GraphQL', {
        txId,
        status: response.status,
      });
      return 'transaction';
    }

    const result = await response.json();
    const bundledIn = result.data?.transaction?.bundledIn;

    return bundledIn ? 'ans104' : 'transaction';
  }
}
