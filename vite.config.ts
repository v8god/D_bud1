import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,

  resolve: {
    alias: {
      // pixi-live2d-display-advanced imports Node's `url` package in the browser bundle.
      // This points it to the browser polyfill from the installed `url` package.
      url: fileURLToPath(new URL("./node_modules/url/url.js", import.meta.url)),
    },
  },

  optimizeDeps: {
    include: [
      "pixi.js",
      "pixi-live2d-display-advanced",
      "pixi-live2d-display-advanced/cubism4",
    ],
  },

  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
});
