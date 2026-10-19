import assert from "node:assert/strict";
import test from "node:test";
import { fillHostEnv, formatEnv, parseEnv, publicReport } from "../infra/compose/host.mjs";
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
  assert.equal(
    report.some((line) => line === `BOOTSTRAP_TOKEN=${created.BOOTSTRAP_TOKEN}`),
    true,
  );
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
