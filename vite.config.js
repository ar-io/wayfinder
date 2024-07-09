import { defineConfig } from "vite";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import { viteStaticCopy } from "vite-plugin-static-copy";
import { resolve } from "path";

export default defineConfig({
  plugins: [
    nodePolyfills({
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
    }),
    viteStaticCopy({
      targets: [
        {
          src: "src/popup.html",
          dest: ".",
        },

        {
          src: "manifest.json",
          dest: ".",
        },
        {
          src: "assets",
          dest: "",
        },
        {
          src: "package.json",
          dest: ".",
        },
      ],
    }),
  ],
  build: {
    sourcemap: true,
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        background: "./src/background.ts",
        content: "./src/content.ts",
        popup: "./src/popup.ts",
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "[name].js",
        assetFileNames: "[name].[ext]",
      },
    },
  },
  server: {
    port: 3000,
  },
});
