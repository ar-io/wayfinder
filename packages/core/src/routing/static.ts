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

    this.gateway = new URL(gateway);
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
