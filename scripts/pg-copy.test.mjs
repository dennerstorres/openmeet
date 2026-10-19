import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { assertBackupPath, dumpArgs, restoreArgs } from "../infra/compose/pg-copy.mjs";

test("backup commands stay inside the generated directory and omit the password", () => {
  const previous = process.env.POSTGRES_PASSWORD;
  process.env.POSTGRES_PASSWORD = "disposablepasswordvalue";
  try {
    const dump = dumpArgs();
    const restore = restoreArgs();
    assert.equal(dump.includes("pg_dump"), true);
    assert.equal(restore.includes("psql"), true);
    assert.equal(
      dump.some((arg) => arg.includes("disposablepasswordvalue")),
      false,
    );
    assert.equal(
      restore.some((arg) => arg.includes("disposablepasswordvalue")),
      false,
    );
    assert.equal(dump.includes("--dev"), false);
    const safe = assertBackupPath(fileURLToPath(new URL("../infra/compose/generated/openmeet.sql", import.meta.url)));
    assert.equal(safe.endsWith("openmeet.sql"), true);
    assert.throws(() => assertBackupPath("C:\\temp\\openmeet.sql"), /inside infra\/compose\/generated/);
    assert.throws(() => assertBackupPath(fileURLToPath(new URL("../infra/compose/generated/openmeet.txt", import.meta.url))), /\.sql/);
  } finally {
    if (previous === undefined) {
      delete process.env.POSTGRES_PASSWORD;
    } else {
      process.env.POSTGRES_PASSWORD = previous;
    }
  }
});
