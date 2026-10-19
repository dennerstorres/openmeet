import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));

// S-13: the installer bundle carries neither the media proof module nor the link to it.
test("the production bundle has no media proof", async () => {
  const outDir = await mkdtemp(path.join(tmpdir(), "openmeet-bundle-"));
  try {
    await build({ root, logLevel: "silent", build: { outDir, emptyOutDir: true } });
    const files = await readdir(outDir, { recursive: true });
    let text = "";
    for (const file of files) {
      if (/\.(js|html|css)$/.test(file)) text += await readFile(path.join(outDir, file), "utf8");
    }
    assert.ok(text.length > 0);
    for (const needle of ["PocApp", "?poc=1", "Prova de mídia", "poc_unconfigured"]) {
      assert.equal(text.includes(needle), false, needle);
    }
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("the proof module is only reachable from the dev branch", async () => {
  const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.equal(/^import .*PocApp/m.test(app), false);
  assert.match(app, /import\.meta\.env\.DEV \? lazy\(\(\) => import\("\.\/poc\/PocApp"\)/);
});
