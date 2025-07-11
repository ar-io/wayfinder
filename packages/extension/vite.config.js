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
import { defineConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { viteStaticCopy } from 'vite-plugin-static-copy';

export default defineConfig({
  plugins: [
    nodePolyfills({
      include: ['crypto', 'stream', 'util', 'buffer'],
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
      protocolImports: true,
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
          webIndex: [
            '@ar.io/sdk/web',
            '@permaweb/aoconnect',
            '@ar.io/wayfinder-core',
          ],
        },
      },
    },
  },
  server: {
    port: 3000,
  },
});
