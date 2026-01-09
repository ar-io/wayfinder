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
import cliProgress from 'cli-progress';
import { formatBytes } from './output.js';

export function createProgressBar(): cliProgress.SingleBar {
  return new cliProgress.SingleBar({
    format: `${chalk.cyan('{bar}')} | {percentage}% | {value}/{total} | {speed}`,
    barCompleteChar: '\u2588',
    barIncompleteChar: '\u2591',
    hideCursor: true,
    formatValue: (v, _, type) => {
      switch (type) {
        case 'value':
        case 'total':
          return formatBytes(v);
        default:
          return v.toString();
      }
    },
    formatBar: (progress, options) => {
      const barSize = options.barsize || 40;
      const completeSize = Math.round(progress * barSize);
      const incompleteSize = barSize - completeSize;

      return (
        chalk.cyan(options.barCompleteString!.substring(0, completeSize)) +
        options.barIncompleteString!.substring(0, incompleteSize)
      );
    },
  });
}

export interface ProgressTracker {
  start(total: number): void;
  update(value: number, speed?: string): void;
  stop(): void;
}

export function createProgressTracker(showProgress: boolean): ProgressTracker {
  if (!showProgress) {
    return {
      start: () => {
        /* silent progress tracker */
      },
      update: () => {
        /* silent progress tracker */
      },
      stop: () => {
        /* silent progress tracker */
      },
    };
  }

  const bar = createProgressBar();
  let startTime: number;

  return {
    start(total: number) {
      startTime = Date.now();
      bar.start(total, 0, { speed: 'N/A' });
    },
    update(value: number) {
      const elapsed = (Date.now() - startTime) / 1000;
      const speed = elapsed > 0 ? formatBytes(value / elapsed) + '/s' : 'N/A';
      bar.update(value, { speed });
    },
    stop() {
      bar.stop();
    },
  };
}
