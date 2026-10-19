import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { ownerOnlyArgs, restrictToOwner } from "../infra/compose/acl.mjs";
import {
  assertBackupPath,
  assertLegacyRestorePath,
  backupCipherKey,
  createBackupEncryptor,
  decryptBackup,
  dumpArgs,
  restoreArgs,
} from "../infra/compose/pg-copy.mjs";

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
    const generated = (name) => fileURLToPath(new URL(`../infra/compose/generated/${name}`, import.meta.url));
    assert.equal(assertBackupPath(generated("openmeet.sql.enc")).endsWith("openmeet.sql.enc"), true);
    assert.throws(() => assertBackupPath(generated("openmeet.sql")), /\.sql\.enc/);
    assert.throws(() => assertBackupPath("C:\\temp\\openmeet.sql.enc"), /inside infra\/compose\/generated/);
    assert.throws(() => assertBackupPath(generated("openmeet.txt")), /\.sql\.enc/);
    assert.equal(assertLegacyRestorePath(generated("old.sql")).endsWith("old.sql"), true);
    assert.throws(() => assertLegacyRestorePath("C:\\temp\\old.sql"), /inside infra\/compose\/generated/);
  } finally {
    if (previous === undefined) {
      delete process.env.POSTGRES_PASSWORD;
    } else {
      process.env.POSTGRES_PASSWORD = previous;
    }
  }
});

async function encrypt(chunks, key, password) {
  const out = [];
  const stream = Readable.from(chunks.map((chunk) => Buffer.from(chunk))).pipe(createBackupEncryptor(key, password));
  for await (const part of stream) out.push(part);
  return Buffer.concat(out);
}

test("the backup is AES-256-GCM with a version byte and never holds the dump in clear (S-17)", async () => {
  const key = backupCipherKey("a".repeat(48));
  const dump = "create table users (password_hash text);\ninsert into users values ('argon2id-hash');\n";
  const file = await encrypt([dump.slice(0, 20), dump.slice(20)], key, "databasepassword1");
  assert.equal(file[0], 1);
  assert.equal(file.includes(Buffer.from("argon2id-hash")), false);
  assert.equal(file.includes(Buffer.from("create table")), false);
  assert.equal(decryptBackup(file, key).toString("utf8"), dump);

  assert.throws(() => decryptBackup(file, backupCipherKey("b".repeat(48))), /could not be decrypted/);
  const future = Buffer.from(file);
  future[0] = 2;
  assert.throws(() => decryptBackup(future, key), /format is not supported/);
  const tampered = Buffer.from(file);
  tampered[20] ^= 1;
  assert.throws(() => decryptBackup(tampered, key), /could not be decrypted/);
  assert.throws(() => backupCipherKey("short"), /BACKUP_KEY/);
  assert.equal(decryptBackup(await encrypt([], key, "databasepassword1"), key).length, 0);
});

test("the database password in the dump fails the backup, even split across chunks", async () => {
  const key = backupCipherKey("a".repeat(48));
  await assert.rejects(encrypt(["alter role x password 'databasepass", "word1';"], key, "databasepassword1"), /contained the database password/);
});

test("on Windows the file is left to the current user only; elsewhere the mode does it", () => {
  assert.deepEqual(ownerOnlyArgs("C:\\stack\\.env", { USERDOMAIN: "PC", USERNAME: "ops" }), ["C:\\stack\\.env", "/inheritance:r", "/grant:r", "PC\\ops:(R,W)"]);
  const calls = [];
  const run = (command, args) => {
    calls.push([command, ...args]);
    return { status: 0 };
  };
  restrictToOwner("x", "linux", run);
  assert.equal(calls.length, 0);
  restrictToOwner("x", "win32", run);
  assert.equal(calls[0][0], "icacls");
  assert.throws(() => restrictToOwner("x", "win32", () => ({ status: 5 })), /could not restrict/);
});
