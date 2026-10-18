import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const requiredDirectories = ["apps/desktop", "apps/server", "packages/shared", "packages/media", "packages/ui", "infra"];

for (const directory of requiredDirectories) {
  test(`workspace directory exists: ${directory}`, () => {
    assert.equal(existsSync(directory), true);
  });
}

test("packageManager matches the pnpm version used to bootstrap", () => {
  const manifest = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(manifest.private, true);
  assert.equal(manifest.packageManager, "pnpm@10.30.2");
  assert.equal(manifest.engines.node, ">=24.18.0");
});

test("pnpm workspace globs cover apps and packages", () => {
  const workspace = readFileSync("pnpm-workspace.yaml", "utf8");
  assert.match(workspace, /apps\/\*/);
  assert.match(workspace, /packages\/\*/);
});

test("prettier uses the repository convention", () => {
  const prettier = JSON.parse(readFileSync(".prettierrc.json", "utf8"));
  assert.equal(prettier.trailingComma, "all");
  assert.equal(prettier.printWidth, 160);
});
