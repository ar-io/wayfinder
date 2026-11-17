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
import type { GatewaysProvider, Logger, RoutingStrategy } from '../types.js';
import { randomInt } from '../utils/random.js';
import { withoutExcluded } from './exclude.js';

export class RandomRoutingStrategy implements RoutingStrategy {
  public readonly name = 'random';
  private gatewaysProvider?: GatewaysProvider;
  private logger: Logger;

  constructor({
    gatewaysProvider,
    logger = defaultLogger,
  }: {
    gatewaysProvider?: GatewaysProvider;
    logger?: Logger;
  } = {}) {
    this.gatewaysProvider = gatewaysProvider;
    this.logger = logger;
  }

  async selectGateway({
    gateways,
    exclude,
  }: {
    gateways?: URL[];
    exclude?: URL[];
  } = {}): Promise<URL> {
    const resolvedGateways =
      gateways ??
      (this.gatewaysProvider ? await this.gatewaysProvider.getGateways() : []);
    if (resolvedGateways.length === 0) {
      this.logger.error('No gateways available');
      throw new Error('No gateways available');
    }
    const pool = withoutExcluded(resolvedGateways, exclude);
    this.logger.debug('Selecting random gateway', {
      gateways: pool.map((g) => g.toString()),
      excluded: exclude?.map((g) => g.toString()),
    });
    return pool[randomInt(0, pool.length)];
  }
}
