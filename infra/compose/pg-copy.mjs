import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { finished } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const composeDir = path.dirname(fileURLToPath(import.meta.url));
const generatedDir = path.join(composeDir, "generated");
export const composeFile = path.join(composeDir, "docker-compose.yml");

export function assertBackupPath(filePath) {
  const resolved = path.resolve(filePath);
  const relative = path.relative(generatedDir, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative) || !resolved.endsWith(".sql")) {
    throw new Error("backup path must be a .sql file inside infra/compose/generated");
  }
  return resolved;
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

function run(args, { input, output } = {}) {
  if (secretInArgs(args)) {
    return Promise.reject(new Error("postgres command must not receive the password"));
  }
  const child = spawn("docker", args, { stdio: [input ? "pipe" : "ignore", output ? "pipe" : "inherit", "inherit"] });
  const writer = output ? createWriteStream(output, { flags: "w", mode: 0o600 }) : undefined;
  if (writer) {
    child.stdout?.pipe(writer);
  }
  if (input) {
    input.pipe(child.stdin);
  }
  const closed = new Promise((resolve, reject) => {
    child.on("error", reject);
    writer?.on("error", reject);
    input?.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`docker exited ${code ?? "unknown"}`));
      }
    });
  });
  return closed.then(async () => {
    if (writer) {
      await finished(writer);
    }
  });
}

async function assertDumpClean(filePath) {
  const password = process.env.POSTGRES_PASSWORD ?? "";
  if (password.length < 12) {
    throw new Error("POSTGRES_PASSWORD must be at least 12 characters");
  }
  const dump = await readFile(filePath, "utf8");
  if (dump.includes(password)) {
    await rm(filePath, { force: true });
    throw new Error("backup contained the database password and was removed");
  }
}

export async function backupDatabase(filePath) {
  const target = assertBackupPath(filePath);
  await mkdir(generatedDir, { recursive: true });
  await run(dumpArgs(), { output: target });
  await assertDumpClean(target);
  return target;
}

export async function restoreDatabase(filePath) {
  const source = assertBackupPath(filePath);
  const input = createReadStream(source);
  try {
    await run(restoreArgs(), { input });
  } finally {
    input.destroy();
  }
}

async function main() {
  const action = process.argv[2];
  const requested = process.argv[3] ?? path.join(generatedDir, "openmeet.sql");
  if (action === "backup") {
    await backupDatabase(requested);
    process.stdout.write("wrote backup\n");
    return;
  }
  if (action === "restore") {
    await restoreDatabase(requested);
    process.stdout.write("restored backup\n");
    return;
  }
  process.stderr.write("usage: node infra/compose/pg-copy.mjs backup|restore [infra/compose/generated/file.sql]\n");
  process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : "backup failed";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
