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
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { viteStaticCopy } from 'vite-plugin-static-copy';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nm = path.resolve(__dirname, '../../node_modules');

// The monorepo's experimental/wayfinder-x402-fetch package depends on
// @solana/kit v2 era packages, which install v5 @solana/* sub-packages
// at the root node_modules.  @ar.io/sdk and this extension need v6.
// Vite's `resolve.dedupe` can't help because it deduplicates to the
// root copy (v5).  Instead, alias every @solana/* package to its v6
// copy — either at root (if already v6) or under @solana/kit/node_modules.
const kitNm = path.join(nm, '@solana/kit/node_modules');

// Packages where root is v5 but we need the v6 copy from @solana/kit:
const fromKit = [
  'transactions',
  'transaction-messages',
  'codecs-strings',
  'nominal-types',
];

// Packages already v6 at root — alias to root to prevent nested v5
// copies under @solana/instruction-plans from being used:
const fromRoot = [
  'errors',
  'codecs-core',
  'codecs-data-structures',
  'codecs-numbers',
  'rpc-types',
  'addresses',
  'keys',
  'signers',
  'instructions',
  'accounts',
  'promises',
];

const solanaAliases = Object.fromEntries([
  ...fromKit.map((p) => [`@solana/${p}`, path.join(kitNm, `@solana/${p}`)]),
  ...fromRoot.map((p) => [`@solana/${p}`, path.join(nm, `@solana/${p}`)]),
]);

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
