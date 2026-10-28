import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { buildApp } from "../src/app.js";
import { liveKitConnect, webClientCsp } from "../src/web-client.js";

const env = { LIVEKIT_URL: "wss://rtc.example.com" };
const html = '<!doctype html><html><head><script type="module" src="/assets/index-AbCd1234.js"></script></head><body><div id="root"></div></body></html>';

async function webRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "openmeet-web-root-"));
  await mkdir(path.join(root, "assets"));
  await writeFile(path.join(root, "index.html"), html);
  await writeFile(path.join(root, "assets", "index-AbCd1234.js"), "console.log(1)");
  await writeFile(path.join(root, "assets", "index-EfGh5678.css"), "body{}");
  await writeFile(path.join(root, "icon.svg"), "<svg/>");
  await mkdir(path.join(root, "media", "vision"), { recursive: true });
  await writeFile(path.join(root, "media", "vision", "vision_wasm_internal.wasm"), "\0asm");
  await writeFile(path.join(root, "media", "selfie_segmenter.tflite"), "model");
  return root;
}

test("the web CSP allows only self-hosted Wasm evaluation and the LiveKit domain", () => {
  assert.equal(
    webClientCsp(env),
    "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='; connect-src 'self' wss://rtc.example.com; media-src 'self' blob: mediastream:; img-src 'self' blob: data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  );
  assert.equal(webClientCsp({}).includes("connect-src 'self';"), true);
  assert.equal(liveKitConnect({ LIVEKIT_URL: "ws://rtc.example.com" }), undefined);
  assert.equal(liveKitConnect({ LIVEKIT_URL: "ws://127.0.0.1:7880" }), "ws://127.0.0.1:7880");
  assert.equal(liveKitConnect({ LIVEKIT_URL: "https://rtc.example.com" }), undefined);
  assert.equal(webClientCsp(env).split(/[ ;]/).includes("'unsafe-eval'"), false);
  assert.equal(webClientCsp(env).includes("'unsafe-inline'"), false);
});

test("index.html has the CSP and no cache; hashed assets cache for a year", async () => {
  const root = await webRoot();
  const app = await buildApp({ logger: false, env, webRoot: root });
  try {
    const page = await app.inject({ method: "GET", url: "/" });
    assert.equal(page.statusCode, 200);
    assert.equal(page.body, html);
    assert.match(String(page.headers["content-type"]), /^text\/html/);
    assert.equal(page.headers["cache-control"], "no-store");
    assert.equal(page.headers["content-security-policy"], webClientCsp(env));
    assert.equal(page.headers["x-content-type-options"], "nosniff");
    assert.equal(page.headers["x-frame-options"], "DENY");

    const script = await app.inject({ method: "GET", url: "/assets/index-AbCd1234.js" });
    assert.equal(script.statusCode, 200);
    assert.match(String(script.headers["content-type"]), /^text\/javascript/);
    assert.equal(script.headers["cache-control"], "public, max-age=31536000, immutable");
    assert.equal(script.headers["x-content-type-options"], "nosniff");
    const style = await app.inject({ method: "GET", url: "/assets/index-EfGh5678.css" });
    assert.equal(style.headers["cache-control"], "public, max-age=31536000, immutable");

    const icon = await app.inject({ method: "GET", url: "/icon.svg" });
    assert.equal(icon.statusCode, 200);
    assert.equal(icon.headers["cache-control"], "no-cache");

    // Background blur loads the MediaPipe Wasm and the model; without them it aborts on fetch.
    const wasm = await app.inject({ method: "GET", url: "/media/vision/vision_wasm_internal.wasm" });
    assert.equal(wasm.statusCode, 200);
    assert.equal(wasm.headers["content-type"], "application/wasm");
    const model = await app.inject({ method: "GET", url: "/media/selfie_segmenter.tflite" });
    assert.equal(model.statusCode, 200);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("an unknown page path opens the client, but /api and missing files stay 404", async () => {
  const root = await webRoot();
  const app = await buildApp({ logger: false, env, webRoot: root });
  try {
    const deep = await app.inject({ method: "GET", url: "/servidores/abc?x=1" });
    assert.equal(deep.statusCode, 200);
    assert.equal(deep.body, html);
    assert.equal(deep.headers["cache-control"], "no-store");

    const api = await app.inject({ method: "GET", url: "/api/v1/nada" });
    assert.equal(api.statusCode, 404);
    assert.deepEqual(api.json(), { message: "Route GET:/api/v1/nada not found", error: "Not Found", statusCode: 404 });
    assert.equal((await app.inject({ method: "GET", url: "/api" })).statusCode, 404);
    assert.equal((await app.inject({ method: "POST", url: "/qualquer" })).statusCode, 404);
    assert.equal((await app.inject({ method: "GET", url: "/assets/velho-12345678.js" })).statusCode, 404);
    assert.equal((await app.inject({ method: "GET", url: "/../package.json" })).statusCode, 404);
    assert.equal((await app.inject({ method: "GET", url: "/%2e%2e/package.json" })).statusCode, 404);

    // The API and the invite page keep their own answers.
    assert.equal((await app.inject({ method: "GET", url: "/health/live" })).statusCode, 200);
    const instance = await app.inject({ method: "GET", url: "/api/v1/instance" });
    assert.equal(instance.headers["content-security-policy"], undefined);
    const invite = await app.inject({ method: "GET", url: `/convite/${"a".repeat(43)}` });
    assert.match(String(invite.headers["content-security-policy"]), /default-src 'none'/);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("with the web client the invite page hands the code over in the fragment, never in the log", async () => {
  const root = await webRoot();
  const lines: string[] = [];
  const app = await buildApp({ env, webRoot: root, logStream: { write: (line: string) => lines.push(line) } });
  const code = "A".repeat(20) + "b_-" + "9".repeat(20);
  try {
    const page = await app.inject({ method: "GET", url: `/convite/${code}`, headers: { host: "meet.example" } });
    assert.equal(page.statusCode, 200);
    assert.equal(page.body.includes(`<a href="/#convite=${code}">Abrir no navegador</a>`), true);
    assert.equal(page.body.includes("openmeet://convite?host=meet.example"), true);
    // The client opens at / with the code after #, which the browser does not send.
    const opened = await app.inject({ method: "GET", url: "/" });
    assert.equal(opened.statusCode, 200);
    assert.ok(lines.length > 0);
    assert.equal(lines.join("").includes(code), false);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("without a built client the instance serves only the API", async () => {
  const app = await buildApp({ logger: false, env, webRoot: path.join(tmpdir(), "openmeet-no-web-here") });
  const code = "A".repeat(20) + "b_-" + "9".repeat(20);
  try {
    const root = await app.inject({ method: "GET", url: "/" });
    assert.equal(root.statusCode, 404);
    const invite = await app.inject({ method: "GET", url: `/convite/${code}`, headers: { host: "meet.example" } });
    assert.equal(invite.body.includes("Abrir no navegador"), false);
  } finally {
    await app.close();
  }
});
