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

import { TrustedPeersGatewaysProvider } from '@ar.io/wayfinder-core';
import chalk from 'chalk';
import { Command } from 'commander';
import ora from 'ora';
import type { InfoCommandOptions } from '../types.js';
import { handleError } from '../utils/errors.js';
import { createOutput, formatDuration } from '../utils/output.js';

export const infoCommand = new Command('info')
  .description('Show information about available gateways')
  .option('--json', 'Output as JSON')
  .option('-l, --limit <number>', 'Limit number of gateways to display', '10')
  .option('--verbose', 'Enable verbose output')
  .action(async (options: InfoCommandOptions & { verbose?: boolean }) => {
    try {
      const output = createOutput({
        quiet: options.json,
        verbose: options.verbose,
      });
      const spinner = !options.json
        ? ora('Fetching gateway information...').start()
        : null;

      try {
        // Configure quiet logger for wayfinder-core
        const coreLogger = {
          debug: () => {
            /* silent */
          },
          info: () => {
            /* silent */
          },
          warn: () => {
            /* silent */
          },
          error: () => {
            /* silent */
          },
        };

        // Fetch gateways using trusted peers provider
        const gatewaysProvider = new TrustedPeersGatewaysProvider({
          trustedGateway: 'https://permagate.io',
          logger: coreLogger,
        });

        output.debug('Fetching gateway list from trusted peers...');
        const gateways = await gatewaysProvider.getGateways();
        const limitedGateways = gateways.slice(0, Number(options.limit) || 10);
        output.debug(
          `Found ${gateways.length} gateways, testing ${limitedGateways.length}...`,
        );

        if (spinner) {
          spinner.text = 'Testing gateway latencies...';
        }

        // Test ping times
        const gatewayPings = await testGatewayPings(limitedGateways, output);

        spinner?.stop();

        if (options.json) {
          console.log(
            JSON.stringify(
              {
                gateways: gatewayPings,
                total: gateways.length,
                displayed: gatewayPings.length,
              },
              null,
              2,
            ),
          );
        } else {
          displayGatewayInfo(gatewayPings, gateways.length, output);
        }
      } catch (error) {
        spinner?.fail();
        throw error;
      }
    } catch (error) {
      handleError(error);
    }
  });

async function testGatewayPings(
  gateways: any[],
  output: any,
): Promise<
  Array<{
    url: string;
    ping: number | null;
    status: 'online' | 'offline';
  }>
> {
  const results = await Promise.all(
    gateways.map(async (gateway) => {
      const gatewayUrl = gateway.url || gateway;

      try {
        const start = Date.now();
        output.debug(`Testing gateway: ${gatewayUrl.toString()}`);

        // Create abort controller for timeout (Node 16 compatible)
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        try {
          const response = await fetch(gatewayUrl.toString() + '/ar-io/info', {
            method: 'HEAD',
            signal: controller.signal,
          });

          clearTimeout(timeoutId);

          if (response.ok || response.status === 404) {
            const ping = Date.now() - start;
            output.debug(
              `Gateway ${gatewayUrl.toString()} responded in ${ping}ms`,
            );
            return {
              url: gatewayUrl.toString(),
              ping,
              status: 'online' as const,
            };
          }
        } catch (fetchError) {
          clearTimeout(timeoutId);
          throw fetchError;
        }
      } catch (error) {
        output.debug(
          `Gateway ${gatewayUrl.toString()} failed: ${(error as Error).message}`,
        );
      }

      return {
        url: gatewayUrl.toString(),
        ping: null,
        status: 'offline' as const,
      };
    }),
  );

  // Sort by ping time (offline gateways at the end)
  return results.sort((a, b) => {
    if (a.ping === null) return 1;
    if (b.ping === null) return -1;
    return a.ping - b.ping;
  });
}

function displayGatewayInfo(
  gateways: Array<{
    url: string;
    ping: number | null;
    status: 'online' | 'offline';
  }>,
  totalCount: number,
  output: any,
): void {
  console.log(chalk.bold('\nAvailable Gateways:\n'));

  for (const gateway of gateways) {
    const status =
      gateway.status === 'online' ? chalk.green('●') : chalk.red('●');

    const ping =
      gateway.ping !== null
        ? chalk.gray(`${formatDuration(gateway.ping)}`)
        : chalk.gray('offline');

    console.log(`  ${status} ${gateway.url} ${ping}`);
  }

  console.log();
  output.info(`Showing ${gateways.length} of ${totalCount} available gateways`);

  const onlineCount = gateways.filter((g) => g.status === 'online').length;
  if (onlineCount > 0) {
    const fastestGateway = gateways.find((g) => g.status === 'online');
    if (fastestGateway) {
      console.log();
      output.success(
        `Fastest gateway: ${fastestGateway.url} (${formatDuration(fastestGateway.ping!)})`,
      );
    }
  }
}
