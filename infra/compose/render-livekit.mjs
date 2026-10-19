import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const composeDir = path.dirname(fileURLToPath(import.meta.url));
const generatedDir = path.join(composeDir, "generated");
const credential = /^[A-Za-z0-9]{16,128}$/;
const hostname = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

function required(env, name) {
  const value = env[name]?.trim() ?? "";
  if (value.length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function quote(value) {
  return `"${value}"`;
}

function nodeIp(value) {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(value);
  if (!match) {
    throw new Error("LIVEKIT_NODE_IP must be an IPv4 address");
  }
  const parts = match.slice(1).map((part) => Number(part));
  if (parts.some((part) => part > 255)) {
    throw new Error("LIVEKIT_NODE_IP must be an IPv4 address");
  }
  const [first, second] = parts;
  if (first === 0 || first === 127 || (first === 169 && second === 254)) {
    throw new Error("LIVEKIT_NODE_IP must not be loopback, unspecified or link-local");
  }
  return parts.join(".");
}

function turnBlock(env) {
  const domain = env.TURN_DOMAIN?.trim().toLowerCase() ?? "";
  const cert = env.TURN_CERT_FILE?.trim() ?? "";
  const key = env.TURN_KEY_FILE?.trim() ?? "";
  // S-20: no terminator for external TLS lives in this Compose, so that mode is refused.
  if (env.TURN_EXTERNAL_TLS === "1") {
    throw new Error("TURN_EXTERNAL_TLS is not available: no TLS terminator runs in this stack");
  }
  // Credentials stay ephemeral, issued by LiveKit from the API key. A static TURN user never enters the YAML.
  if ((env.TURN_USERNAME ?? "").length > 0 || (env.TURN_PASSWORD ?? "").length > 0) {
    throw new Error("static TURN credentials are not supported");
  }
  if (domain.length === 0 && cert.length === 0 && key.length === 0) {
    return "";
  }
  if (!hostname.test(domain)) {
    throw new Error("TURN_DOMAIN is missing or invalid");
  }
  if (cert.length === 0 || key.length === 0) {
    throw new Error("TURN requires certificate files");
  }
  const lines = [
    "turn:",
    "  enabled: true",
    `  domain: ${quote(domain)}`,
    "  tls_port: 5349",
    "  udp_port: 3478",
    "  cert_file: /certs/turn.pem",
    "  key_file: /certs/turn.key",
  ];
  return lines.join("\n");
}

export function renderLiveKitYaml(env) {
  const key = required(env, "LIVEKIT_API_KEY");
  const secret = required(env, "LIVEKIT_API_SECRET");
  if (!credential.test(key) || !credential.test(secret) || key === secret) {
    throw new Error("LIVEKIT_API_KEY and LIVEKIT_API_SECRET must be different 16 to 128 character alphanumeric values");
  }
  const configuredIp = env.LIVEKIT_NODE_IP?.trim() ?? "";
  const rtc = ["rtc:", "  tcp_port: 7881", "  udp_port: 7882"];
  if (configuredIp.length > 0) {
    rtc.push(`  node_ip: ${quote(nodeIp(configuredIp))}`, "  use_external_ip: false");
  } else {
    rtc.push("  use_external_ip: true");
  }
  const turn = turnBlock(env);
  const lines = ["port: 7880", rtc.join("\n"), "keys:", `  ${quote(key)}: ${quote(secret)}`, "logging:", "  level: info", "  pion_level: error"];
  if (turn.length > 0) {
    lines.push(turn);
  }
  return `${lines.join("\n")}\n`;
}

export function generatedConfigPath() {
  return path.join(generatedDir, "livekit.yaml");
}

async function writeConfig() {
  const yaml = renderLiveKitYaml(process.env);
  if (yaml.includes("--dev")) {
    throw new Error("rendered LiveKit config is not production");
  }
  await mkdir(generatedDir, { recursive: true });
  await writeFile(generatedConfigPath(), yaml, { encoding: "utf8", mode: 0o600 });
  process.stdout.write("wrote infra/compose/generated/livekit.yaml\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  writeConfig().catch((error) => {
    const message = error instanceof Error ? error.message : "livekit config failed";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
