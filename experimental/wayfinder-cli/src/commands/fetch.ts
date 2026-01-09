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

import { debug } from 'node:console';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  StaticGatewaysProvider,
  type Wayfinder,
  createRoutingStrategy,
  createVerificationStrategy,
  createWayfinderClient,
} from '@ar.io/wayfinder-core';
import { Command } from 'commander';
import fs from 'fs-extra';
import ora from 'ora';
import type { FetchCommandOptions, OutputMetadata } from '../types.js';
import { loadConfig, mergeConfigs } from '../utils/config.js';
import { handleError, validateArUrl } from '../utils/errors.js';
import { createOutput, formatMetadata } from '../utils/output.js';
import { createProgressTracker } from '../utils/progress.js';

export const fetchCommand = new Command('fetch')
  .description('Fetch data from ar:// URIs using Wayfinder')
  .argument('<uri>', 'The ar:// uri to fetch')
  .option('-o, --output <path>', 'Save to file instead of stdout')
  .option(
    '-r, --routing <strategy>',
    'Routing strategy (random, fastest, balanced, preferred)',
  )
  .option(
    '-v, --verify <strategy>',
    'Verification strategy (hash, data-root, signature, remote, disabled)',
  )
  .option('-g, --gateway <url>', 'Preferred gateway URL')
  .option('--progress', 'Show download progress', false)
  .option('--json', 'Output metadata as JSON', false)
  .option('--verbose', 'Enable verbose logging', false)
  .option('--quiet', 'Suppress all output except errors', false)
  .option('--timeout <ms>', 'Request timeout in milliseconds', '60000')
  .action(async (uri: string, options: FetchCommandOptions) => {
    try {
      validateArUrl(uri);

      // Get global options from parent command
      const globalOptions = fetchCommand.parent?.opts() || {};

      // Load and merge configs
      const fileConfig = loadConfig();
      const config = mergeConfigs(fileConfig, {
        routing: options.routing as any,
        verification: options.verify as any,
        gateway: options.gateway,
        verbose: options.verbose || globalOptions.verbose,
        quiet: options.quiet || globalOptions.quiet,
        progress: options.progress,
        json: options.json,
        timeout: options.timeout || 60_000,
      });

      // Create output logger with verbose/quiet settings
      const output = createOutput({
        verbose: config.verbose,
        quiet: config.quiet,
      });

      // Create wayfinder client
      const wayfinder = createWayfinder(config);

      output.verbose(`Using routing strategy: ${config.routing || 'default'}`);
      output.verbose(
        `Using verification: ${config.verification || 'disabled'}`,
      );
      if (config.gateway) {
        output.verbose(`Using preferred gateway: ${config.gateway}`);
      }

      // Show spinner only in verbose mode when outputting to stdout
      const spinner =
        !options.output && !config.quiet && config.verbose
          ? ora('Fetching data...\n').start()
          : null;
      const progressTracker = createProgressTracker(
        !!config.progress && !!options.output,
      );

      const startTime = Date.now();
      let totalBytes = 0;
      let txId: string;
      let contentLength: number | undefined;
      let contentType: string | undefined;
      let gateway: string | undefined;
      let verificationStatus: 'verified' | 'failed' | 'skipped' = 'skipped';

      try {
        // Make request
        const response = await wayfinder.request(uri);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        // Extract metadata
        gateway = response.headers.get('x-wayfinder-url') || undefined;
        contentType = response.headers.get('content-type') || undefined;
        txId = response.headers.get('x-ar-io-data-id') || 'unknown';
        const contentLengthHeader = response.headers.get('content-length');
        contentLength = contentLengthHeader
          ? parseInt(contentLengthHeader, 10)
          : undefined;

        const verificationHeader = response.headers.get('x-ar-io-verified');
        if (verificationHeader === 'true') {
          verificationStatus = 'verified';
        } else if (verificationHeader === 'false') {
          verificationStatus = 'failed';
        }

        output.verbose(`Response from gateway: ${response.status}`);
        if (contentType) {
          output.verbose(`Content-Type: ${contentType}`);
        }
        if (contentLength) {
          output.verbose(`Content-Length: ${contentLength} bytes`);
        }
        output.verbose(`Verification status: ${verificationStatus}`);

        if (contentLength && config.progress && options.output) {
          progressTracker.start(contentLength);
        }

        // Handle response body
        if (options.output) {
          spinner?.stop();

          // Stream to file
          await fs.ensureDir(path.dirname(options.output));
          const fileStream = fs.createWriteStream(options.output);

          const reader = response.body?.getReader();
          if (!reader) {
            throw new Error('Response body is not readable');
          }

          const stream = new Readable({
            async read() {
              const { done, value } = await reader.read();
              if (done) {
                this.push(null);
              } else {
                totalBytes += value.length;
                progressTracker.update(totalBytes);
                this.push(value);
              }
            },
          });

          await pipeline(stream, fileStream);
          progressTracker.stop();

          output.success(`Saved to ${options.output}`);
        } else {
          // Stream to stdout
          spinner?.stop();

          const buffer = await response.arrayBuffer();
          totalBytes = buffer.byteLength;

          output.verbose(`Received ${totalBytes} bytes\n`);

          if (!config.quiet && !options.json) {
            process.stdout.write(Buffer.from(buffer));
          }
        }
      } catch (error) {
        spinner?.fail();
        progressTracker.stop();
        throw error;
      }

      const duration = Date.now() - startTime;

      // Output metadata based on mode
      if (config.json && !config.quiet) {
        const metadata: OutputMetadata = {
          uri,
          txId,
          gateway: gateway || 'unknown',
          contentLength,
          contentType,
          verificationStatus,
          duration,
          bytesReceived: totalBytes,
        };
        console.log(formatMetadata(metadata, 'json'));
      } else if (config.verbose && !config.quiet) {
        const metadata: OutputMetadata = {
          uri,
          txId,
          gateway: gateway || 'unknown',
          contentLength,
          contentType,
          verificationStatus,
          duration,
          bytesReceived: totalBytes,
        };
        console.error(formatMetadata(metadata, 'human'));
      }
    } catch (error) {
      handleError(error);
    }
  });

function createWayfinder(config: any): Wayfinder {
  const options: any = {};

  // Configure logger - quiet by default, verbose when requested
  if (config.verbose) {
    // add warn and error to verbose logger
    options.logger = {
      debug: () => {
        /* no-op */
      },
      info: (msg: string) => {
        console.info(msg);
      },
      warn: (msg: string) => console.warn(msg),
      error: (msg: string) => console.error(msg),
    };
  } else {
    // Create silent logger for quiet operation
    options.logger = {
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
  }

  // Set up routing strategy
  if (config.routing) {
    const gatewaysProvider = config.gateway
      ? new StaticGatewaysProvider({ gateways: [config.gateway] })
      : undefined;

    options.routingSettings = {
      strategy: createRoutingStrategy({
        strategy: config.routing,
        gatewaysProvider,
        logger: options.logger,
      }),
    };
  } else if (config.gateway) {
    options.routingSettings = {
      strategy: createRoutingStrategy({
        strategy: 'random',
        gatewaysProvider: new StaticGatewaysProvider({
          gateways: [config.gateway],
        }),
        logger: options.logger,
      }),
    };
  }

  // Set up verification strategy
  if (config.verification && config.verification !== 'disabled') {
    options.verificationSettings = {
      enabled: true,
      strategy: createVerificationStrategy({
        strategy: config.verification,
        logger: options.logger,
      }),
      strict: true,
    };
  }

  return createWayfinderClient(options);
}
