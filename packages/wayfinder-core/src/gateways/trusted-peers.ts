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
/**
 * GatewaysProvider that fetches the list of trusted peers (gateways) from a trusted AR.IO gateway.
 * The endpoint is expected to be `${trustedGateway}/ar-io/peers` and return a JSON with a `gateways` object.
 * Each key in the `gateways` object is a gateway identifier, and the value contains a `url` property.
 */

import { defaultLogger } from '../logger.js';
import type { GatewaysProvider, Logger } from '../types.js';

export class TrustedPeersGatewaysProvider implements GatewaysProvider {
  private trustedGateway: URL;
  private logger: Logger;

  constructor({
    trustedGateway,
    logger = defaultLogger,
  }: { trustedGateway: string | URL; logger?: Logger }) {
    this.trustedGateway = new URL(trustedGateway.toString());
    this.logger = logger;
  }

  async getGateways(): Promise<URL[]> {
    const endpoint = new URL('/ar-io/peers', this.trustedGateway).toString();

    this.logger.debug('Fetching trusted peer list from', { endpoint });

    const response = await fetch(endpoint, { method: 'GET' });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch trusted peer list: ${response.status} ${response.statusText} ${await response.text()}`,
      );
    }

    const data = await response.json();

    if (!data.gateways || typeof data.gateways !== 'object') {
      throw new Error(
        'Invalid trusted peer list format: missing "gateways" object',
      );
    }

    // Parse and validate each gateway url as a URL
    const gateways: URL[] = [];
    for (const key of Object.keys(data.gateways)) {
      const gw = data.gateways[key];
      if (gw && typeof gw.url === 'string') {
        try {
          gateways.push(new URL(gw.url));
        } catch {
          // skip invalid URLs
        }
      }
    }

    return gateways;
  }
}
