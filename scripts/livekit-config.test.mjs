import assert from "node:assert/strict";
import test from "node:test";
import { renderLiveKitYaml } from "../infra/compose/render-livekit.mjs";

const env = {
  LIVEKIT_API_KEY: "apikeyvalue00001",
  LIVEKIT_API_SECRET: "apisecretvalue001",
};

test("production config uses the udp mux and hides the secret from errors", () => {
  const yaml = renderLiveKitYaml(env);
  assert.match(yaml, /udp_port: 7882/);
  assert.match(yaml, /tcp_port: 7881/);
  assert.match(yaml, /use_external_ip: true/);
  assert.equal(yaml.includes("port_range_start"), false);
  assert.equal(yaml.includes("--dev"), false);
  assert.equal(yaml.includes("turn:"), false);
  assert.match(yaml, /"apikeyvalue00001": "apisecretvalue001"/);
  assert.throws(() => renderLiveKitYaml({ ...env, LIVEKIT_API_SECRET: "" }), /LIVEKIT_API_SECRET is required/);
  assert.throws(
    () => renderLiveKitYaml({ ...env, LIVEKIT_API_KEY: "bad key value!!" }),
    (error) => {
      assert.equal(error instanceof Error, true);
      assert.equal(error.message.includes("bad key value!!"), false);
      assert.equal(error.message.includes(env.LIVEKIT_API_SECRET), false);
      return true;
    },
  );
});

test("turn stays off unless the operator brings a certificate (S-20)", async () => {
  const { readFile } = await import("node:fs/promises");
  assert.throws(() => renderLiveKitYaml({ ...env, TURN_DOMAIN: "turn.example.com" }), /certificate files/);
  assert.throws(() => renderLiveKitYaml({ ...env, TURN_DOMAIN: "turn.example.com", TURN_EXTERNAL_TLS: "1" }), /TURN_EXTERNAL_TLS is not available/);
  assert.throws(() => renderLiveKitYaml({ ...env, TURN_EXTERNAL_TLS: "1" }), /TURN_EXTERNAL_TLS is not available/);
  const certs = { ...env, TURN_DOMAIN: "turn.example.com", TURN_CERT_FILE: "C:\\secrets\\turn.pem", TURN_KEY_FILE: "C:\\secrets\\turn.key" };
  for (const extra of [{ TURN_USERNAME: "relay" }, { TURN_PASSWORD: "relay-password" }]) {
    assert.throws(() => renderLiveKitYaml({ ...certs, ...extra }), /static TURN credentials/);
  }
  const embedded = renderLiveKitYaml(certs);
  assert.match(embedded, /cert_file: \/certs\/turn\.pem/);
  assert.equal(embedded.includes("C:\\secrets"), false);
  assert.equal(embedded.includes("external_tls"), false);
  assert.equal(/username|password|credential/i.test(embedded.slice(embedded.indexOf("turn:"))), false);
  assert.equal(embedded.includes("--dev"), false);

  const udpOnly = await readFile(new URL("../infra/compose/docker-compose.turn.yml", import.meta.url), "utf8");
  assert.equal(/^\s*- "?5349/m.test(udpOnly), false);
  assert.match(udpOnly, /"3478:3478\/udp"/);
  const withCerts = await readFile(new URL("../infra/compose/docker-compose.turn-certs.yml", import.meta.url), "utf8");
  assert.match(withCerts, /"5349:5349"/);
});

test("node ip replaces external discovery and rejects loopback", () => {
  const yaml = renderLiveKitYaml({ ...env, LIVEKIT_NODE_IP: "203.0.113.10" });
  assert.match(yaml, /node_ip: "203.0.113.10"/);
  assert.match(yaml, /use_external_ip: false/);
  assert.throws(() => renderLiveKitYaml({ ...env, LIVEKIT_NODE_IP: "127.0.0.1" }), /must not be loopback/);
});
