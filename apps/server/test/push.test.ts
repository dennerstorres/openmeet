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

// ADR 0027 (F14-05): who gets a push for a new message, with a sender that never touches the network.
async function chatWorld(status = 201) {
  const db = pgliteClient(new PGlite());
  await applyMigrations(db);
  const sent: { endpoint: string; payload: Record<string, unknown> }[] = [];
  const pushSender = async (target: { endpoint: string }, payload: string) => {
    sent.push({ endpoint: target.endpoint, payload: JSON.parse(payload) as Record<string, unknown> });
    return status;
  };
  const app: FastifyInstance = await buildApp({ logger: false, env, db, pushSender });
  const created = await app.inject({
    method: "POST",
    url: "/api/v1/auth/bootstrap",
    payload: { token: bootstrapToken, username: "admin", password, displayName: "Admin" },
  });
  const admin = (created.json() as { accessToken: string }).accessToken;
  const people: Record<string, { id: string; token: string }> = {};
  for (const name of ["ana", "bia"]) {
    const user = await app.inject({
      method: "POST",
      url: "/api/v1/admin/users",
      headers: auth(admin),
      payload: { username: name, password, displayName: name === "ana" ? "Ana" : "Bia", role: "participant" },
    });
    const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: name, password } });
    people[name] = { id: (user.json() as { id: string }).id, token: (login.json() as { accessToken: string }).accessToken };
  }
  const ana = people.ana as { id: string; token: string };
  const bia = people.bia as { id: string; token: string };
  const server = await app.inject({ method: "POST", url: "/api/v1/servers", headers: auth(admin), payload: { name: "Família" } });
  const serverId = (server.json() as { id: string }).id;
  const room = await app.inject({
    method: "POST",
    url: `/api/v1/servers/${serverId}/rooms`,
    headers: auth(admin),
    payload: { name: "Geral", slug: "geral", kind: "persistent", channel: "text" },
  });
  const roomId = (room.json() as { id: string }).id;
  for (const who of [ana, bia]) {
    await db.query("insert into server_members (server_id, user_id, role) values ($1, $2, 'participant')", [serverId, who.id]);
  }
  for (const [who, name] of [
    [ana, "ana"],
    [bia, "bia"],
  ] as const) {
    const ok = await app.inject({
      method: "POST",
      url: "/api/v1/push/subscriptions",
      headers: auth(who.token),
      payload: { endpoint: `https://fcm.googleapis.com/fcm/send/${name}`, keys: { p256dh, auth: authKey } },
    });
    assert.equal(ok.statusCode, 204);
  }
  const say = async (token: string, url: string, payload: Record<string, unknown>) => {
    const response = await app.inject({ method: "POST", url, headers: auth(token), payload });
    assert.equal(response.statusCode, 201, response.body);
    return response.json() as { id: string };
  };
  // Pushes leave after the answer; closing the app waits for them.
  const settle = async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  };
  return { app, db, admin, ana, bia, serverId, roomId, sent, say, settle };
}

test("a room pushes only a mention or a reply, never to the author", async () => {
  const w = await chatWorld();
  await w.say(w.admin, `/api/v1/rooms/${w.roomId}/messages`, { body: "bom dia a todos" });
  await w.settle();
  assert.equal(w.sent.length, 0);

  await w.say(w.ana.token, `/api/v1/rooms/${w.roomId}/messages`, { body: `oi <@${w.bia.id}>, olha   isso` });
  await w.settle();
  assert.equal(w.sent.length, 1);
  assert.equal(w.sent[0]?.endpoint, "https://fcm.googleapis.com/fcm/send/bia");
  const payload = w.sent[0]?.payload ?? {};
  assert.equal(payload.type, "mention");
  assert.equal(payload.authorName, "Ana");
  assert.equal(payload.roomName, "Geral");
  assert.equal(payload.serverId, w.serverId);
  assert.equal(payload.excerpt, "oi @, olha isso");
  assert.deepEqual(payload.chat, { kind: "room", id: w.roomId });

  const original = await w.say(w.bia.token, `/api/v1/rooms/${w.roomId}/messages`, { body: "alguém?" });
  w.sent.length = 0;
  await w.say(w.ana.token, `/api/v1/rooms/${w.roomId}/messages`, { body: "eu", replyToId: original.id });
  await w.settle();
  assert.deepEqual(
    w.sent.map((item) => [item.endpoint.split("/").pop(), item.payload.type]),
    [["bia", "reply"]],
  );
  await w.app.close();
});

test("a DM pushes every message at 'all', nothing at 'none', and never to who blocked the author", async () => {
  const w = await chatWorld();
  const dm = await w.app.inject({ method: "POST", url: "/api/v1/dms", headers: auth(w.admin), payload: { userIds: [w.ana.id, w.bia.id], name: "Trio" } });
  assert.equal(dm.statusCode, 201, dm.body);
  const dmId = (dm.json() as { id: string }).id;
  await w.say(w.admin, `/api/v1/dms/${dmId}/messages`, { body: "jantar?" });
  await w.settle();
  assert.deepEqual(w.sent.map((item) => item.endpoint.split("/").pop()).sort(), ["ana", "bia"]);
  assert.equal(w.sent[0]?.payload.type, "dm");
  assert.deepEqual(w.sent[0]?.payload.chat, { kind: "dm", id: dmId });

  const silenced = await w.app.inject({
    method: "POST",
    url: "/api/v1/notify-prefs",
    headers: auth(w.ana.token),
    payload: { scope: "dm", id: dmId, level: "none" },
  });
  assert.equal(silenced.statusCode, 200, silenced.body);
  const adminId = (await w.db.query("select id::text as id from users where username = 'admin'")).rows[0]?.id as string;
  const blocked = await w.app.inject({ method: "POST", url: `/api/v1/users/${adminId}/block`, headers: auth(w.bia.token), payload: { blocked: true } });
  assert.ok(blocked.statusCode < 300, blocked.body);
  w.sent.length = 0;
  await w.say(w.admin, `/api/v1/dms/${dmId}/messages`, { body: `<@${w.ana.id}> <@${w.bia.id}> e aí?` });
  await w.settle();
  assert.equal(w.sent.length, 0);
  await w.app.close();
});

test("a gone subscription is dropped and a delivered one is stamped", async () => {
  const gone = await chatWorld(410);
  await gone.say(gone.ana.token, `/api/v1/rooms/${gone.roomId}/messages`, { body: `<@${gone.bia.id}>` });
  await gone.app.close();
  const left = (await gone.db.query("select endpoint from push_subscriptions order by endpoint")).rows.map((row) => row.endpoint);
  assert.deepEqual(left, ["https://fcm.googleapis.com/fcm/send/ana"]);

  const ok = await chatWorld(201);
  await ok.say(ok.ana.token, `/api/v1/rooms/${ok.roomId}/messages`, { body: `<@${ok.bia.id}> ${"x".repeat(400)}` });
  await ok.app.close();
  const rows = (await ok.db.query("select endpoint, last_used_at is not null as used from push_subscriptions order by endpoint")).rows;
  assert.deepEqual(
    rows.map((row) => [row.endpoint, row.used]),
    [
      ["https://fcm.googleapis.com/fcm/send/ana", false],
      ["https://fcm.googleapis.com/fcm/send/bia", true],
    ],
  );
  assert.ok(String(ok.sent[0]?.payload.excerpt).length <= 120);
});
