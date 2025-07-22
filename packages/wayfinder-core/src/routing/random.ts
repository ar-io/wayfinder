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
import { StaticGatewaysProvider } from '../gateways/static.js';
import type { GatewaysProvider, RoutingStrategy } from '../types.js';
import { randomInt } from '../utils/random.js';

export class RandomRoutingStrategy implements RoutingStrategy {
  private gatewaysProvider: GatewaysProvider;

  constructor({
    gatewaysProvider = new StaticGatewaysProvider({
      gateways: [
        'https://arweave.net',
        'https://permagate.io',
        'https://ardrive.net',
      ],
    }),
  }: {
    gatewaysProvider?: GatewaysProvider;
  } = {}) {
    this.gatewaysProvider = gatewaysProvider;
  }

  async selectGateway(): Promise<URL> {
    const gateways = await this.gatewaysProvider.getGateways();
    if (gateways.length === 0) {
      throw new Error('No gateways available');
    }
    return gateways[randomInt(0, gateways.length)];
  }
}
