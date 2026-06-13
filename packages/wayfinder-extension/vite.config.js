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
import { createRequire } from 'node:module';
import path from 'node:path';
import { defineConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { viteStaticCopy } from 'vite-plugin-static-copy';

// The monorepo's experimental/wayfinder-x402-fetch package can install
// older @solana/* v5 sub-packages alongside the v6 ones that @ar.io/sdk
// and @solana/kit need.  When the package manager hoists conflicting
// versions, Vite/Rollup may resolve the wrong copy and fail with missing
// export errors.
//
// Fix: alias the critical @solana/* packages to the copies that
// @solana/kit itself resolves — this works regardless of how the
// package manager hoists (npm flat, yarn nested, etc.).
// Resolve each @solana/* package from @solana/kit's perspective so we
// get the version kit was built against, not a stale hoisted copy.
// Uses createRequire anchored to kit's main entry to follow Node's
// resolution algorithm regardless of hoisting layout (npm vs yarn).
const require = createRequire(import.meta.url);
const kitRequire = createRequire(require.resolve('@solana/kit'));

const solanaPackages = [
  'errors',
  'transactions',
  'transaction-messages',
  'codecs-core',
  'codecs-data-structures',
  'codecs-numbers',
  'codecs-strings',
  'rpc-types',
  'addresses',
  'keys',
  'signers',
  'instructions',
  'accounts',
  'promises',
];

function resolveSolanaPackageDir(pkgName) {
  // Resolve the package's main entry from kit's location, then walk
  // back to the package root (works even when ./package.json isn't
  // exported).
  const entry = kitRequire.resolve(pkgName);
  const needle = `${path.sep}${pkgName.replace('/', path.sep)}${path.sep}`;
  const idx = entry.lastIndexOf(needle);
  if (idx === -1) return null;
  return entry.substring(0, idx + needle.length - 1);
}

const solanaAliases = Object.fromEntries(
  solanaPackages
    .map((p) => {
      const pkgName = `@solana/${p}`;
      const dir = resolveSolanaPackageDir(pkgName);
      return dir ? [pkgName, dir] : null;
    })
    .filter(Boolean),
);

export default defineConfig({
  resolve: {
    alias: solanaAliases,
  },
  plugins: [
    nodePolyfills({
      include: ['crypto', 'stream'],
      protocolImports: true,
      global: {
        process: true,
        buffer: true,
      },
    }),
    viteStaticCopy({
      targets: [
        {
          src: 'src/popup.html',
          dest: '.',
        },
        {
          src: 'src/settings.html',
          dest: '.',
        },
        {
          src: 'src/gateways.html',
          dest: '.',
        },
        {
          src: 'src/performance.html',
          dest: '.',
        },
        {
          src: 'manifest.json',
          dest: '.',
        },
        {
          src: 'assets',
          dest: '',
        },
        {
          src: 'package.json',
          dest: '.',
        },
      ],
    }),
  ],
  build: {
    sourcemap: true,
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        background: './src/background.ts',
        content: './src/content.ts',
        popup: './src/popup.ts',
        settings: './src/settings.ts',
        gateways: './src/gateways.ts',
        performance: './src/performance.ts',
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name].js',
        assetFileNames: '[name].[ext]',
        // Manual chunks configuration
        manualChunks: {
          // Group SDK and large dependencies together
          webIndex: ['@ar.io/sdk/web', '@solana/kit', '@ar.io/wayfinder-core'],
        },
      },
    },
  },
  server: {
    port: 3000,
  },
});
