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
import { RoutingStrategy } from '../../types/wayfinder.js';
import { Logger, defaultLogger } from '../wayfinder.js';

export class FastestPingRoutingStrategy implements RoutingStrategy {
  private timeoutMs: number;
  private probePath: string;
  private logger: Logger;

  constructor({
    timeoutMs = 500,
    probePath = '/ar-io/info', // TODO: limit to allowed /ar-io and arweave node endpoints
    logger = defaultLogger,
  }: {
    timeoutMs?: number;
    probePath?: string;
    logger?: Logger;
  } = {}) {
    this.timeoutMs = timeoutMs;
    this.probePath = probePath;
    this.logger = logger;
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

    try {
      const results = await Promise.allSettled(
        gateways.map(async (gateway) => {
          try {
            const startTime = Date.now();
            const pingUrl = `${gateway.toString().replace(/\/$/, '')}${this.probePath}`;

            this.logger.debug(`Pinging gateway ${gateway.toString()}`, {
              gateway: gateway.toString(),
              pingUrl,
            });

            const response = await fetch(pingUrl, {
              method: 'HEAD',
              signal: AbortSignal.timeout(this.timeoutMs),
            });

            const endTime = Date.now();
            const durationMs = endTime - startTime;

            this.logger.debug(
              `Received response from gateway ${gateway.toString()}`,
              {
                gateway: gateway.toString(),
                status: response.status,
                durationMs,
              },
            );

            return {
              gateway,
              status: response.status,
              durationMs,
              error: null,
            };
          } catch (error) {
            // Handle network errors
            this.logger.debug(`Failed to ping gateway ${gateway.toString()}`, {
              gateway: gateway.toString(),
              error,
            });

            return {
              gateway,
              status: 'rejected',
              durationMs: Infinity,
              error,
            };
          }
        }),
      );

      // Process results
      const processedResults = results.map((result, index) => {
        if (result.status === 'fulfilled') {
          return result.value;
        } else {
          return {
            gateway: gateways[index],
            status: 'rejected',
            durationMs: Infinity,
            error: result.reason,
          };
        }
      });

      // Filter healthy gateways and sort by latency
      const healthyGateways = processedResults
        .filter((result) => result.status === 200)
        .sort((a, b) => a.durationMs - b.durationMs);

      this.logger.debug(`Found ${healthyGateways.length} healthy gateways`, {
        healthyGateways: healthyGateways.map((g) => ({
          gateway: g.gateway.toString(),
          durationMs: g.durationMs,
        })),
      });

      if (healthyGateways.length > 0) {
        const selectedGateway = healthyGateways[0].gateway;

        this.logger.info(
          `Selected fastest gateway: ${selectedGateway.toString()}`,
          {
            gateway: selectedGateway.toString(),
            durationMs: healthyGateways[0].durationMs,
          },
        );

        return selectedGateway;
      }

      const noHealthyGatewaysError = new Error('No healthy gateways found');
      this.logger.error('Failed to select gateway', {
        error: noHealthyGatewaysError.message,
        results: processedResults.map((r) => ({
          gateway: r.gateway.toString(),
          status: r.status,
          error: r.error,
        })),
      });

      throw noHealthyGatewaysError;
    } catch (error) {
      const errorMessage =
        'Failed to ping gateways: ' +
        (error instanceof Error ? error.message : String(error));

      this.logger.error('Failed to select gateway', { error: errorMessage });

      throw new Error(errorMessage);
    }
  }
}
