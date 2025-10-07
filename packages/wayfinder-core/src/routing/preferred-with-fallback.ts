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
import { CompositeRoutingStrategy } from './composite.js';
import { FastestPingRoutingStrategy } from './ping.js';
import { PingRoutingStrategy } from './ping.js';
import { StaticRoutingStrategy } from './static.js';

export class PreferredWithFallbackRoutingStrategy implements RoutingStrategy {
  public readonly name = 'preferred-with-fallback';
  public readonly preferredGateway: URL;
  public readonly fallbackStrategy: RoutingStrategy;
  private compositeStrategy: CompositeRoutingStrategy;

  constructor({
    preferredGateway,
    fallbackStrategy = new FastestPingRoutingStrategy(),
    logger = defaultLogger,
  }: {
    preferredGateway: string;
    fallbackStrategy?: RoutingStrategy;
    logger?: Logger;
  }) {
    this.fallbackStrategy = fallbackStrategy;
    this.preferredGateway = new URL(preferredGateway);

    // create a composite strategy that tries the preferred gateway first, then falls back
    this.compositeStrategy = new CompositeRoutingStrategy({
      strategies: [
        new PingRoutingStrategy({
          routingStrategy: new StaticRoutingStrategy({
            gateway: preferredGateway,
            logger,
          }),
          retries: 1,
          timeoutMs: 1000,
          logger,
        }),
        fallbackStrategy,
      ],
      logger,
    });
  }

  async selectGateway({
    gateways,
    path,
    subdomain,
  }: {
    gateways?: URL[];
    path?: string;
    subdomain?: string;
  } = {}): Promise<URL> {
    return this.compositeStrategy.selectGateway({
      gateways,
      path,
      subdomain,
    });
  }
}
