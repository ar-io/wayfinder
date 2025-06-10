import { RoutingStrategy } from '../../types/wayfinder.js';
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

export class RoundRobinRoutingStrategy implements RoutingStrategy {
  public readonly name = 'round-robin';
  private gateways: URL[];
  private currentIndex: number;
  private logger: Logger;

  constructor({
    gateways,
    logger = defaultLogger,
  }: {
    gateways: URL[];
    logger?: Logger;
  }) {
    this.gateways = gateways;
    this.currentIndex = 0;
    this.logger = logger;
  }

  // provided gateways are ignored
  async selectGateway({
    gateways = [],
  }: {
    gateways?: URL[];
  } = {}): Promise<URL> {
    if (gateways.length > 0) {
      this.logger.warn(
        'RoundRobinRoutingStrategy does not accept provided gateways. Ignoring provided gateways...',
        {
          providedGateways: gateways.length,
          internalGateways: this.gateways,
        },
      );
    }
    const gateway = this.gateways[this.currentIndex];
    this.currentIndex = (this.currentIndex + 1) % this.gateways.length;
    return gateway;
  }
}
