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

test("turn stays off unless the operator completes one mode", () => {
  assert.throws(() => renderLiveKitYaml({ ...env, TURN_DOMAIN: "turn.example.com" }), /certificate files or TURN_EXTERNAL_TLS/);
  const external = renderLiveKitYaml({ ...env, TURN_DOMAIN: "turn.example.com", TURN_EXTERNAL_TLS: "1" });
  assert.match(external, /external_tls: true/);
  assert.equal(external.includes("cert_file"), false);
  assert.equal(external.includes("--dev"), false);
  const embedded = renderLiveKitYaml({
    ...env,
    TURN_DOMAIN: "turn.example.com",
    TURN_CERT_FILE: "C:\\secrets\\turn.pem",
    TURN_KEY_FILE: "C:\\secrets\\turn.key",
  });
  assert.match(embedded, /cert_file: \/certs\/turn\.pem/);
  assert.equal(embedded.includes("C:\\secrets"), false);
  assert.throws(
    () =>
      renderLiveKitYaml({
        ...env,
        TURN_DOMAIN: "turn.example.com",
        TURN_EXTERNAL_TLS: "1",
        TURN_CERT_FILE: "C:\\secrets\\turn.pem",
        TURN_KEY_FILE: "C:\\secrets\\turn.key",
      }),
    /cannot be combined/,
  );
});

test("node ip replaces external discovery and rejects loopback", () => {
  const yaml = renderLiveKitYaml({ ...env, LIVEKIT_NODE_IP: "203.0.113.10" });
  assert.match(yaml, /node_ip: "203.0.113.10"/);
  assert.match(yaml, /use_external_ip: false/);
  assert.throws(() => renderLiveKitYaml({ ...env, LIVEKIT_NODE_IP: "127.0.0.1" }), /must not be loopback/);
});
