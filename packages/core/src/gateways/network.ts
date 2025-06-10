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
import { ARIOReadable } from '@ar.io/sdk';
import { GatewaysProvider } from '../../types/wayfinder.js';
import { Logger, defaultLogger } from '../wayfinder.js';

export class NetworkGatewaysProvider implements GatewaysProvider {
  private ario: ARIOReadable;
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
    ario: ARIOReadable;
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
