import { spawn } from "node:child_process";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { restrictToOwner } from "./acl.mjs";

const composeDir = path.dirname(fileURLToPath(import.meta.url));
const generatedDir = path.join(composeDir, "generated");
const envPath = path.join(composeDir, ".env");
export const composeFile = path.join(composeDir, "docker-compose.yml");

// S-17: version byte 1, 12-byte IV, AES-256-GCM ciphertext, 16-byte tag at the end.
const VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const backupKeyPattern = /^[A-Za-z0-9]{32,128}$/;

function insideGenerated(filePath) {
  const resolved = path.resolve(filePath);
  const relative = path.relative(generatedDir, resolved);
  return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative) ? resolved : undefined;
}

/** A new backup is always encrypted: only a .sql.enc file inside infra/compose/generated. */
export function assertBackupPath(filePath) {
  const resolved = insideGenerated(filePath);
  if (resolved === undefined || !resolved.endsWith(".sql.enc")) {
    throw new Error("backup path must be a .sql.enc file inside infra/compose/generated");
  }
  return resolved;
}

/** A dump written before encryption existed restores as it always did, without BACKUP_KEY. */
export function assertLegacyRestorePath(filePath) {
  const resolved = insideGenerated(filePath);
  if (resolved === undefined || !resolved.endsWith(".sql")) {
    throw new Error("restore path must be a .sql or .sql.enc file inside infra/compose/generated");
  }
  return resolved;
}

/** SHA-256 of BACKUP_KEY. It is not the database password, and an old file needs the key of its time. */
export function backupCipherKey(backupKey) {
  if (typeof backupKey !== "string" || !backupKeyPattern.test(backupKey)) throw new Error("BACKUP_KEY is missing or invalid");
  return createHash("sha256").update(backupKey, "utf8").digest();
}

/**
 * Encrypts the dump as it streams. The plaintext is searched for the database password before it is
 * encrypted, across chunk borders; a hit fails the stream. No clear SQL is ever written.
 */
export function createBackupEncryptor(key, password) {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const needle = Buffer.from(password, "utf8");
  let tail = Buffer.alloc(0);
  let started = false;
  return new Transform({
    transform(chunk, _encoding, done) {
      const window = Buffer.concat([tail, chunk]);
      if (needle.length > 0 && window.includes(needle)) {
        done(new Error("backup contained the database password and was removed"));
        return;
      }
      tail = needle.length > 1 ? window.subarray(Math.max(0, window.length - (needle.length - 1))) : Buffer.alloc(0);
      if (!started) {
        started = true;
        this.push(Buffer.from([VERSION]));
        this.push(iv);
      }
      done(null, cipher.update(chunk));
    },
    flush(done) {
      if (!started) {
        this.push(Buffer.from([VERSION]));
        this.push(iv);
      }
      this.push(cipher.final());
      done(null, cipher.getAuthTag());
    },
  });
}

/** Checks version and tag before anything reaches psql, so a tampered file restores nothing. */
export function decryptBackup(file, key) {
  if (file.length < 1 + IV_BYTES + TAG_BYTES || file[0] !== VERSION) throw new Error("backup format is not supported");
  const iv = file.subarray(1, 1 + IV_BYTES);
  const tag = file.subarray(file.length - TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(file.subarray(1 + IV_BYTES, file.length - TAG_BYTES)), decipher.final()]);
  } catch {
    throw new Error("backup could not be decrypted with this BACKUP_KEY");
  }
}

export function dumpArgs() {
  return [
    "compose",
    "-f",
    composeFile,
    "exec",
    "-T",
    "postgres",
    "pg_dump",
    "-U",
    "openmeet",
    "-d",
    "openmeet",
    "--clean",
    "--if-exists",
    "--no-owner",
    "--no-privileges",
  ];
}

export function restoreArgs() {
  return ["compose", "-f", composeFile, "exec", "-T", "postgres", "psql", "-U", "openmeet", "-d", "openmeet", "-v", "ON_ERROR_STOP=1"];
}

function secretInArgs(args) {
  const password = process.env.POSTGRES_PASSWORD ?? "";
  return password.length > 0 && args.some((arg) => arg.includes(password));
}

function docker(args, stdin) {
  if (secretInArgs(args)) throw new Error("postgres command must not receive the password");
  const child = spawn("docker", args, { stdio: [stdin ? "pipe" : "ignore", stdin ? "inherit" : "pipe", "inherit"] });
  const exited = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`docker exited ${code ?? "unknown"}`))));
  });
  return { child, exited };
}

async function stackSecret(name) {
  const fromProcess = process.env[name] ?? "";
  if (fromProcess.length > 0) return fromProcess;
  try {
    const line = (await readFile(envPath, "utf8")).split(/\r?\n/).find((item) => item.startsWith(`${name}=`));
    return line === undefined ? "" : line.slice(name.length + 1).trim();
  } catch {
    return "";
  }
}

export async function backupDatabase(filePath) {
  const target = assertBackupPath(filePath);
  const password = await stackSecret("POSTGRES_PASSWORD");
  if (password.length < 12) throw new Error("POSTGRES_PASSWORD must be at least 12 characters");
  const key = backupCipherKey(await stackSecret("BACKUP_KEY"));
  await mkdir(generatedDir, { recursive: true });
  const { child, exited } = docker(dumpArgs());
  try {
    await Promise.all([pipeline(child.stdout, createBackupEncryptor(key, password), createWriteStream(target, { flags: "w", mode: 0o600 })), exited]);
  } catch (error) {
    child.kill();
    await rm(target, { force: true });
    throw error;
  }
  restrictToOwner(target);
  return target;
}

export async function restoreDatabase(filePath) {
  let input;
  if (path.resolve(filePath).endsWith(".sql.enc")) {
    const source = assertBackupPath(filePath);
    input = Readable.from([decryptBackup(await readFile(source), backupCipherKey(await stackSecret("BACKUP_KEY")))]);
  } else {
    input = createReadStream(assertLegacyRestorePath(filePath));
  }
  const { child, exited } = docker(restoreArgs(), true);
  await Promise.all([pipeline(input, child.stdin), exited]);
}

async function main() {
  const action = process.argv[2];
  const requested = process.argv[3] ?? path.join(generatedDir, "openmeet.sql.enc");
  if (action === "backup") {
    await backupDatabase(requested);
    process.stdout.write("wrote encrypted backup\n");
    return;
  }
  if (action === "restore") {
    await restoreDatabase(requested);
    process.stdout.write("restored backup\n");
    return;
  }
  process.stderr.write("usage: node infra/compose/pg-copy.mjs backup|restore [infra/compose/generated/file.sql.enc]\n");
  process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : "backup failed";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
