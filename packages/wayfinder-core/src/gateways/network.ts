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
import type { ARIORead } from '@ar.io/sdk';
import { defaultLogger } from '../logger.js';
import type { GatewaysProvider, Logger, SortBy, SortOrder } from '../types.js';

export class NetworkGatewaysProvider implements GatewaysProvider {
  private ario: ARIORead;
  private sortBy: SortBy;
  private sortOrder: SortOrder;
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
    ario: ARIORead;
    sortBy?: SortBy;
    sortOrder?: SortOrder;
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

    // Fetch enough gateways to satisfy the limit after filtering.
    // Request up to limit per page (capped at 1000 by the SDK) and
    // stop paginating once we have enough filtered results.
    const pageSize = Math.min(this.limit, 1000);

    do {
      try {
        this.logger.debug('Fetching gateways batch', { cursor, attempts });

        const { items: newGateways = [], nextCursor } =
          await this.ario.getGateways({
            limit: pageSize,
            cursor,
            sortBy: this.sortBy,
            sortOrder: this.sortOrder,
          });

        gateways.push(...newGateways);
        cursor = nextCursor;
        attempts = 0;

        this.logger.debug('Fetched gateways batch', {
          batchSize: newGateways.length,
          totalFetched: gateways.length,
          nextCursor: cursor,
        });

        // Stop early if we already have enough gateways that pass the filter
        const filteredSoFar = gateways.filter(this.filter);
        if (filteredSoFar.length >= this.limit) {
          this.logger.debug('Reached gateway limit, stopping pagination', {
            filteredCount: filteredSoFar.length,
            limit: this.limit,
          });
          break;
        }
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
