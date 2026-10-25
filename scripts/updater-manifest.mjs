import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ADR 0018: latest.json for tauri-plugin-updater, published next to the signed installer.
const safeName = /^[A-Za-z0-9._-]+$/;
const semver = /^\d+\.\d+\.\d+$/;
const repo = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function buildManifest({ version, notes, pubDate, repository, installer, signature }) {
  if (!semver.test(version)) throw new Error("version must be x.y.z");
  if (!repo.test(repository)) throw new Error("repository must be owner/name");
  if (!safeName.test(installer) || !installer.endsWith("-setup.exe")) throw new Error("installer name is not a setup executable");
  const trimmed = signature.trim();
  if (trimmed.length === 0 || /\s/.test(trimmed)) throw new Error("signature must be one base64 line");
  return {
    version,
    notes,
    pub_date: pubDate,
    platforms: {
      "windows-x86_64": {
        signature: trimmed,
        url: `https://github.com/${repository}/releases/download/v${version}/${installer}`,
      },
    },
  };
}

export async function writeManifest(directory, { version, notes, repository, pubDate = new Date().toISOString() }) {
  const names = (await readdir(directory)).filter((name) => name.endsWith("-setup.exe"));
  if (names.length !== 1) throw new Error("expected one Windows installer in the bundle directory");
  const installer = names[0];
  const signature = await readFile(path.join(directory, `${installer}.sig`), "utf8").catch(() => {
    throw new Error("installer signature missing: build with createUpdaterArtifacts and the signing key");
  });
  const manifest = buildManifest({ version, notes, pubDate, repository, installer, signature });
  await writeFile(path.join(directory, "latest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}

async function main() {
  const [directory, version, repository] = process.argv.slice(2);
  if (!directory || !version || !repository) {
    process.stderr.write("usage: node scripts/updater-manifest.mjs <bundle-directory> <x.y.z> <owner/name>\n");
    process.exitCode = 1;
    return;
  }
  const manifest = await writeManifest(path.resolve(directory), { version, repository, notes: `OpenMeet ${version}` });
  process.stdout.write(`${manifest.platforms["windows-x86_64"].url}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : "manifest failed";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
