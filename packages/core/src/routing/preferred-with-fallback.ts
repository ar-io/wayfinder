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
import { RoutingStrategy } from '../../types/wayfinder.js';
import { Logger, defaultLogger } from '../wayfinder.js';
import { FastestPingRoutingStrategy } from './ping.js';

export class PreferredWithFallbackRoutingStrategy implements RoutingStrategy {
  public readonly name = 'preferred-with-fallback';
  private preferredGateway: URL;
  private fallbackStrategy: RoutingStrategy;
  private logger: Logger;

  constructor({
    preferredGateway,
    fallbackStrategy = new FastestPingRoutingStrategy(),
    logger = defaultLogger,
  }: {
    preferredGateway: string;
    fallbackStrategy?: RoutingStrategy;
    logger?: Logger;
  }) {
    try {
      this.preferredGateway = new URL(preferredGateway);
    } catch (error: any) {
      throw new Error(`Invalid URL provided for preferred gateway: ${preferredGateway}`);
    }
    this.fallbackStrategy = fallbackStrategy;
    this.logger = logger;
  }

  async selectGateway({ gateways = [] }: { gateways: URL[] }): Promise<URL> {
    this.logger.debug('Attempting to connect to preferred gateway', {
      preferredGateway: this.preferredGateway.toString(),
    });

    try {
      // Check if the preferred gateway is responsive
      const response = await fetch(this.preferredGateway.toString(), {
        method: 'HEAD',
        signal: AbortSignal.timeout(1000),
      });

      if (response.ok) {
        this.logger.debug('Successfully connected to preferred gateway', {
          preferredGateway: this.preferredGateway.toString(),
        });
        return this.preferredGateway;
      }

      throw new Error(
        `Preferred gateway responded with status: ${response.status}`,
      );
    } catch (error) {
      this.logger.warn(
        'Failed to connect to preferred gateway, falling back to alternative strategy',
        {
          preferredGateway: this.preferredGateway.toString(),
          error: error instanceof Error ? error.message : String(error),
          fallbackStrategy: this.fallbackStrategy.constructor.name,
        },
      );

      // Fall back to the provided routing strategy
      return this.fallbackStrategy.selectGateway({ gateways });
    }
  }
}