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
import { defaultLogger } from '../logger.js';
import type { Logger, RoutingStrategy } from '../types.js';

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

    try {
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
    } catch {
      this.logger.error('All gateways failed to respond', {
        subdomain,
        path,
        gateways: gateways.map((g) => g.toString()),
      });
      throw new Error('All gateways failed to respond', {
        cause: {
          gateways: gateways.map((g) => g.toString()),
          path,
          subdomain,
        },
      });
    }
  }
}

/**
 * Wraps a base strategy and performs a HEAD check on the selected gateway.
 * If the HEAD check fails, it retries with a different gateway.
 * If the HEAD check succeeds, it returns the selected gateway.
 * If the HEAD check fails after all retries, it throws an error.
 */
export class PingRoutingStrategy implements RoutingStrategy {
  private routingStrategy: RoutingStrategy;
  private logger: Logger;
  private retries: number;
  private timeoutMs: number;

  constructor({
    routingStrategy,
    logger = defaultLogger,
    retries = 5,
    timeoutMs = 1000,
  }: {
    routingStrategy: RoutingStrategy;
    logger?: Logger;
    retries?: number;
    timeoutMs?: number;
  }) {
    this.routingStrategy = routingStrategy;
    this.logger = logger;
    this.retries = retries;
    this.timeoutMs = timeoutMs;
  }

  async selectGateway(params: {
    gateways?: URL[];
    path?: string;
    subdomain?: string;
  }): Promise<URL> {
    const { gateways = [], path, subdomain } = params;

    if (gateways.length === 0) {
      throw new Error('No gateways available');
    }

    for (let i = 0; i < this.retries; i++) {
      let selectedGateway: URL | undefined = undefined;
      try {
        selectedGateway = await this.routingStrategy.selectGateway(params);

        const pingUrl = new URL(selectedGateway.toString());
        if (subdomain) {
          pingUrl.hostname = `${subdomain}.${pingUrl.hostname}`;
        }
        if (path) {
          pingUrl.pathname = path;
        }

        this.logger.debug('Performing HEAD check on selected gateway', {
          gateway: selectedGateway.toString(),
          pingUrl: pingUrl.toString(),
          attempt: i + 1,
          timeoutMs: this.timeoutMs,
        });

        const response = await fetch(pingUrl, {
          method: 'HEAD',
          signal: AbortSignal.timeout(this.timeoutMs),
        });

        if (response.ok) {
          this.logger.debug('HEAD check successful', {
            gateway: selectedGateway.toString(),
            status: response.status,
          });
          return selectedGateway;
        }

        this.logger.debug(
          'HEAD check failed, retrying with different gateway',
          {
            gateway: selectedGateway.toString(),
            status: response.status,
            attempt: i + 1,
            retriesLeft: this.retries - i - 1,
          },
        );
      } catch (error) {
        this.logger.debug('HEAD check error, retrying with different gateway', {
          gateway: selectedGateway?.toString(),
          error: error instanceof Error ? error.message : String(error),
          attempt: i + 1,
          retriesLeft: this.retries - i - 1,
        });
      }
    }

    throw new Error('Failed to find working gateway after HEAD checks', {
      cause: {
        gateways: gateways.map((g) => g.toString()),
        path,
        subdomain,
        retries: this.retries,
      },
    });
  }
}
