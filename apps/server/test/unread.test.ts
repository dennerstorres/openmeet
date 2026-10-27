import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { applyMigrations, type MigrationClient } from "../src/db/migrate.js";
import type { RoomMedia } from "../src/rooms/media.js";

// ADR 0024 (F13-13): reads, unread and mention counts, and notification levels.
const bootstrapToken = "unit-test-bootstrap-token";
const env = {
  AUTH_SECRET: "unit-test-auth-secret-do-not-leak",
  BOOTSTRAP_TOKEN: bootstrapToken,
  LIVEKIT_URL: "ws://127.0.0.1:7880",
  LIVEKIT_API_KEY: "unit-test-key",
  LIVEKIT_API_SECRET: "unit-test-secret-do-not-leak",
};
const adminPassword = "correct-horse-battery";
const memberPassword = "member-horse-battery";

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

function auth(token: string): { authorization: string } {
  return { authorization: `Bearer ${token}` };
}

interface Person {
  id: string;
  token: string;
}

interface UnreadChat {
  kind: "room" | "dm";
  id: string;
  serverId: string | null;
  lastReadId: string | null;
  unread: number;
  mentions: number;
  level: string | null;
}

interface Unread {
  chats: UnreadChat[];
  servers: { serverId: string; level: string }[];
}

async function person(app: FastifyInstance, adminToken: string, username: string): Promise<Person> {
  const created = await app.inject({
    method: "POST",
    url: "/api/v1/admin/users",
    headers: auth(adminToken),
    payload: { username, password: memberPassword, displayName: username, role: "participant" },
  });
  assert.equal(created.statusCode, 201);
  const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username, password: memberPassword } });
  return { id: (created.json() as { id: string }).id, token: (login.json() as { accessToken: string }).accessToken };
}

async function world() {
  const db = pgliteClient(new PGlite());
  await applyMigrations(db);
  const media: RoomMedia = { disconnect: async () => undefined, closeRoom: async () => undefined };
  const app = await buildApp({ logger: false, env, db, media });
  const created = await app.inject({
    method: "POST",
    url: "/api/v1/auth/bootstrap",
    payload: { token: bootstrapToken, username: "admin", password: adminPassword, displayName: "Admin" },
  });
  const ownerToken = (created.json() as { accessToken: string }).accessToken;
  const ownerId = (await db.query("select id from users where username = 'admin'")).rows[0]?.id as string;
  const owner: Person = { id: ownerId, token: ownerToken };
  const server = await app.inject({ method: "POST", url: "/api/v1/servers", headers: auth(ownerToken), payload: { name: "Família" } });
  const serverId = (server.json() as { id: string }).id;
  const room = await app.inject({
    method: "POST",
    url: `/api/v1/servers/${serverId}/rooms`,
    headers: auth(ownerToken),
    payload: { name: "Geral", slug: "geral", kind: "persistent", channel: "text" },
  });
  assert.equal(room.statusCode, 201);
  const roomId = (room.json() as { id: string }).id;
  const ana = await person(app, ownerToken, "ana");
  const fora = await person(app, ownerToken, "fora");
  await db.query("insert into server_members (server_id, user_id, role) values ($1, $2, 'participant')", [serverId, ana.id]);
  return { app, db, serverId, roomId, owner, ana, fora };
}

type World = Awaited<ReturnType<typeof world>>;

async function call(w: World, who: Person, method: "GET" | "POST", url: string, payload?: Record<string, unknown>) {
  const response = await w.app.inject({ method, url, headers: auth(who.token), ...(method === "POST" ? { payload: payload ?? {} } : {}) });
  return { status: response.statusCode, body: response.json() as unknown };
}

async function unread(w: World, who: Person): Promise<Unread> {
  const found = await call(w, who, "GET", "/api/v1/unread");
  assert.equal(found.status, 200);
  return found.body as Unread;
}

function chat(state: Unread, id: string): UnreadChat | undefined {
  return state.chats.find((item) => item.id === id);
}

test("unread and mentions count what others wrote after the last read, and a read clears them", async () => {
  const w = await world();
  try {
    const say = async (who: Person, body: string) => (await call(w, who, "POST", `/api/v1/rooms/${w.roomId}/messages`, { body })).body as { id: string };
    // Writing reads the chat up to one's own message.
    await say(w.ana, "minha");
    await say(w.owner, "bom dia");
    await say(w.owner, `oi <@${w.ana.id}>`);
    const last = await say(w.owner, "@everyone reunião");

    const before = chat(await unread(w, w.ana), w.roomId);
    assert.deepEqual(before && [before.kind, before.serverId, before.unread, before.mentions, before.level], ["room", w.serverId, 3, 2, null]);
    assert.deepEqual([chat(await unread(w, w.owner), w.roomId)?.unread], [0]);

    const read = await call(w, w.ana, "POST", `/api/v1/rooms/${w.roomId}/read`, { messageId: last.id });
    assert.equal(read.status, 200);
    assert.deepEqual([(read.body as UnreadChat).unread, (read.body as UnreadChat).mentions, (read.body as UnreadChat).lastReadId], [0, 0, last.id]);
    // A read never goes back.
    await call(w, w.ana, "POST", `/api/v1/rooms/${w.roomId}/read`, { messageId: "1" });
    assert.equal(chat(await unread(w, w.ana), w.roomId)?.lastReadId, last.id);

    // Outsiders, unknown messages and bad input.
    assert.equal((await call(w, w.fora, "POST", `/api/v1/rooms/${w.roomId}/read`, { messageId: last.id })).status, 404);
    assert.equal((await call(w, w.ana, "POST", `/api/v1/rooms/${w.roomId}/read`, { messageId: "999999" })).status, 404);
    assert.equal((await call(w, w.ana, "POST", `/api/v1/rooms/${w.roomId}/read`, { messageId: 7 })).status, 400);
    assert.equal(chat(await unread(w, w.fora), w.roomId), undefined);
  } finally {
    await w.app.close();
  }
});

test("DMs count too, and only for their members", async () => {
  const w = await world();
  try {
    const opened = await call(w, w.owner, "POST", "/api/v1/dms", { userIds: [w.ana.id] });
    const dmId = (opened.body as { id: string }).id;
    const sent = (await call(w, w.owner, "POST", `/api/v1/dms/${dmId}/messages`, { body: "particular" })).body as { id: string };
    const held = chat(await unread(w, w.ana), dmId);
    assert.deepEqual(held && [held.kind, held.serverId, held.unread], ["dm", null, 1]);
    assert.equal((await call(w, w.fora, "POST", `/api/v1/dms/${dmId}/read`, { messageId: sent.id })).status, 404);
    // No message named: read up to the newest.
    const read = (await call(w, w.ana, "POST", `/api/v1/dms/${dmId}/read`, {})).body as UnreadChat;
    assert.deepEqual([read.unread, read.lastReadId], [0, sent.id]);
  } finally {
    await w.app.close();
  }
});

test("notification levels are kept per server, room and DM, and only for members", async () => {
  const w = await world();
  try {
    const set = (who: Person, scope: string, id: string, level: unknown) => call(w, who, "POST", "/api/v1/notify-prefs", { scope, id, level });
    const server = await set(w.ana, "server", w.serverId, "none");
    assert.equal(server.status, 200);
    assert.deepEqual((server.body as Unread).servers, [{ serverId: w.serverId, level: "none" }]);
    assert.equal(chat((await set(w.ana, "room", w.roomId, "all")).body as Unread, w.roomId)?.level, "all");
    // Setting again replaces; null goes back to following the server.
    assert.equal(chat((await set(w.ana, "room", w.roomId, "mentions")).body as Unread, w.roomId)?.level, "mentions");
    assert.equal(chat((await set(w.ana, "room", w.roomId, null)).body as Unread, w.roomId)?.level, null);
    assert.equal((await w.db.query("select count(*)::int as total from notify_prefs")).rows[0]?.total, 1);

    assert.equal((await set(w.ana, "room", w.roomId, "loud")).status, 400);
    assert.equal((await set(w.ana, "planet", w.roomId, "all")).status, 400);
    assert.equal((await set(w.fora, "server", w.serverId, "all")).status, 404);
    assert.equal((await set(w.fora, "room", w.roomId, "all")).status, 404);
  } finally {
    await w.app.close();
  }
});
