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

/**
 * Packs the package, installs the tarball into a throwaway project, and
 * imports it.
 *
 * The monorepo cannot catch this class of bug on its own: a dependency that a
 * transitive package imports but never declares still resolves in-repo,
 * because some *other* workspace hoisted it into the root `node_modules`. A
 * consumer running `npm i @ar.io/wayfinder-core` gets no such luck and the
 * import fails outright. This ran green while `import '@ar.io/wayfinder-core'`
 * was completely broken for every Node ESM consumer, which is exactly the gap
 * this script closes.
 *
 * Run with: npm run test:package -w @ar.io/wayfinder-core
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const { name } = JSON.parse(
  readFileSync(join(packageRoot, 'package.json'), 'utf8'),
);

/** Exports a consumer must be able to reach from the package entry point. */
const REQUIRED_EXPORTS = [
  'Wayfinder',
  'createWayfinderClient',
  'NetworkGatewaysProvider',
  'TrustedPeersGatewaysProvider',
  'RandomRoutingStrategy',
  'HashVerificationStrategy',
  'SignatureVerificationStrategy',
  'ContiguousDataRetrievalStrategy',
];

const run = (command, args, cwd) =>
  execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  });

const workdir = mkdtempSync(join(tmpdir(), 'wayfinder-pkg-'));

try {
  console.log(`Packing ${name}...`);
  const tarball = join(
    workdir,
    run('npm', ['pack', '--silent', '--pack-destination', workdir], packageRoot)
      .trim()
      .split('\n')
      .pop(),
  );

  // A bare ESM project with no other dependencies — nothing to hoist anything
  // the package failed to declare.
  writeFileSync(
    join(workdir, 'package.json'),
    JSON.stringify(
      { name: 'wayfinder-package-check', private: true, type: 'module' },
      null,
      2,
    ),
  );

  console.log('Installing the tarball into a clean project...');
  run('npm', ['install', tarball, '--no-audit', '--no-fund'], workdir);

  console.log('Importing the installed package...');
  const probe = join(workdir, 'probe.mjs');
  writeFileSync(
    probe,
    `import * as pkg from '${name}';\n` +
      `const required = ${JSON.stringify(REQUIRED_EXPORTS)};\n` +
      'const missing = required.filter((key) => !(key in pkg));\n' +
      'if (missing.length) {\n' +
      "  console.error('Missing exports: ' + missing.join(', '));\n" +
      '  process.exit(1);\n' +
      '}\n' +
      "console.log('ok: ' + Object.keys(pkg).length + ' exports');\n",
  );

  console.log(run('node', [probe], workdir).trim());
  console.log(`\n${name} installs and imports cleanly.`);
} catch (error) {
  console.error(`\n${name} failed the packaged-install check.\n`);
  if (error.stdout) console.error(error.stdout);
  if (error.stderr) console.error(error.stderr);
  process.exitCode = 1;
} finally {
  rmSync(workdir, { recursive: true, force: true });
}
