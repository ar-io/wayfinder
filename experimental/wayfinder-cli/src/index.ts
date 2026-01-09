#!/usr/bin/env node
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

import { program } from 'commander';
import { configCommand } from './commands/config.js';
import { fetchCommand } from './commands/fetch.js';
import { infoCommand } from './commands/info.js';
import { version } from './version.js';

program
  .name('wayfinder')
  .description(
    'Fast and user-friendly CLI for fetching files via AR.IO Wayfinder',
  )
  .version(version)
  .option('--verbose', 'Enable verbose output for all commands')
  .option('--quiet', 'Suppress all output except errors')
  .helpCommand('help', 'Display help for command');

// Add commands
program.addCommand(fetchCommand);
program.addCommand(configCommand);
program.addCommand(infoCommand);

// Parse command line arguments
program.parse(process.argv);

// Show help if no command provided
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
