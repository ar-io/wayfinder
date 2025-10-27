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
import type { GatewaysProvider, Logger, RoutingStrategy } from '../types.js';

export class FastestPingRoutingStrategy implements RoutingStrategy {
  public readonly name = 'fastest-ping';
  private timeoutMs: number;
  private logger: Logger;
  private maxConcurrency: number;
  private gatewaysProvider?: GatewaysProvider;

  constructor({
    timeoutMs = 500,
    maxConcurrency = 50,
    logger = defaultLogger,
    gatewaysProvider,
  }: {
    timeoutMs?: number;
    maxConcurrency?: number;
    logger?: Logger;
    gatewaysProvider?: GatewaysProvider;
  } = {}) {
    this.timeoutMs = timeoutMs;
    this.logger = logger;
    this.maxConcurrency = maxConcurrency;
    this.gatewaysProvider = gatewaysProvider;
  }

  async selectGateway({
    gateways,
    path = '',
    subdomain,
  }: {
    gateways?: URL[];
    path?: string;
    subdomain?: string;
  }): Promise<URL> {
    const resolvedGateways =
      gateways ??
      (this.gatewaysProvider ? await this.gatewaysProvider.getGateways() : []);

    if (resolvedGateways.length === 0) {
      const error = new Error('No gateways provided');
      this.logger.error('Failed to select gateway', { error: error.message });
      throw error;
    }

    try {
      this.logger.debug(
        `Pinging ${resolvedGateways.length} gateways with timeout ${this.timeoutMs}ms`,
        {
          gateways: resolvedGateways.map((g) => g.toString()),
          timeoutMs: this.timeoutMs,
          probePath: path,
        },
      );

      const throttle = pLimit(
        Math.min(this.maxConcurrency, resolvedGateways.length),
      );
      const pingPromises = resolvedGateways.map(
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
        gateways: resolvedGateways.map((g) => g.toString()),
      });
      throw new Error('All gateways failed to respond', {
        cause: {
          gateways: resolvedGateways.map((g) => g.toString()),
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
  public readonly name = 'ping';
  public readonly routingStrategy: RoutingStrategy;
  private logger: Logger;
  public readonly retries: number;
  public readonly timeoutMs: number;
  private gatewaysProvider?: GatewaysProvider;

  constructor({
    routingStrategy,
    logger = defaultLogger,
    retries = 5,
    timeoutMs = 1000,
    gatewaysProvider,
  }: {
    routingStrategy: RoutingStrategy;
    logger?: Logger;
    retries?: number;
    timeoutMs?: number;
    gatewaysProvider?: GatewaysProvider;
  }) {
    this.routingStrategy = routingStrategy;
    this.logger = logger;
    this.retries = retries;
    this.timeoutMs = timeoutMs;
    this.gatewaysProvider = gatewaysProvider;
  }

  async selectGateway(params: {
    gateways?: URL[];
    path?: string;
    subdomain?: string;
  }): Promise<URL> {
    const { gateways, path, subdomain } = params;
    const resolvedGateways =
      gateways ??
      (this.gatewaysProvider ? await this.gatewaysProvider.getGateways() : []);

    if (resolvedGateways.length === 0) {
      throw new Error('No gateways available');
    }

    const paramsWithGateways = { ...params, gateways: resolvedGateways };

    for (let i = 0; i < this.retries; i++) {
      let selectedGateway: URL | undefined = undefined;
      try {
        selectedGateway =
          await this.routingStrategy.selectGateway(paramsWithGateways);

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

        const response = await fetch(pingUrl.toString(), {
          method: 'HEAD',
          signal: AbortSignal.timeout(this.timeoutMs),
        });

        if (!response.ok) {
          this.logger.debug('Failed to ping gateway', {
            gateway: selectedGateway.toString(),
            pingUrl: pingUrl.toString(),
            status: response.status,
          });
          throw new Error(
            `Failed to ping gateway for ${pingUrl.toString()}: ${response.statusText} (status: ${response.status})`,
            {
              cause: {
                gateway: selectedGateway.toString(),
                pingUrl: pingUrl.toString(),
                status: response.status,
              },
            },
          );
        }

        this.logger.debug('HEAD check successful', {
          gateway: selectedGateway.toString(),
          pingUrl: pingUrl.toString(),
          status: response.status,
        });

        return selectedGateway;
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
        gateways: resolvedGateways.map((g) => g.toString()),
        path,
        subdomain,
        retries: this.retries,
      },
    });
  }
}
