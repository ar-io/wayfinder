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

/**
 * Path probed to decide whether a gateway is usable.
 *
 * The probe deliberately targets the gateway's own host and not the sandboxed
 * content URL of the request being routed. Probing the content URL makes the
 * gateway resolve the data before it can answer, so a short timeout measures
 * "is this object already cached here" rather than "is this gateway up".
 * Measured against the live network with a 1s budget, a HEAD of the gateway
 * root succeeded for ~85% of peers while a HEAD of the sandboxed content URL
 * succeeded for ~23% — and the gap is almost entirely latency, since the
 * sandboxed URL reaches ~78% once given 10s. Probing liveness therefore keeps
 * the fast rejection of dead gateways without discarding slow-but-working ones.
 *
 * The root is used rather than an AR.IO-specific endpoint so the strategy also
 * works against gateways supplied via `StaticGatewaysProvider` that may not
 * implement the AR.IO routes.
 */
const DEFAULT_PROBE_PATH = '/';

/**
 * Builds the URL used to probe a gateway's availability.
 */
const buildProbeUrl = ({
  gateway,
  probePath,
}: {
  gateway: URL;
  probePath: string;
}): string => {
  const url = new URL(gateway.toString());
  url.pathname = probePath;
  url.search = '';
  return url.toString();
};

export class FastestPingRoutingStrategy implements RoutingStrategy {
  public readonly name = 'fastest-ping';
  private timeoutMs: number;
  private logger: Logger;
  private maxConcurrency: number;
  private gatewaysProvider?: GatewaysProvider;
  private probePath: string;

  constructor({
    timeoutMs = 500,
    maxConcurrency = 50,
    logger = defaultLogger,
    gatewaysProvider,
    probePath = DEFAULT_PROBE_PATH,
  }: {
    timeoutMs?: number;
    maxConcurrency?: number;
    logger?: Logger;
    gatewaysProvider?: GatewaysProvider;
    /** Path probed on each gateway. See {@link DEFAULT_PROBE_PATH}. */
    probePath?: string;
  } = {}) {
    this.timeoutMs = timeoutMs;
    this.logger = logger;
    this.maxConcurrency = maxConcurrency;
    this.gatewaysProvider = gatewaysProvider;
    this.probePath = probePath;
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
          probePath: this.probePath,
          requestPath: path,
        },
      );

      const throttle = pLimit(
        Math.min(this.maxConcurrency, resolvedGateways.length),
      );
      const pingPromises = resolvedGateways.map(
        async (gateway): Promise<{ gateway: URL; durationMs: number }> => {
          return throttle(async () => {
            const pingUrl = buildProbeUrl({
              gateway,
              probePath: this.probePath,
            });

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
  private probePath: string;

  constructor({
    routingStrategy,
    logger = defaultLogger,
    retries = 5,
    timeoutMs = 1000,
    gatewaysProvider,
    probePath = DEFAULT_PROBE_PATH,
  }: {
    routingStrategy: RoutingStrategy;
    logger?: Logger;
    retries?: number;
    timeoutMs?: number;
    gatewaysProvider?: GatewaysProvider;
    /** Path probed on each gateway. See {@link DEFAULT_PROBE_PATH}. */
    probePath?: string;
  }) {
    this.routingStrategy = routingStrategy;
    this.logger = logger;
    this.probePath = probePath;
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

    /**
     * This strategy wraps another one, so it does not need a gateways provider
     * of its own: when it has no candidate list it defers to the wrapped
     * strategy, which supplies gateways from its own provider. Resolving to an
     * empty list here instead would make every wrapper built without a
     * redundant provider fail with "No gateways available".
     *
     * An explicitly empty `gateways` array still throws — the caller said
     * there are none, which is different from not having been told.
     */
    const resolvedGateways =
      gateways ??
      (this.gatewaysProvider
        ? await this.gatewaysProvider.getGateways()
        : undefined);

    if (resolvedGateways !== undefined && resolvedGateways.length === 0) {
      throw new Error('No gateways available');
    }

    const paramsWithGateways = resolvedGateways
      ? { ...params, gateways: resolvedGateways }
      : params;

    for (let i = 0; i < this.retries; i++) {
      let selectedGateway: URL | undefined = undefined;
      try {
        selectedGateway =
          await this.routingStrategy.selectGateway(paramsWithGateways);

        const pingUrl = buildProbeUrl({
          gateway: selectedGateway,
          probePath: this.probePath,
        });

        this.logger.debug('Performing HEAD check on selected gateway', {
          gateway: selectedGateway.toString(),
          pingUrl,
          attempt: i + 1,
          timeoutMs: this.timeoutMs,
        });

        const response = await fetch(pingUrl, {
          method: 'HEAD',
          signal: AbortSignal.timeout(this.timeoutMs),
        });

        if (!response.ok) {
          this.logger.debug('Failed to ping gateway', {
            gateway: selectedGateway.toString(),
            pingUrl,
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
        gateways: resolvedGateways?.map((g) => g.toString()),
        path,
        subdomain,
        retries: this.retries,
      },
    });
  }
}
