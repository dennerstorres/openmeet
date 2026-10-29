import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { applyMigrations, type MigrationClient } from "../src/db/migrate.js";
import { pushEndpoint } from "../src/rooms/push.js";

// ADR 0027 (F14-04): Web Push subscriptions — only the owner sees or removes them, only push services are accepted.
const bootstrapToken = "unit-test-bootstrap-token";
const vapidPublic = "B".repeat(87);
const baseEnv = { AUTH_SECRET: "unit-test-auth-secret-do-not-leak", BOOTSTRAP_TOKEN: bootstrapToken };
const env = { ...baseEnv, VAPID_PUBLIC_KEY: vapidPublic, VAPID_PRIVATE_KEY: "unit-test-vapid-private-do-not-leak" };
const password = "correct-horse-battery";
const p256dh = "A".repeat(87);
const authKey = "C".repeat(22);
const endpoint = "https://fcm.googleapis.com/fcm/send/abc123";

function pgliteClient(db: PGlite): MigrationClient {
  const client: MigrationClient = {
    exec: async (statement) => {
      await db.exec(statement);
    },
    query: async (statement, params) => {
      const result = await db.query<Record<string, unknown>>(statement, params === undefined ? [] : [...params]);
      return { rows: result.rows.map((row) => ({ ...row })) };
    },
    transaction: async (run) => {
      await db.exec("begin");
      try {
        const value = await run(client);
        await db.exec("commit");
        return value;
      } catch (error) {
        await db.exec("rollback");
        throw error;
      }
    },
  };
  return client;
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function world(appEnv: Record<string, string> = env) {
  const db = pgliteClient(new PGlite());
  await applyMigrations(db);
  const app: FastifyInstance = await buildApp({ logger: false, env: appEnv, db });
  const created = await app.inject({
    method: "POST",
    url: "/api/v1/auth/bootstrap",
    payload: { token: bootstrapToken, username: "admin", password, displayName: "Admin" },
  });
  const admin = (created.json() as { accessToken: string }).accessToken;
  await app.inject({
    method: "POST",
    url: "/api/v1/admin/users",
    headers: auth(admin),
    payload: { username: "ana", password, displayName: "Ana", role: "participant" },
  });
  const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "ana", password } });
  const ana = (login.json() as { accessToken: string }).accessToken;
  const rows = async () =>
    (await db.query("select u.username, p.endpoint from push_subscriptions p join users u on u.id = p.user_id order by u.username")).rows;
  const subscribe = (token: string, body: Record<string, unknown>) =>
    app.inject({ method: "POST", url: "/api/v1/push/subscriptions", headers: auth(token), payload: body });
  const unsubscribe = (token: string, target: string) =>
    app.inject({ method: "DELETE", url: "/api/v1/push/subscriptions", headers: auth(token), payload: { endpoint: target } });
  return { app, db, admin, ana, rows, subscribe, unsubscribe };
}

test("only the browsers' push services are accepted as endpoints", () => {
  for (const ok of [
    endpoint,
    "https://updates.push.services.mozilla.com/wpush/v2/x",
    "https://wns2-par02p.notify.windows.com/w/?token=x",
    "https://web.push.apple.com/QGx",
  ]) {
    assert.ok(pushEndpoint(ok), ok);
  }
  for (const bad of [
    "http://fcm.googleapis.com/fcm/send/x",
    "https://127.0.0.1/x",
    "https://localhost/x",
    "https://evil.example.com/fcm.googleapis.com",
    "https://fcm.googleapis.com.evil.com/x",
    "https://user:pw@fcm.googleapis.com/x",
    "https://fcm.googleapis.com:8443/x",
    `https://fcm.googleapis.com/${"x".repeat(2048)}`,
    42,
  ]) {
    assert.equal(pushEndpoint(bad), undefined, String(bad).slice(0, 60));
  }
});

test("the key route needs a session and answers 404 without a VAPID pair", async () => {
  const w = await world();
  assert.equal((await w.app.inject({ method: "GET", url: "/api/v1/push/key" })).statusCode, 401);
  const key = await w.app.inject({ method: "GET", url: "/api/v1/push/key", headers: auth(w.ana) });
  assert.equal(key.statusCode, 200);
  assert.deepEqual(key.json(), { publicKey: vapidPublic });
  assert.equal(JSON.stringify(key.json()).includes("private"), false);
  await w.app.close();

  const bare = await world(baseEnv);
  assert.equal((await bare.app.inject({ method: "GET", url: "/api/v1/push/key", headers: auth(bare.ana) })).statusCode, 404);
  assert.equal((await bare.subscribe(bare.ana, { endpoint, keys: { p256dh, auth: authKey } })).statusCode, 404);
  await bare.app.close();
});

test("subscribing stores one row per browser, and a new sign-in in that browser moves it", async () => {
  const w = await world();
  assert.equal((await w.subscribe(w.ana, { endpoint, keys: { p256dh, auth: authKey } })).statusCode, 204);
  assert.equal((await w.subscribe(w.ana, { endpoint, keys: { p256dh, auth: authKey } })).statusCode, 204);
  assert.deepEqual(await w.rows(), [{ username: "ana", endpoint }]);

  assert.equal((await w.subscribe(w.admin, { endpoint, keys: { p256dh, auth: authKey } })).statusCode, 204);
  assert.deepEqual(await w.rows(), [{ username: "admin", endpoint }]);
  await w.app.close();
});

test("bad bodies and unauthenticated calls are refused", async () => {
  const w = await world();
  assert.equal(
    (await w.app.inject({ method: "POST", url: "/api/v1/push/subscriptions", payload: { endpoint, keys: { p256dh, auth: authKey } } })).statusCode,
    401,
  );
  for (const body of [
    {},
    { endpoint: "https://evil.example.com/x", keys: { p256dh, auth: authKey } },
    { endpoint, keys: { p256dh: "short", auth: authKey } },
    { endpoint, keys: { p256dh, auth: "x" } },
    { endpoint, keys: "nope" },
  ]) {
    const response = await w.subscribe(w.ana, body);
    assert.equal(response.statusCode, 400, JSON.stringify(body));
    assert.deepEqual(response.json(), { error: "invalid_subscription" });
  }
  assert.deepEqual(await w.rows(), []);
  await w.app.close();
});

test("only the owner removes a subscription; someone else's endpoint is left alone", async () => {
  const w = await world();
  await w.subscribe(w.ana, { endpoint, keys: { p256dh, auth: authKey } });
  assert.equal((await w.unsubscribe(w.admin, endpoint)).statusCode, 204);
  assert.deepEqual(await w.rows(), [{ username: "ana", endpoint }]);
  assert.equal((await w.unsubscribe(w.ana, endpoint)).statusCode, 204);
  assert.deepEqual(await w.rows(), []);
  assert.equal((await w.app.inject({ method: "DELETE", url: "/api/v1/push/subscriptions", payload: { endpoint } })).statusCode, 401);
  await w.app.close();
});

test("an account keeps at most 20 subscriptions, newest first, and writes are rate limited", async () => {
  const w = await world();
  for (let i = 0; i < 22; i++) {
    await w.db.query(
      "insert into push_subscriptions (user_id, endpoint, p256dh, auth, created_at) select id, $1, $2, $3, now() - interval '1 day' + ($4 || ' minutes')::interval from users where username = 'ana'",
      [`https://fcm.googleapis.com/fcm/send/old${i}`, p256dh, authKey, String(i)],
    );
  }
  assert.equal((await w.subscribe(w.ana, { endpoint, keys: { p256dh, auth: authKey } })).statusCode, 204);
  const kept = (await w.rows()).map((row) => row.endpoint);
  assert.equal(kept.length, 20);
  assert.ok(kept.includes(endpoint));
  assert.equal(kept.includes("https://fcm.googleapis.com/fcm/send/old0"), false);

  let limited = false;
  for (let i = 0; i < 12; i++) {
    if ((await w.subscribe(w.ana, { endpoint, keys: { p256dh, auth: authKey } })).statusCode === 429) limited = true;
  }
  assert.ok(limited);
  await w.app.close();
});
