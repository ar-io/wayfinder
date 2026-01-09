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
import { output } from './output.js';

export class CliError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly suggestion?: string,
  ) {
    super(message);
    this.name = 'CliError';
  }
}

export function handleError(error: unknown): never {
  if (error instanceof CliError) {
    output.error(error.message);
    if (error.suggestion) {
      console.log(chalk.dim(`  ${error.suggestion}`));
    }
    process.exit(1);
  }

  if (error instanceof Error) {
    if (error.message.includes('ENOENT')) {
      output.error('File or directory not found');
      console.log(
        chalk.dim(
          '  Check that the path exists and you have permission to access it',
        ),
      );
    } else if (error.message.includes('EACCES')) {
      output.error('Permission denied');
      console.log(chalk.dim('  Check that you have the necessary permissions'));
    } else if (error.message.includes('ENOSPC')) {
      output.error('No space left on device');
      console.log(chalk.dim('  Free up some disk space and try again'));
    } else {
      output.error(error.message);
    }

    if (process.env.DEBUG) {
      console.error(chalk.gray(error.stack));
    }
  } else {
    output.error('An unknown error occurred');
    console.error(error);
  }

  process.exit(1);
}

export function validateArUrl(url: string): void {
  if (!url.startsWith('ar://')) {
    throw new CliError(
      'Invalid URL format',
      'INVALID_URL',
      'URLs must start with ar:// (e.g., ar://example-name)',
    );
  }
}
