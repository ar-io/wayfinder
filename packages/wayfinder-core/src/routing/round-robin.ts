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

  async selectGateway(): Promise<URL> {
    const gateway = this.gateways[this.currentIndex];
    this.logger.info('Selecting gateway', { gateway });
    this.currentIndex = (this.currentIndex + 1) % this.gateways.length;
    return gateway;
  }
}
