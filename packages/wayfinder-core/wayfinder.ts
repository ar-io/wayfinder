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
import { ARIO } from '@ar.io/sdk';
import {
  NetworkGatewaysProvider,
  PreferredWithFallbackRoutingStrategy,
  RandomRoutingStrategy,
  StaticRoutingStrategy,
  createWayfinderClient,
} from '@ar.io/wayfinder-core';
import { TArweaveData } from '../types';

const gatewayProvider = new NetworkGatewaysProvider({
  ario: ARIO.mainnet(),
  sortBy: 'operatorStake',
  limit: 5,
  sortOrder: 'desc',
});

const randomStrategy = new RandomRoutingStrategy({
  gatewaysProvider: gatewayProvider,
});

const _strategy = new PreferredWithFallbackRoutingStrategy({
  preferredGateway: 'https://arweave.net',
  fallbackStrategy: randomStrategy,
});

const wayfinder = createWayfinderClient({
  ario: ARIO.mainnet(),
  routingStrategy: new StaticRoutingStrategy({
    gateway: 'https://arweave.net',
  }),
});

const requestGraphQL = async (id: string): Promise<TArweaveData> => {
  const response = await wayfinder.request('ar:///graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: `
            query {
            transactions(first:1, ids: ["${id}"]) {
                edges {
                node {
                    id
                    tags {
                    name
                    value
                    }
                }
                }
            }
            }
        `,
    }),
  });

  const data = await response.json();
  if (!data) return {} as TArweaveData;
  const edges = data.data.transactions.edges;
  if (edges.length === 0) return {} as TArweaveData;
  const { node } = edges[0];
  return {
    id: node.id,
    tags: node.tags,
  };
};

export { requestGraphQL };

requestGraphQL('xf958qhCNGfDme1FtoiD6DtMfDENDbtxZpjOM_1tsMM').then(console.log);
