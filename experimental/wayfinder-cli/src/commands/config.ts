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
import { Command } from 'commander';
import type { ConfigCommandOptions } from '../types.js';
import { getConfigPath, readConfig, saveConfig } from '../utils/config.js';
import { handleError } from '../utils/errors.js';
import { createOutput } from '../utils/output.js';

const VALID_KEYS = [
  'routing',
  'verification',
  'gateway',
  'outputFormat',
  'verbose',
  'quiet',
  'progress',
] as const;

const VALID_VALUES: Record<string, string[]> = {
  routing: ['random', 'fastest', 'balanced', 'preferred'],
  verification: ['hash', 'data-root', 'signature', 'remote', 'disabled'],
  outputFormat: ['human', 'json'],
  verbose: ['true', 'false'],
  quiet: ['true', 'false'],
  progress: ['true', 'false'],
};

export const configCommand = new Command('config')
  .description('Manage wayfinder configuration')
  .option('-g, --global', 'Use global config instead of local')
  .addCommand(
    new Command('set')
      .description('Set a configuration value')
      .argument('<key>', 'Configuration key')
      .argument('<value>', 'Configuration value')
      .action(
        async (key: string, value: string, options: ConfigCommandOptions) => {
          try {
            await setConfig(key, value, options.global);
          } catch (error) {
            handleError(error);
          }
        },
      ),
  )
  .addCommand(
    new Command('get')
      .description('Get a configuration value')
      .argument('<key>', 'Configuration key')
      .action(async (key: string, options: ConfigCommandOptions) => {
        try {
          await getConfig(key, options.global);
        } catch (error) {
          handleError(error);
        }
      }),
  )
  .addCommand(
    new Command('list')
      .description('List all configuration values')
      .action(async (options: ConfigCommandOptions) => {
        try {
          await listConfig(options.global);
        } catch (error) {
          handleError(error);
        }
      }),
  )
  .addCommand(
    new Command('path')
      .description('Show configuration file path')
      .action(async (options: ConfigCommandOptions) => {
        try {
          const path = getConfigPath(options.global);
          console.log(path);
        } catch (error) {
          handleError(error);
        }
      }),
  );

async function setConfig(
  key: string,
  value: string,
  global?: boolean,
): Promise<void> {
  const output = createOutput();

  if (!VALID_KEYS.includes(key as any)) {
    throw new Error(
      `Invalid configuration key: ${key}\nValid keys: ${VALID_KEYS.join(', ')}`,
    );
  }

  if (VALID_VALUES[key] && !VALID_VALUES[key].includes(value)) {
    throw new Error(
      `Invalid value for ${key}: ${value}\nValid values: ${VALID_VALUES[key].join(', ')}`,
    );
  }

  const config = await readConfig(global);

  // Parse boolean values
  if (['verbose', 'quiet', 'progress'].includes(key)) {
    (config as any)[key] = value === 'true';
  } else {
    (config as any)[key] = value;
  }

  await saveConfig(config, global);
  output.success(`Set ${key} = ${value}`);
}

async function getConfig(key: string, global?: boolean): Promise<void> {
  const output = createOutput();

  if (!VALID_KEYS.includes(key as any)) {
    throw new Error(
      `Invalid configuration key: ${key}\nValid keys: ${VALID_KEYS.join(', ')}`,
    );
  }

  const config = await readConfig(global);
  const value = (config as any)[key];

  if (value !== undefined) {
    console.log(value);
  } else {
    output.info(`${key} is not set`);
  }
}

async function listConfig(global?: boolean): Promise<void> {
  const output = createOutput();
  const config = await readConfig(global);
  const configPath = getConfigPath(global);

  console.log(chalk.bold(`Configuration (${configPath}):`));
  console.log();

  if (Object.keys(config).length === 0) {
    output.info('No configuration values set');
    return;
  }

  for (const [key, value] of Object.entries(config)) {
    console.log(`  ${chalk.cyan(key)}: ${value}`);
  }
}
