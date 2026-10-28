import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { AppEnv } from "./poc-join.js";

// ADR 0014: the instance serves the web client at its own origin. The files are read once at start into
// memory and served by exact path, so no request path ever reaches the file system.

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".txt": "text/plain; charset=utf-8",
  // Background blur (ADR 0016): the MediaPipe runtime and the segmentation model under media/.
  ".wasm": "application/wasm",
  ".tflite": "application/octet-stream",
};

const IMMUTABLE = "public, max-age=31536000, immutable";
// Vite names built assets `name-<hash>.ext` under assets/.
const HASHED = /^\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/;

interface WebFile {
  body: Buffer;
  type: string;
  cache: string;
}

/** The LiveKit origin the page may open: wss on a public host, ws only on loopback for development. */
export function liveKitConnect(env: AppEnv): string | undefined {
  try {
    const url = new URL(env.LIVEKIT_URL ?? "");
    const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost";
    if (url.protocol !== "wss:" && !(url.protocol === "ws:" && loopback)) return undefined;
    return `${url.protocol}//${url.host}`;
  } catch {
    return undefined;
  }
}

export function webClientCsp(env: AppEnv): string {
  const livekit = liveKitConnect(env);
  return [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self'",
    `connect-src 'self'${livekit ? ` ${livekit}` : ""}`,
    "media-src 'self' blob: mediastream:",
    "img-src 'self' blob: data:",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join("; ");
}

function loadFiles(root: string): Map<string, WebFile> {
  const files = new Map<string, WebFile>();
  for (const entry of readdirSync(root, { recursive: true })) {
    const relative = String(entry).split(path.sep).join("/");
    const full = path.join(root, relative);
    if (!statSync(full).isFile()) continue;
    const type = TYPES[path.extname(relative).toLowerCase()];
    if (type === undefined) continue;
    const route = `/${relative}`;
    files.set(route, { body: readFileSync(full), type, cache: HASHED.test(route) ? IMMUTABLE : "no-cache" });
  }
  return files;
}

/** Registers the web client when `root` holds a built index.html. Without it the API runs as before. */
export function registerWebClient(app: FastifyInstance, env: AppEnv, root: string | undefined): boolean {
  if (root === undefined || !existsSync(path.join(root, "index.html"))) return false;
  const files = loadFiles(root);
  const index = files.get("/index.html");
  if (index === undefined) return false;
  files.delete("/index.html");
  const headers = {
    "content-security-policy": webClientCsp(env),
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
  };
  const page = { ...index, cache: "no-store" };

  for (const [route, file] of files) {
    if (route.startsWith("/api/") || route.startsWith("/convite/") || route.startsWith("/health/")) continue;
    app.get(route, async (_request, reply) => reply.headers(headers).header("cache-control", file.cache).type(file.type).send(file.body));
  }
  app.get("/", async (_request, reply) => reply.headers(headers).header("cache-control", page.cache).type(page.type).send(page.body));

  // Any other page path opens the client. /api and /health keep the plain JSON 404 the client reads as an outdated API.
  app.setNotFoundHandler(async (request, reply) => {
    const pathname = request.url.split("?")[0] ?? "";
    const apiPath = pathname === "/api" || pathname.startsWith("/api/") || pathname.startsWith("/health/");
    if ((request.method === "GET" || request.method === "HEAD") && !apiPath && !path.extname(pathname)) {
      return reply.code(200).headers(headers).header("cache-control", page.cache).type(page.type).send(page.body);
    }
    return reply.code(404).send({ message: `Route ${request.method}:${pathname} not found`, error: "Not Found", statusCode: 404 });
  });
  return true;
}
