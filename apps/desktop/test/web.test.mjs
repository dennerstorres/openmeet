import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { COOKIE_MARKER, createWebSession } from "../src/web/session.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const origin = "https://meet.example.com";

async function bundleText(mode) {
  const outDir = await mkdtemp(path.join(tmpdir(), "openmeet-web-"));
  try {
    await build({ root, mode, logLevel: "silent", build: { outDir, emptyOutDir: true } });
    const files = await readdir(outDir, { recursive: true });
    let text = "";
    for (const file of files) {
      if (/\.(js|html|css)$/.test(file)) text += await readFile(path.join(outDir, file), "utf8");
    }
    return text;
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
}

// ADR 0014: tray, shortcuts, native notification, vault, openmeet:// handling and the media proof stay out.
test("the web bundle has no native shell, no instance picker and no media proof", async () => {
  const text = await bundleText("web");
  assert.ok(text.length > 0);
  const absent = [
    "__TAURI",
    "session_login",
    "session_refresh",
    "session_logout",
    "instance_call",
    "shell_tracks",
    "shell_status",
    "shell_set_consent",
    "shell_set_autostart",
    "shell-action",
    "invite_take",
    "invite-link",
    "open_google_login",
    "atalhos globais",
    "Informe o endereço",
    "openmeet.instance",
    "PocApp",
    "Prova de mídia",
  ];
  for (const needle of absent) assert.equal(text.includes(needle), false, needle);
  assert.ok(text.includes("x-openmeet-web"));
});

// ADR 0027: only the web build is installable; the .exe carries no manifest.
test("the web build emits the PWA manifest and icons; the desktop build does not", async () => {
  for (const mode of ["web", "production"]) {
    const outDir = await mkdtemp(path.join(tmpdir(), "openmeet-pwa-"));
    try {
      await build({ root, mode, logLevel: "silent", build: { outDir, emptyOutDir: true } });
      const files = (await readdir(outDir, { recursive: true })).map((file) => file.split(path.sep).join("/"));
      const html = await readFile(path.join(outDir, "index.html"), "utf8");
      if (mode === "web") {
        const manifest = JSON.parse(await readFile(path.join(outDir, "manifest.webmanifest"), "utf8"));
        assert.equal(manifest.start_url, "/");
        assert.equal(manifest.display, "standalone");
        for (const icon of manifest.icons) assert.ok(files.includes(icon.src.slice(1)), icon.src);
        assert.ok(manifest.icons.some((icon) => icon.purpose === "maskable"));
        assert.match(html, /<link rel="manifest" href="\/manifest.webmanifest">/);
      } else {
        assert.equal(files.includes("manifest.webmanifest"), false);
        assert.equal(
          files.some((file) => file.startsWith("pwa/")),
          false,
        );
        assert.doesNotMatch(html, /manifest/);
      }
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  }
});

test("the desktop bundle keeps the native shell", async () => {
  const text = await bundleText("production");
  for (const needle of ["session_login", "instance_call", "shell_tracks", "invite_take", "Informe o endereço"]) {
    assert.ok(text.includes(needle), needle);
  }
  assert.equal(text.includes("x-openmeet-web"), false);
});

function fakeFetch(answers) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    const next = answers.shift() ?? { status: 500, body: null };
    return new Response(next.body === null ? "" : JSON.stringify(next.body), { status: next.status });
  };
  return { calls, impl };
}

const user = { id: "00000000-0000-4000-8000-000000000001", username: "ana", displayName: "Ana", role: "participant" };

test("the web broker sends the web header with the cookie and gives the model a marker", async () => {
  const net = fakeFetch([{ status: 200, body: { expiresIn: 900, user } }]);
  const { broker } = createWebSession(net.impl);
  const result = await broker.start(origin, "login", { username: "ana", password: "x" });
  assert.equal(result.status, 200);
  assert.equal(result.body.accessToken, COOKIE_MARKER);
  const [call] = net.calls;
  assert.equal(call.url, `${origin}/api/v1/auth/login`);
  assert.equal(call.init.credentials, "same-origin");
  assert.equal(call.init.headers["x-openmeet-web"], "1");
  assert.equal("authorization" in call.init.headers, false);
});

test("a body token from the server never reaches the model", async () => {
  const net = fakeFetch([{ status: 200, body: { accessToken: "real", refreshToken: "real-refresh", expiresIn: 900, user } }]);
  const { broker } = createWebSession(net.impl);
  const result = await broker.refresh(origin);
  assert.equal(JSON.stringify(result.body).includes("real"), false);
  assert.equal(net.calls[0].init.body, "{}");
});

test("a 401 refreshes once and repeats the call; parallel 401s share one refresh", async () => {
  const net = fakeFetch([
    { status: 401, body: { error: "unauthorized" } },
    { status: 401, body: { error: "unauthorized" } },
    { status: 200, body: { expiresIn: 900, user } },
    { status: 200, body: [] },
    { status: 200, body: [] },
  ]);
  const { api } = createWebSession(net.impl);
  const [first, second] = await Promise.all([
    api.request(origin, "GET", "/api/v1/servers", null, COOKIE_MARKER),
    api.request(origin, "GET", "/api/v1/servers", null, COOKIE_MARKER),
  ]);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(net.calls.filter((call) => call.url.endsWith("/api/v1/auth/refresh")).length, 1);
  for (const call of net.calls) assert.equal("authorization" in call.init.headers, false);
});

test("a failed refresh returns the original 401 and calls without a session are not retried", async () => {
  const net = fakeFetch([
    { status: 401, body: { error: "unauthorized" } },
    { status: 401, body: { error: "invalid_session" } },
    { status: 401, body: { error: "unauthorized" } },
  ]);
  const { api } = createWebSession(net.impl);
  const failed = await api.request(origin, "GET", "/api/v1/servers", null, COOKIE_MARKER);
  assert.deepEqual(failed, { status: 401, body: { error: "unauthorized" } });
  const open = await api.request(origin, "GET", "/api/v1/instance", null, null);
  assert.equal(open.status, 401);
  assert.equal(net.calls.length, 3);
});
