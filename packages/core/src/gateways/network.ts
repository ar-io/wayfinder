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
import type { AoARIORead } from '@ar.io/sdk';
import { defaultLogger } from '../logger.js';
import type { GatewaysProvider, Logger } from '../types.js';

export class NetworkGatewaysProvider implements GatewaysProvider {
  private ario: AoARIORead;
  private sortBy: 'totalDelegatedStake' | 'operatorStake' | 'startTimestamp';
  private sortOrder: 'asc' | 'desc';
  private limit: number;
  private filter: (gateway: any) => boolean;
  private logger: Logger;

  constructor({
    ario,
    sortBy = 'operatorStake',
    sortOrder = 'desc',
    limit = 1000,
    filter = (g) => g.status === 'joined',
    logger = defaultLogger,
  }: {
    ario: AoARIORead;
    sortBy?: 'totalDelegatedStake' | 'operatorStake' | 'startTimestamp';
    sortOrder?: 'asc' | 'desc';
    limit?: number;
    blocklist?: string[];
    filter?: (gateway: any) => boolean;
    logger?: Logger;
  }) {
    this.ario = ario;
    this.sortBy = sortBy;
    this.sortOrder = sortOrder;
    this.limit = limit;
    this.filter = filter;
    this.logger = logger;
  }

  async getGateways(): Promise<URL[]> {
    let cursor: string | undefined;
    let attempts = 0;
    const gateways: any[] = [];

    this.logger.debug('Starting to fetch gateways from AR.IO network', {
      sortBy: this.sortBy,
      sortOrder: this.sortOrder,
      limit: this.limit,
    });

    do {
      try {
        this.logger.debug('Fetching gateways batch', { cursor, attempts });

        const { items: newGateways = [], nextCursor } =
          await this.ario.getGateways({
            limit: 1000,
            cursor,
            sortBy: this.sortBy,
            sortOrder: this.sortOrder,
          });

        gateways.push(...newGateways);
        cursor = nextCursor;
        attempts = 0; // reset attempts if we get a new cursor

        this.logger.debug('Fetched gateways batch', {
          batchSize: newGateways.length,
          totalFetched: gateways.length,
          nextCursor: cursor,
        });
      } catch (error: any) {
        this.logger.error('Error fetching gateways', {
          cursor,
          attempts,
          error: error.message,
          stack: error.stack,
        });
        attempts++;
      }
    } while (cursor !== undefined && attempts < 3);

    // filter out any gateways that are not joined
    const filteredGateways = gateways.filter(this.filter).slice(0, this.limit);

    this.logger.debug('Finished fetching gateways', {
      totalFetched: gateways.length,
      filteredCount: filteredGateways.length,
    });

    return filteredGateways.map(
      (g) =>
        new URL(
          `${g.settings.protocol}://${g.settings.fqdn}:${g.settings.port}`,
        ),
    );
  }
}
