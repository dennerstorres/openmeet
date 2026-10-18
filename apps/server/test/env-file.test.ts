import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("server scripts load the repo .env and keep variables already set", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { scripts: { dev: string; start: string } };
  assert.match(pkg.scripts.dev, /--env-file-if-exists=\.\.\/\.\.\/\.env/);
  assert.match(pkg.scripts.start, /--env-file-if-exists=\.\.\/\.\.\/\.env/);

  const dir = mkdtempSync(join(tmpdir(), "openmeet-env-"));
  const file = join(dir, ".env");
  writeFileSync(file, "POC_JOIN=1\nFROM_FILE=file\n");
  try {
    const loaded = spawnSync(process.execPath, ["--env-file-if-exists=" + file, "-e", "process.stdout.write((process.env.POC_JOIN ?? '') + '|' + (process.env.FROM_FILE ?? ''))"], {
      encoding: "utf8",
    });
    assert.equal(loaded.status, 0);
    assert.equal(loaded.stdout, "1|file");

    const kept = spawnSync(process.execPath, ["--env-file-if-exists=" + file, "-e", "process.stdout.write(process.env.FROM_FILE ?? '')"], {
      encoding: "utf8",
      env: { ...process.env, FROM_FILE: "shell" },
    });
    assert.equal(kept.status, 0);
    assert.equal(kept.stdout, "shell");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
