import assert from "node:assert/strict";
import test from "node:test";
import { TokenVerifier } from "livekit-server-sdk";
import { buildApp } from "../src/app.js";

const apiKey = "unit-test-key";
const apiSecret = "unit-test-secret-do-not-leak";

function pocEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    POC_JOIN: "1",
    LIVEKIT_URL: "ws://127.0.0.1:7880",
    LIVEKIT_API_KEY: apiKey,
    LIVEKIT_API_SECRET: apiSecret,
    ...overrides,
  };
}

test("POC join stays hidden unless it is explicitly enabled", async () => {
  const app = await buildApp({ logger: false, env: { POC_JOIN: "0" } });
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/poc/join",
    payload: { room: "poc", identity: "win-a", note: apiSecret },
  });
  assert.equal(response.statusCode, 404);
  assert.equal(response.body.includes(apiSecret), false);
  assert.equal(response.body.includes("poc_disabled"), false);
  await app.close();
});

test("POC join refuses to boot when the bind is not loopback", async () => {
  await assert.rejects(() => buildApp({ logger: false, env: pocEnv({ HOST: "0.0.0.0" }) }), /loopback HOST/);
});

test("POC join refuses a request that did not come from loopback", async () => {
  const app = await buildApp({ logger: false, env: pocEnv({ HOST: "127.0.0.1" }) });
  const remoteIp = await app.inject({
    method: "POST",
    url: "/api/v1/poc/join",
    remoteAddress: "203.0.113.10",
    headers: { host: "127.0.0.1:3000" },
    payload: { room: "poc", identity: "win-a" },
  });
  assert.equal(remoteIp.statusCode, 404);
  assert.equal(remoteIp.body.includes("eyJ"), false);

  const remoteHost = await app.inject({
    method: "POST",
    url: "/api/v1/poc/join",
    remoteAddress: "127.0.0.1",
    headers: { host: "evil.example" },
    payload: { room: "poc", identity: "win-a" },
  });
  assert.equal(remoteHost.statusCode, 404);
  assert.equal(remoteHost.body.includes("eyJ"), false);
  await app.close();
});

test("POC join refuses to run without local LiveKit settings", async () => {
  const app = await buildApp({ logger: false, env: { POC_JOIN: "1" } });
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/poc/join",
    payload: { room: "poc", identity: "win-a" },
  });
  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.json(), { error: "poc_unconfigured" });
  await app.close();
});

test("POC join issues a room-scoped short-lived token and does not echo the secret", async () => {
  const app = await buildApp({ logger: false, env: pocEnv() });
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/poc/join",
    payload: { room: "poc-room", identity: "win-a" },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(response.body.includes(apiSecret), false);
  const body = response.json() as { url: string; token: string };
  assert.equal(body.url, "ws://127.0.0.1:7880/");
  const grants = await new TokenVerifier(apiKey, apiSecret).verify(body.token);
  assert.equal(grants.sub, "win-a");
  assert.equal(grants.video?.room, "poc-room");
  assert.equal(grants.video?.roomJoin, true);
  assert.equal(grants.video?.canPublish, true);
  assert.equal(grants.video?.canSubscribe, true);
  assert.equal(grants.video?.canPublishData, false);
  await app.close();
});

test("POC join rejects a public signal URL and a bad room name", async () => {
  const open = await buildApp({
    logger: false,
    env: pocEnv({ LIVEKIT_URL: "ws://203.0.113.10:7880" }),
  });
  const rejectedUrl = await open.inject({
    method: "POST",
    url: "/api/v1/poc/join",
    payload: { room: "poc", identity: "win-a" },
  });
  assert.equal(rejectedUrl.statusCode, 400);
  assert.deepEqual(rejectedUrl.json(), { error: "invalid_signal_url" });
  await open.close();

  const names = await buildApp({ logger: false, env: pocEnv() });
  const rejectedRoom = await names.inject({
    method: "POST",
    url: "/api/v1/poc/join",
    payload: { room: "sala um", identity: "win-a" },
  });
  assert.equal(rejectedRoom.statusCode, 400);
  assert.deepEqual(rejectedRoom.json(), { error: "invalid_room" });
  await names.close();
});
