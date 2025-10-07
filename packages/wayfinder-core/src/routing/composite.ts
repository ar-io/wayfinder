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
import type { Logger, RoutingStrategy } from '../types.js';

export class CompositeRoutingStrategy implements RoutingStrategy {
  public readonly name = 'composite';
  private strategies: RoutingStrategy[];
  private logger: Logger;

  constructor({
    strategies = [],
    logger = defaultLogger,
  }: {
    strategies?: RoutingStrategy[];
    logger?: Logger;
  } = {}) {
    if (strategies.length === 0) {
      throw new Error('At least one routing strategy must be provided');
    }
    this.strategies = strategies;
    this.logger = logger;
  }

  async selectGateway(params: {
    gateways?: URL[];
    path?: string;
    subdomain?: string;
  }): Promise<URL> {
    this.logger.debug('CompositeRoutingStrategy: starting gateway selection', {
      strategiesCount: this.strategies.length,
      gateways: params.gateways?.map((g) => g.toString()),
    });

    for (const strategy of this.strategies) {
      try {
        this.logger.debug(`CompositeRoutingStrategy: trying strategy`);
        const gateway = await strategy.selectGateway(params);
        this.logger.debug(`CompositeRoutingStrategy: strategy succeeded`, {
          selectedGateway: gateway.toString(),
        });
        return gateway;
      } catch (error) {
        this.logger.debug(`CompositeRoutingStrategy: strategy failed`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    this.logger.error('CompositeRoutingStrategy: all strategies failed');
    throw new Error('All routing strategies failed to select a gateway');
  }

  addStrategy(strategy: RoutingStrategy): void {
    this.strategies.push(strategy);
  }

  getStrategies(): RoutingStrategy[] {
    return [...this.strategies];
  }
}
