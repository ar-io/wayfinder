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

import chalk from 'chalk';
import type { OutputMetadata } from '../types.js';

interface OutputOptions {
  verbose?: boolean;
  quiet?: boolean;
}

export const createOutput = (options: OutputOptions = {}) => ({
  success: (message: string) => {
    if (!options.quiet) {
      console.log(chalk.green('✓'), message);
    }
  },
  error: (message: string) => console.error(chalk.red('✖'), message),
  info: (message: string) => {
    if (!options.quiet) {
      console.log(chalk.blue('ℹ'), message);
    }
  },
  warn: (message: string) => {
    if (!options.quiet) {
      console.log(chalk.yellow('⚠'), message);
    }
  },
  debug: (message: string) => {
    if (options.verbose && !options.quiet) {
      console.log(chalk.gray('⚙'), message);
    }
  },
  verbose: (message: string) => {
    if (options.verbose && !options.quiet) {
      console.log(chalk.dim(message));
    }
  },
});

// Default output for backwards compatibility
export const output = createOutput();

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export function formatMetadata(
  metadata: OutputMetadata,
  format: 'human' | 'json',
): string {
  if (format === 'json') {
    return JSON.stringify(metadata, null, 2);
  }

  const lines = [
    chalk.bold('Fetch Summary:'),
    `  URI: ${metadata.uri}`,
    `. TxId: ${metadata.txId}`,
    `  Gateway: ${metadata.gateway}`,
    `  Size: ${formatBytes(metadata.bytesReceived)}`,
    `  Duration: ${formatDuration(metadata.duration)}`,
  ];

  if (metadata.contentType) {
    lines.push(`  Content-Type: ${metadata.contentType}`);
  }

  if (metadata.verificationStatus) {
    const status =
      metadata.verificationStatus === 'verified'
        ? chalk.green('verified')
        : metadata.verificationStatus === 'failed'
          ? chalk.red('failed')
          : chalk.gray('skipped');
    lines.push(`  Verification: ${status}`);
  }

  return lines.join('\n');
}
