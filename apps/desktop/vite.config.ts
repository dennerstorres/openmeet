import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { griffel } from "@griffel/vite-plugin";
import process from "node:process";
import { fileURLToPath } from "node:url";
const host = process.env.TAURI_DEV_HOST;

// ADR 0014: `vite build --mode web` swaps the native shell module for the browser one, so no Tauri
// command, tray or vault code reaches the web bundle.
function webShell(): Plugin {
  const replacement = fileURLToPath(new URL("./src/web/native.ts", import.meta.url));
  return {
    name: "openmeet-web-shell",
    enforce: "pre",
    resolveId(source) {
      return /(^|\/)shell\/native(\.ts)?$/.test(source) ? replacement : null;
    },
  };
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  // ADR 0026: Griffel extracts our own makeStyles at build time; Fluent's precompiled styles still load at runtime.
  plugins: mode === "web" ? [webShell(), react(), griffel()] : [react(), griffel()],
  define: { __WEB__: JSON.stringify(mode === "web") },
  build: mode === "web" ? { outDir: "dist-web" } : process.env.FLUENT_POC ? { rollupOptions: { input: { poc: "fluent-poc.html" } }, outDir: "dist-poc" } : {},
  // POC only: serve the build with the production CSP from tauri.conf.json.
  preview: process.env.FLUENT_POC ? { headers: { "Content-Security-Policy": "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='; img-src 'self' blob: data:; base-uri 'none'" } } : undefined,

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
    // The web target in dev talks to the API through this proxy, so the page and /api share one origin.
    proxy: mode === "web" ? { "/api": { target: process.env.OPENMEET_API ?? "http://127.0.0.1:3000", changeOrigin: false } } : undefined,
  },
}));
