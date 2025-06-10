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
import { pLimit } from 'plimit-lit';
import { RoutingStrategy } from '../../types/wayfinder.js';
import { Logger, defaultLogger } from '../wayfinder.js';

export class FastestPingRoutingStrategy implements RoutingStrategy {
  private timeoutMs: number;
  private probePath: string;
  private logger: Logger;
  private maxConcurrency: number;

  constructor({
    timeoutMs = 500,
    maxConcurrency = 50,
    probePath = '/ar-io/info', // TODO: limit to allowed /ar-io and arweave node endpoints
    logger = defaultLogger,
  }: {
    timeoutMs?: number;
    maxConcurrency?: number;
    probePath?: string;
    logger?: Logger;
  } = {}) {
    this.timeoutMs = timeoutMs;
    this.probePath = probePath;
    this.logger = logger;
    this.maxConcurrency = maxConcurrency;
  }

  async selectGateway({ gateways }: { gateways: URL[] }): Promise<URL> {
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
        probePath: this.probePath,
      },
    );

    const throttle = pLimit(Math.min(this.maxConcurrency, gateways.length));
    const pingPromises = gateways.map(
      async (gateway): Promise<{ gateway: URL; durationMs: number }> => {
        return throttle(async () => {
          const pingUrl = `${gateway.toString().replace(/\/$/, '')}${this.probePath}`;

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
              probePath: this.probePath,
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
