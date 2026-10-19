import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const safeName = /^[A-Za-z0-9._-]+$/;
const sha256 = /^[a-f0-9]{64}$/;

export function checksumLine(name, digest) {
  if (!safeName.test(name) || !name.endsWith("-setup.exe")) {
    throw new Error("installer name is not a setup executable");
  }
  if (!sha256.test(digest)) {
    throw new Error("checksum must be sha256");
  }
  return `${digest}  ${name}`;
}

export async function writeChecksums(directory) {
  const names = (await readdir(directory)).filter((name) => name.endsWith("-setup.exe")).sort();
  if (names.length === 0) {
    throw new Error("no Windows installer in the bundle directory");
  }
  const lines = [];
  for (const name of names) {
    const digest = createHash("sha256")
      .update(await readFile(path.join(directory, name)))
      .digest("hex");
    lines.push(checksumLine(name, digest));
  }
  const text = `${lines.join("\n")}\n`;
  await writeFile(path.join(directory, "SHA256SUMS"), text, "utf8");
  return text;
}

async function main() {
  const directory = process.argv[2];
  if (!directory) {
    process.stderr.write("usage: node scripts/installer-checksum.mjs <bundle-directory>\n");
    process.exitCode = 1;
    return;
  }
  const text = await writeChecksums(path.resolve(directory));
  process.stdout.write(text);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : "checksum failed";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
