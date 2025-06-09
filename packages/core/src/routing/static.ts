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
import { Logger, defaultLogger } from '../wayfinder.js';
import { RoutingStrategy } from '../../types/wayfinder.js';

export class StaticRoutingStrategy implements RoutingStrategy {
  public readonly name = 'static';
  private gateway: URL;
  private logger: Logger;

  constructor({
    gateway,
    logger = defaultLogger,
  }: {
    gateway: string;
    logger?: Logger;
  }) {
    this.logger = logger;
    
    try {
      this.gateway = new URL(gateway);
    } catch (error: any) {
      this.logger.error('Invalid URL provided for static gateway', {
        gateway,
        error: error.message,
      });
      throw error;
    }
  }

  // provided gateways are ignored
  async selectGateway({
    gateways = [],
  }: {
    gateways?: URL[];
  } = {}): Promise<URL> {
    if (gateways.length > 0) {
      this.logger.warn(
        'StaticRoutingStrategy does not accept provided gateways. Ignoring provided gateways...',
        {
          providedGateways: gateways.length,
          internalGateway: this.gateway,
        },
      );
    }
    return this.gateway;
  }
}
