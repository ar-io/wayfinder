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

export class RoundRobinRoutingStrategy implements RoutingStrategy {
  public readonly name = 'round-robin';
  private gateways: URL[];
  private currentIndex: number;
  private logger: Logger;
  private gatewaysProvider?: GatewaysProvider;

  constructor({
    gateways,
    logger = defaultLogger,
    gatewaysProvider,
  }: {
    gateways?: URL[];
    logger?: Logger;
    gatewaysProvider?: GatewaysProvider;
  } = {}) {
    if (gateways && gatewaysProvider) {
      throw new Error('Cannot provide both gateways and gatewaysProvider');
    }
    if (!gateways && !gatewaysProvider) {
      gateways = [
        new URL('https://arweave.net'),
        new URL('https://permagate.io'),
      ]
    }

    this.gateways = gateways || [];
    this.currentIndex = 0;
    this.logger = logger;
    this.gatewaysProvider = gatewaysProvider;
  }

  async selectGateway(): Promise<URL> {
    // Lazy load gateways from provider if not already loaded
    if (this.gateways.length === 0 && this.gatewaysProvider) {
      this.logger.debug('Loading gateways from provider');
      this.gateways = await this.gatewaysProvider.getGateways();
      this.currentIndex = 0;
    }

    if (this.gateways.length === 0) {
      throw new Error('No gateways available');
    }

    const gateway = this.gateways[this.currentIndex];
    this.logger.debug('Selecting gateway', {
      gateway: gateway.toString(),
      currentIndex: this.currentIndex,
      totalGateways: this.gateways.length,
    });
    this.currentIndex = (this.currentIndex + 1) % this.gateways.length;
    return gateway;
  }
}
