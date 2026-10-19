import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { checksumLine, writeChecksums } from "./installer-checksum.mjs";

test("checksum line accepts only a setup executable and sha256", () => {
  assert.equal(checksumLine("OpenMeet_0.1.0_x64-setup.exe", "a".repeat(64)), `${"a".repeat(64)}  OpenMeet_0.1.0_x64-setup.exe`);
  assert.throws(() => checksumLine("../OpenMeet-setup.exe", "a".repeat(64)), /setup executable/);
  assert.throws(() => checksumLine("OpenMeet-setup.exe", "ABC"), /sha256/);
});

test("checksum file matches the installer bytes", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "openmeet-installer-"));
  try {
    await writeFile(path.join(directory, "OpenMeet_0.1.0_x64-setup.exe"), "abc");
    await writeFile(path.join(directory, "notes.txt"), "ignore");
    const text = await writeChecksums(directory);
    assert.equal(text, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad  OpenMeet_0.1.0_x64-setup.exe\n");
    assert.equal(await readFile(path.join(directory, "SHA256SUMS"), "utf8"), text);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("release workflow pins actions and publishes only a tag", async () => {
  const workflow = await readFile(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
  const ci = await readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  const config = await readFile(new URL("../apps/desktop/src-tauri/tauri.conf.json", import.meta.url), "utf8");
  for (const file of [workflow, ci]) {
    assert.equal(file.includes("actions/checkout@v"), false);
    assert.equal(file.includes("actions/setup-node@v"), false);
  }
  assert.match(workflow, /3d3c42e5aac5ba805825da76410c181273ba90b1/);
  assert.match(workflow, /949feb2413d6458794dcd2491c4babbbce0c15c1/);
  assert.match(workflow, /cf430e030ddbb5b0abf93d22962f4752f3646cd9/);
  assert.match(workflow, /9000827ccba6bdab643e8b6fd33ac0654aef8333/);
  assert.match(workflow, /github.ref_type == 'tag'/);
  assert.match(config, /"targets": \["nsis"\]/);
  assert.equal(config.includes("dennerstorres"), false);
});
