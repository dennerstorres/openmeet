import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// S-19: the stack .env never enters the API build context. This reads the list; the daemon proof is in HISTORY.
test("the build context ignores the stack env files by path", async () => {
  const lines = (await readFile(new URL("../.dockerignore", import.meta.url), "utf8")).split(/\r?\n/).map((line) => line.trim());
  for (const pattern of ["infra/compose/.env", "infra/compose/.env.*", "**/.env", "**/.env.*"]) {
    assert.equal(lines.includes(pattern), true, pattern);
  }
  assert.equal(
    lines.some((line) => line.startsWith("!") && line.includes(".env")),
    false,
  );
});
