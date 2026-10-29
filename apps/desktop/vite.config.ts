import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { griffel } from "@griffel/vite-plugin";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
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

// ADR 0027: only the web build is an installable PWA. The manifest and its icons are emitted here, not from
// public/, so the .exe bundle never carries them.
const WEB_MANIFEST = {
  name: "OpenMeet",
  short_name: "OpenMeet",
  id: "/",
  start_url: "/",
  scope: "/",
  display: "standalone",
  background_color: "#1e1f22",
  theme_color: "#16a34a",
  lang: "pt-BR",
  icons: [
    { src: "/pwa/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/pwa/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "/pwa/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
};

function webManifest(): Plugin {
  const icons = ["icon-192.png", "icon-512.png", "icon-maskable-512.png"];
  return {
    name: "openmeet-web-manifest",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = request.url?.split("?")[0];
        if (url === "/manifest.webmanifest") {
          response.setHeader("content-type", "application/manifest+json");
          return response.end(JSON.stringify(WEB_MANIFEST));
        }
        const icon = url?.startsWith("/pwa/") ? url.slice(5) : undefined;
        if (icon !== undefined && icons.includes(icon)) {
          response.setHeader("content-type", "image/png");
          return response.end(readFileSync(fileURLToPath(new URL(`./pwa/${icon}`, import.meta.url))));
        }
        next();
      });
    },
    generateBundle(_options, bundle) {
      // ADR 0027: the worker carries an id of this build, so each deploy installs a new worker and cache.
      const build = createHash("sha256").update(Object.keys(bundle).sort().join(",")).digest("hex").slice(0, 16);
      const worker = readFileSync(fileURLToPath(new URL("./pwa/sw.js", import.meta.url)), "utf8").replace("__OPENMEET_BUILD__", build);
      this.emitFile({ type: "asset", fileName: "sw.js", source: worker });
      this.emitFile({ type: "asset", fileName: "manifest.webmanifest", source: JSON.stringify(WEB_MANIFEST) });
      for (const icon of icons) {
        this.emitFile({ type: "asset", fileName: `pwa/${icon}`, source: readFileSync(fileURLToPath(new URL(`./pwa/${icon}`, import.meta.url))) });
      }
    },
    transformIndexHtml() {
      return [
        { tag: "link", attrs: { rel: "manifest", href: "/manifest.webmanifest" }, injectTo: "head" },
        { tag: "link", attrs: { rel: "apple-touch-icon", href: "/pwa/icon-192.png" }, injectTo: "head" },
        { tag: "meta", attrs: { name: "theme-color", content: WEB_MANIFEST.theme_color }, injectTo: "head" },
      ];
    },
  };
}

const appVersion = (JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string }).version;

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  // ADR 0026: Griffel extracts our own makeStyles at build time; Fluent's precompiled styles still load at runtime.
  plugins: mode === "web" ? [webShell(), webManifest(), react(), griffel()] : [react(), griffel()],
  define: { __WEB__: JSON.stringify(mode === "web"), __APP_VERSION__: JSON.stringify(appVersion) },
  build: mode === "web" ? { outDir: "dist-web" } : {},

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
