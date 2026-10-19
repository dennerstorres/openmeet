import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("desktop package is the private OpenMeet shell", () => {
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(manifest.name, "@openmeet/desktop");
  assert.equal(manifest.private, true);
});

test("Tauri identifier matches the instance-local desktop app", () => {
  const config = JSON.parse(readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
  assert.equal(config.identifier, "com.openmeet.desktop");
  assert.equal(config.productName, "OpenMeet");
  assert.equal(config.build.devUrl, "http://localhost:1420");
  const connect = config.app.security.csp["connect-src"];
  assert.match(connect, /\bhttps:/);
  assert.match(connect, /\bwss:/);
  assert.equal(connect.includes("dennerstorres"), false);
});

test("the main window gets only the core calls the page makes (S-14)", () => {
  const capability = JSON.parse(readFileSync(new URL("../src-tauri/capabilities/default.json", import.meta.url), "utf8"));
  assert.deepEqual(capability.windows, ["main"]);
  assert.equal(capability.permissions.includes("core:default"), false);
  assert.equal(
    capability.permissions.some((permission) => permission.includes("allow-internal-toggle-devtools")),
    false,
  );
  assert.equal(capability.permissions.includes("core:webview:deny-internal-toggle-devtools"), true);
  assert.equal(capability.permissions.includes("core:event:allow-listen"), true);
  assert.equal(
    capability.permissions.some((permission) => permission.startsWith("core:event:allow-emit")),
    false,
  );
  assert.equal("remote" in capability, false);
});

test("the release CSP has base-uri none and no inline style (S-15)", () => {
  const security = JSON.parse(readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8")).app.security;
  assert.equal(security.csp["base-uri"], "'none'");
  assert.equal(security.csp["style-src"].includes("unsafe-inline"), false);
  // Only `tauri dev` serves CSS through Vite style tags.
  assert.equal(security.devCsp["base-uri"], "'none'");
  assert.equal(security.devCsp["connect-src"], security.csp["connect-src"]);
});
