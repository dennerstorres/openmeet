import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { buildManifest, writeManifest } from "./updater-manifest.mjs";

const base = {
  version: "0.3.0",
  notes: "OpenMeet 0.3.0",
  pubDate: "2026-10-24T00:00:00.000Z",
  repository: "owner/openmeet",
  installer: "OpenMeet_0.3.0_x64-setup.exe",
  signature: "c2ln\n",
};

test("manifest points at the tagged installer with its signature", () => {
  const manifest = buildManifest(base);
  assert.equal(manifest.version, "0.3.0");
  assert.deepEqual(manifest.platforms["windows-x86_64"], {
    signature: "c2ln",
    url: "https://github.com/owner/openmeet/releases/download/v0.3.0/OpenMeet_0.3.0_x64-setup.exe",
  });
});

test("manifest refuses unsafe names, versions and signatures", () => {
  assert.throws(() => buildManifest({ ...base, version: "v0.3" }), /x\.y\.z/);
  assert.throws(() => buildManifest({ ...base, repository: "owner/x/../y" }), /owner\/name/);
  assert.throws(() => buildManifest({ ...base, installer: "../OpenMeet-setup.exe" }), /setup executable/);
  assert.throws(() => buildManifest({ ...base, signature: "  " }), /signature/);
  assert.throws(() => buildManifest({ ...base, signature: "a b" }), /signature/);
});

test("manifest file needs the installer signature next to it", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "openmeet-updater-"));
  try {
    await writeFile(path.join(directory, base.installer), "exe");
    await assert.rejects(writeManifest(directory, base), /signature missing/);
    await writeFile(path.join(directory, `${base.installer}.sig`), "c2ln\n");
    await writeManifest(directory, base);
    const written = JSON.parse(await readFile(path.join(directory, "latest.json"), "utf8"));
    assert.equal(written.platforms["windows-x86_64"].signature, "c2ln");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
