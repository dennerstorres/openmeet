import assert from "node:assert/strict";
import test from "node:test";
import { bootstrapStateCommand, clearBootstrap, fillHostEnv, formatEnv, parseEnv, publicReport } from "../infra/compose/host.mjs";
import { renderLiveKitYaml } from "../infra/compose/render-livekit.mjs";

const domains = { apiDomain: "api.example.com", livekitDomain: "livekit.example.com" };

test("host setup creates secrets once and publishes only the bootstrap token", () => {
  const created = fillHostEnv({}, domains);
  assert.equal(created.API_DOMAIN, "api.example.com");
  assert.equal(created.LIVEKIT_URL, "wss://livekit.example.com");
  assert.equal(created.LIVEKIT_API_KEY === created.LIVEKIT_API_SECRET, false);
  assert.match(created.AUTH_SECRET, /^[A-Za-z0-9]{32,128}$/);
  assert.match(created.BOOTSTRAP_TOKEN, /^[A-Za-z0-9]{20,128}$/);
  const again = fillHostEnv(created, {});
  assert.equal(again.AUTH_SECRET, created.AUTH_SECRET);
  assert.equal(again.BOOTSTRAP_TOKEN, created.BOOTSTRAP_TOKEN);
  assert.equal(again.POSTGRES_PASSWORD, created.POSTGRES_PASSWORD);
  const report = publicReport({}, created);
  // S-12: the report never carries the bootstrap token.
  assert.equal(
    report.some((line) => line.includes(created.BOOTSTRAP_TOKEN)),
    false,
  );
  assert.equal(report.includes("BOOTSTRAP_TOKEN written to infra/compose/.env"), true);
  assert.equal(
    report.some((line) => line.includes(created.AUTH_SECRET)),
    false,
  );
  assert.equal(
    report.some((line) => line.includes(created.LIVEKIT_API_SECRET)),
    false,
  );
  assert.equal(
    report.some((line) => line.includes(created.POSTGRES_PASSWORD)),
    false,
  );
  assert.deepEqual(publicReport(created, again), ["wrote infra/compose/.env", "wrote infra/compose/generated/livekit.yaml", "BOOTSTRAP_TOKEN kept"]);
  const yaml = renderLiveKitYaml(created);
  assert.equal(yaml.includes("--dev"), false);
  assert.equal(yaml.includes(created.LIVEKIT_API_SECRET), true);
  assert.deepEqual(parseEnv(formatEnv({ ...created, TURN_DOMAIN: "turn.example.com" })).TURN_DOMAIN, "turn.example.com");
});

test("host setup rejects a shared domain and a bad secret without echoing it", () => {
  assert.throws(() => fillHostEnv({}, { apiDomain: "api.example.com", livekitDomain: "api.example.com" }), /different public hostnames/);
  assert.throws(() => fillHostEnv({ POC_JOIN: "1", API_DOMAIN: "api.example.com", LIVEKIT_DOMAIN: "livekit.example.com" }, {}), /POC_JOIN must stay off/);
  const leaked = "not a valid secret and should stay hidden";
  assert.throws(
    () => fillHostEnv({ API_DOMAIN: "api.example.com", LIVEKIT_DOMAIN: "livekit.example.com", AUTH_SECRET: leaked }, {}),
    (error) => {
      assert.equal(error instanceof Error, true);
      assert.equal(error.message.includes(leaked), false);
      return true;
    },
  );
});

// Each service block of the Compose file, as the text under its two-space key.
function composeServices(text) {
  const services = new Map();
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    if (/^\S/.test(line)) current = null;
    const service = /^ {2}([a-z0-9-]+):\s*$/.exec(line);
    if (service && line.startsWith("  ") && !line.startsWith("   ")) {
      current = service[1];
      services.set(current, []);
      continue;
    }
    if (current !== null) services.get(current).push(line);
  }
  return services;
}

test("the proxy secret is created once, never printed, and the API and database publish no port (S-11)", async () => {
  const { readFile } = await import("node:fs/promises");
  const created = fillHostEnv({}, domains);
  assert.match(created.PROXY_AUTH, /^[A-Za-z0-9]{32,128}$/);
  assert.notEqual(created.PROXY_AUTH, created.AUTH_SECRET);
  assert.equal(fillHostEnv(created, {}).PROXY_AUTH, created.PROXY_AUTH);
  assert.throws(() => fillHostEnv({ ...created, PROXY_AUTH: "short" }, {}), /PROXY_AUTH is invalid/);
  assert.equal(
    publicReport({}, created).some((line) => line.includes(created.PROXY_AUTH)),
    false,
  );

  const compose = composeServices(await readFile(new URL("../infra/compose/docker-compose.yml", import.meta.url), "utf8"));
  for (const name of ["api", "postgres"]) {
    const block = compose.get(name);
    assert.ok(block, name);
    assert.equal(
      block.some((line) => /^ {4}ports:/.test(line)),
      false,
      `${name} must not publish a port`,
    );
  }
  for (const name of ["api", "caddy"]) {
    assert.equal(
      compose.get(name).some((line) => line.includes("PROXY_AUTH: ${PROXY_AUTH:?set PROXY_AUTH}")),
      true,
      name,
    );
  }
  const caddy = await readFile(new URL("../infra/compose/Caddyfile", import.meta.url), "utf8");
  const apiSite = caddy.slice(caddy.indexOf("{$API_DOMAIN}"), caddy.indexOf("{$LIVEKIT_DOMAIN}"));
  assert.match(apiSite, /header_up X-Forwarded-For \{remote_host\}/);
  assert.match(apiSite, /header_up X-OpenMeet-Proxy \{\$PROXY_AUTH\}/);
  assert.equal(caddy.slice(caddy.indexOf("{$LIVEKIT_DOMAIN}")).includes("PROXY_AUTH"), false);
  const entrypoint = await readFile(new URL("../apps/server/docker-entrypoint.sh", import.meta.url), "utf8");
  assert.match(entrypoint, /TRUST_PROXY:-0\}" = "1" \] && \[ "\$\{#PROXY_AUTH\}" -lt 32 \]/);
});

test("--clear-bootstrap removes the token only when postgres says the bootstrap is closed (S-12)", async () => {
  const created = fillHostEnv({}, domains);
  const command = bootstrapStateCommand();
  assert.deepEqual(command.slice(command.indexOf("exec"), command.indexOf("exec") + 3), ["exec", "-T", "postgres"]);
  assert.equal(command.includes("-p"), false);
  assert.equal(command.includes("--publish"), false);
  assert.equal(
    command.some((part) => part.includes(created.POSTGRES_PASSWORD)),
    false,
  );
  for (const result of [
    { code: 0, stdout: "f\n" },
    { code: 0, stdout: "" },
    { code: 1, stdout: "t\n" },
  ]) {
    const kept = await clearBootstrap(created, async () => result);
    assert.equal(kept.cleared, false);
    assert.equal(kept.env.BOOTSTRAP_TOKEN, created.BOOTSTRAP_TOKEN);
  }
  let asked;
  const done = await clearBootstrap(created, async (args) => {
    asked = args;
    return { code: 0, stdout: "t\n" };
  });
  assert.deepEqual(asked, command);
  assert.equal(done.cleared, true);
  assert.equal("BOOTSTRAP_TOKEN" in done.env, false);
  assert.equal(formatEnv(done.env).includes(created.BOOTSTRAP_TOKEN), false);
  const rerun = fillHostEnv(done.env, {});
  assert.equal("BOOTSTRAP_TOKEN" in rerun, false);
  assert.deepEqual(publicReport(done.env, rerun).at(-1), "BOOTSTRAP_TOKEN cleared");
});
