import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generatedConfigPath, renderLiveKitYaml } from "./render-livekit.mjs";

const composeDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(composeDir, "../..");
const envPath = path.join(composeDir, ".env");
const hostname = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const authSecret = /^[A-Za-z0-9]{32,128}$/;
const livekitCredential = /^[A-Za-z0-9]{16,128}$/;
const bootstrapToken = /^[A-Za-z0-9]{20,128}$/;
const password = /^[A-Za-z0-9]{12,128}$/;
const order = ["API_DOMAIN", "LIVEKIT_DOMAIN", "LIVEKIT_URL", "POSTGRES_PASSWORD", "AUTH_SECRET", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET", "BOOTSTRAP_TOKEN"];

function token(bytes) {
  return randomBytes(bytes).toString("hex");
}

function invalid(name) {
  return new Error(`${name} is invalid`);
}

function keepOrCreate(env, name, pattern, created) {
  const current = env[name]?.trim() ?? "";
  if (current.length === 0) {
    env[name] = created;
    return;
  }
  if (!pattern.test(current)) throw invalid(name);
  env[name] = current;
}

export function parseEnv(text) {
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index <= 0) throw new Error("invalid env line");
    const key = trimmed.slice(0, index);
    const value = trimmed.slice(index + 1);
    if (!/^[A-Z0-9_]+$/.test(key) || value.includes("\n") || value.includes("\r")) throw new Error("invalid env line");
    env[key] = value;
  }
  return env;
}

export function formatEnv(env) {
  const keys = [
    ...order.filter((key) => key in env),
    ...Object.keys(env)
      .filter((key) => !order.includes(key))
      .sort(),
  ];
  return `${keys.map((key) => `${key}=${env[key]}`).join("\n")}\n`;
}

export function fillHostEnv(existing, input) {
  if (existing.POC_JOIN === "1") throw new Error("POC_JOIN must stay off");
  const env = { ...existing };
  const apiDomain = (input.apiDomain ?? env.API_DOMAIN ?? "").trim().toLowerCase();
  const livekitDomain = (input.livekitDomain ?? env.LIVEKIT_DOMAIN ?? "").trim().toLowerCase();
  if (!hostname.test(apiDomain) || !hostname.test(livekitDomain) || apiDomain === livekitDomain) {
    throw new Error("API_DOMAIN and LIVEKIT_DOMAIN must be different public hostnames");
  }
  env.API_DOMAIN = apiDomain;
  env.LIVEKIT_DOMAIN = livekitDomain;
  env.LIVEKIT_URL = `wss://${livekitDomain}`;
  keepOrCreate(env, "POSTGRES_PASSWORD", password, token(24));
  keepOrCreate(env, "AUTH_SECRET", authSecret, token(24));
  keepOrCreate(env, "LIVEKIT_API_KEY", livekitCredential, token(16));
  const currentSecret = env.LIVEKIT_API_SECRET?.trim() ?? "";
  if (currentSecret.length === 0) {
    let created = token(16);
    for (let attempt = 0; attempt < 3 && created === env.LIVEKIT_API_KEY; attempt += 1) created = token(16);
    if (created === env.LIVEKIT_API_KEY) throw invalid("LIVEKIT_API_SECRET");
    env.LIVEKIT_API_SECRET = created;
  } else if (!livekitCredential.test(currentSecret) || currentSecret === env.LIVEKIT_API_KEY) {
    throw invalid("LIVEKIT_API_SECRET");
  } else {
    env.LIVEKIT_API_SECRET = currentSecret;
  }
  keepOrCreate(env, "BOOTSTRAP_TOKEN", bootstrapToken, token(16));
  return env;
}

export function publicReport(before, after) {
  const lines = ["wrote infra/compose/.env", "wrote infra/compose/generated/livekit.yaml"];
  if ((before.BOOTSTRAP_TOKEN ?? "").trim().length === 0) lines.push(`BOOTSTRAP_TOKEN=${after.BOOTSTRAP_TOKEN}`);
  else lines.push("BOOTSTRAP_TOKEN kept");
  return lines;
}

function option(argv, name) {
  const index = argv.indexOf(name);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`${name} needs a value`);
  return value;
}

async function readExisting() {
  try {
    return parseEnv(await readFile(envPath, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return {};
    throw error;
  }
}

function runCompose() {
  return new Promise((resolve) => {
    const child = spawn("docker", ["compose", "--env-file", envPath, "-f", path.join(composeDir, "docker-compose.yml"), "up", "-d", "--build"], {
      cwd: repoRoot,
      stdio: "inherit",
    });
    child.on("exit", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help")) {
    process.stdout.write("usage: node infra/compose/host.mjs --api-domain host --livekit-domain host [--up]\n");
    return;
  }
  const before = await readExisting();
  const env = fillHostEnv(before, { apiDomain: option(argv, "--api-domain"), livekitDomain: option(argv, "--livekit-domain") });
  const yaml = renderLiveKitYaml(env);
  if (yaml.includes("--dev")) throw new Error("rendered LiveKit config is not production");
  await mkdir(path.dirname(generatedConfigPath()), { recursive: true });
  await writeFile(envPath, formatEnv(env), { encoding: "utf8", mode: 0o600 });
  await writeFile(generatedConfigPath(), yaml, { encoding: "utf8", mode: 0o600 });
  for (const line of publicReport(before, env)) process.stdout.write(`${line}\n`);
  if (!argv.includes("--up")) {
    process.stdout.write("files only; pass --up to start the stack\n");
    return;
  }
  const code = await runCompose();
  if (code !== 0) process.exitCode = code;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : "host setup failed";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
