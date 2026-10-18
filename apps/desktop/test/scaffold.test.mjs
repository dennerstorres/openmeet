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
});
