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
import { pLimit } from 'plimit-lit';
import { RoutingStrategy } from '../../types/wayfinder.js';
import { Logger, defaultLogger } from '../logger.js';

export class FastestPingRoutingStrategy implements RoutingStrategy {
  private timeoutMs: number;
  private logger: Logger;
  private maxConcurrency: number;

  constructor({
    timeoutMs = 500,
    maxConcurrency = 50,
    logger = defaultLogger,
  }: {
    timeoutMs?: number;
    maxConcurrency?: number;
    logger?: Logger;
  } = {}) {
    this.timeoutMs = timeoutMs;
    this.logger = logger;
    this.maxConcurrency = maxConcurrency;
  }

  async selectGateway({
    gateways,
    path = '',
    subdomain,
  }: {
    gateways: URL[];
    path?: string;
    subdomain?: string;
  }): Promise<URL> {
    if (gateways.length === 0) {
      const error = new Error('No gateways provided');
      this.logger.error('Failed to select gateway', { error: error.message });
      throw error;
    }

    this.logger.debug(
      `Pinging ${gateways.length} gateways with timeout ${this.timeoutMs}ms`,
      {
        gateways: gateways.map((g) => g.toString()),
        timeoutMs: this.timeoutMs,
        probePath: path,
      },
    );

    const throttle = pLimit(Math.min(this.maxConcurrency, gateways.length));
    const pingPromises = gateways.map(
      async (gateway): Promise<{ gateway: URL; durationMs: number }> => {
        return throttle(async () => {
          const url = new URL(gateway.toString());
          if (subdomain) {
            url.hostname = `${subdomain}.${url.hostname}`;
          }
          const pingUrl = new URL(path.replace(/^\//, ''), url).toString();

          this.logger.debug(`Pinging gateway ${gateway.toString()}`, {
            gateway: gateway.toString(),
            pingUrl,
          });

          const startTime = Date.now();
          const response = await fetch(pingUrl, {
            method: 'HEAD',
            signal: AbortSignal.timeout(this.timeoutMs),
          });

          if (response.ok) {
            // clear the queue to prevent the next gateway from being pinged
            throttle.clearQueue();
            return { gateway, durationMs: Date.now() - startTime };
          }

          throw new Error('Failed to ping gateway', {
            cause: {
              gateway: gateway.toString(),
              path: path,
              status: response.status,
            },
          });
        });
      },
    );

    const { gateway, durationMs } = await Promise.any(pingPromises);

    this.logger.debug('Successfully selected fastest gateway', {
      gateway: gateway.toString(),
      durationMs,
    });

    return gateway;
  }
}
