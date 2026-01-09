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

import os from 'node:os';
import path from 'node:path';
import { cosmiconfigSync } from 'cosmiconfig';
import fs from 'fs-extra';
import type { CliConfig } from '../types.js';

const MODULE_NAME = 'wayfinder';
const CONFIG_FILE_NAME = '.wayfinderrc';

export function loadConfig(): CliConfig {
  const explorer = cosmiconfigSync(MODULE_NAME, {
    searchPlaces: [
      'package.json',
      `.${MODULE_NAME}rc`,
      `.${MODULE_NAME}rc.json`,
      `.${MODULE_NAME}rc.js`,
      `${MODULE_NAME}.config.js`,
    ],
  });

  const result = explorer.search();
  return result?.config || {};
}

export function getConfigPath(global: boolean = false): string {
  if (global) {
    return path.join(os.homedir(), CONFIG_FILE_NAME);
  }
  return path.join(process.cwd(), CONFIG_FILE_NAME);
}

export async function saveConfig(
  config: CliConfig,
  global: boolean = false,
): Promise<void> {
  const configPath = getConfigPath(global);
  await fs.writeJson(configPath, config, { spaces: 2 });
}

export async function readConfig(global: boolean = false): Promise<CliConfig> {
  const configPath = getConfigPath(global);

  try {
    return await fs.readJson(configPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {};
    }
    throw error;
  }
}

export function mergeConfigs(...configs: Partial<CliConfig>[]): CliConfig {
  return configs.reduce(
    (merged, config) => ({
      ...merged,
      ...config,
    }),
    {} as CliConfig,
  );
}
