import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { applyMigrations, type MigrationClient } from "../src/db/migrate.js";
import type { RoomMedia } from "../src/rooms/media.js";

// ADR 0024: text room messages, their permissions, cursors and limits.
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

interface World {
  app: FastifyInstance;
  db: MigrationClient;
  logs: string[];
  serverId: string;
  roomId: string;
  voiceId: string;
  owner: string;
  moderator: string;
  member: string;
  outsider: string;
  memberId: string;
}

interface Message {
  id: string;
  authorId: string;
  body: string;
  replyTo: { id: string; authorId: string; body: string; deleted: boolean } | null;
  pinned: boolean;
  edited: boolean;
  deleted: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

interface Page {
  messages: Message[];
  hasMore: boolean;
}

async function login(app: FastifyInstance, username: string, password: string): Promise<string> {
  const response = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username, password } });
  assert.equal(response.statusCode, 200);
  return (response.json() as { accessToken: string }).accessToken;
}

async function account(app: FastifyInstance, adminToken: string, username: string, displayName: string): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/admin/users",
    headers: auth(adminToken),
    payload: { username, password: memberPassword, displayName, role: "participant" },
  });
  assert.equal(response.statusCode, 201);
  return (response.json() as { id: string }).id;
}

async function world(): Promise<World> {
  const db = pgliteClient(new PGlite());
  await applyMigrations(db);
  const media: RoomMedia = { disconnect: async () => undefined, closeRoom: async () => undefined };
  const logs: string[] = [];
  const app = await buildApp({ env, db, media, logStream: { write: (line) => void logs.push(line) } });
  const created = await app.inject({
    method: "POST",
    url: "/api/v1/auth/bootstrap",
    payload: { token: bootstrapToken, username: "admin", password: adminPassword, displayName: "Admin" },
  });
  assert.equal(created.statusCode, 201);
  const owner = (created.json() as { accessToken: string }).accessToken;
  const server = await app.inject({ method: "POST", url: "/api/v1/servers", headers: auth(owner), payload: { name: "Família" } });
  const serverId = (server.json() as { id: string }).id;
  const room = async (slug: string, channel: string | undefined) => {
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/servers/${serverId}/rooms`,
      headers: auth(owner),
      payload: { name: slug, slug, kind: "persistent", channel },
    });
    assert.equal(response.statusCode, 201);
    return response.json() as { id: string; channel: string };
  };
  const text = await room("geral", "text");
  assert.equal(text.channel, "text");
  const voice = await room("voz", undefined);
  assert.equal(voice.channel, "voice");
  const moderatorId = await account(app, owner, "mod", "Moderadora");
  const memberId = await account(app, owner, "ana", "Ana");
  await account(app, owner, "fora", "Fora");
  await db.query("insert into server_members (server_id, user_id, role) values ($1, $2, 'moderator'), ($1, $3, 'participant')", [
    serverId,
    moderatorId,
    memberId,
  ]);
  return {
    app,
    db,
    logs,
    serverId,
    roomId: text.id,
    voiceId: voice.id,
    owner,
    moderator: await login(app, "mod", memberPassword),
    member: await login(app, "ana", memberPassword),
    outsider: await login(app, "fora", memberPassword),
    memberId,
  };
}

async function send(w: World, token: string, body: unknown, replyToId?: string, room = w.roomId) {
  return w.app.inject({ method: "POST", url: `/api/v1/rooms/${room}/messages`, headers: auth(token), payload: { body, replyToId } });
}

async function page(w: World, token: string, query = "", room = w.roomId): Promise<{ status: number; page: Page }> {
  const response = await w.app.inject({ method: "GET", url: `/api/v1/rooms/${room}/messages${query}`, headers: auth(token) });
  return { status: response.statusCode, page: response.json() as Page };
}

async function act(w: World, token: string, id: string, action: string, payload: Record<string, unknown> = {}) {
  return w.app.inject({ method: "POST", url: `/api/v1/messages/${id}/${action}`, headers: auth(token), payload });
}

test("members of the server talk in a text room; outsiders and voice rooms stay closed", async () => {
  const w = await world();
  try {
    const sent = await send(w, w.member, "olá\r\npessoal");
    assert.equal(sent.statusCode, 201);
    const message = sent.json() as Message;
    assert.equal(message.body, "olá\npessoal");
    assert.equal(message.canEdit, true);

    const seen = await page(w, w.owner);
    assert.equal(seen.status, 200);
    assert.equal(seen.page.messages.length, 1);
    assert.equal(seen.page.messages[0]?.canEdit, false);
    assert.equal(seen.page.messages[0]?.canDelete, true);

    assert.equal((await page(w, w.outsider)).status, 404);
    assert.equal((await send(w, w.outsider, "intruso")).statusCode, 404);
    assert.equal((await act(w, w.outsider, message.id, "delete")).statusCode, 404);
    assert.equal((await w.app.inject({ method: "GET", url: `/api/v1/rooms/${w.roomId}/messages` })).statusCode, 401);

    assert.equal((await send(w, w.member, "aqui não", undefined, w.voiceId)).statusCode, 409);
    const join = await w.app.inject({ method: "POST", url: `/api/v1/rooms/${w.roomId}/join`, headers: auth(w.member), payload: {} });
    assert.equal(join.statusCode, 409);
    const temporary = await w.app.inject({
      method: "POST",
      url: `/api/v1/servers/${w.serverId}/rooms`,
      headers: auth(w.owner),
      payload: { name: "Rápida", slug: "rapida", kind: "temporary", channel: "text" },
    });
    assert.equal(temporary.statusCode, 400);

    await w.app.inject({ method: "POST", url: `/api/v1/rooms/${w.roomId}/delete`, headers: auth(w.owner), payload: {} });
    assert.equal((await page(w, w.owner)).status, 404);
    await w.db.query("update rooms set deleted_at = null where id = $1", [w.roomId]);
    await w.db.query("update server_members set removed_at = now() where user_id = $1", [w.memberId]);
    assert.equal((await page(w, w.member)).status, 404);
    assert.equal((await send(w, w.member, "voltei")).statusCode, 404);
  } finally {
    await w.app.close();
  }
});

test("bodies are refused when empty, too long or hidden, and never reach the logs", async () => {
  const w = await world();
  try {
    for (const body of ["", "   \n ", "a".repeat(4001), "oi\u0007", "link‮evil", 42, undefined]) {
      const refused = await send(w, w.member, body);
      assert.equal(refused.statusCode, 400);
      assert.equal((refused.json() as { error: string }).error, "invalid_message");
    }
    assert.equal((await send(w, w.owner, "😀".repeat(4000))).statusCode, 201);
    const secret = "segredo-que-nao-pode-vazar";
    const sent = (await send(w, w.owner, secret)).json() as Message;
    await act(w, w.owner, sent.id, "edit", { body: `${secret}-editado` });
    await w.app.inject({ method: "POST", url: `/api/v1/rooms/${w.roomId}/messages/search`, headers: auth(w.owner), payload: { query: secret } });
    assert.ok(w.logs.length > 0);
    assert.equal(
      w.logs.some((line) => line.includes(secret)),
      false,
    );
  } finally {
    await w.app.close();
  }
});

test("pages walk back with before and catch up with after, without gaps or repeats", async () => {
  const w = await world();
  try {
    for (let index = 1; index <= 60; index += 1) {
      await w.db.query("insert into messages (room_id, author_id, body) values ($1, $2, $3)", [w.roomId, w.memberId, `m${index}`]);
    }
    const newest = await page(w, w.member);
    assert.equal(newest.page.messages.length, 50);
    assert.equal(newest.page.hasMore, true);
    assert.equal(newest.page.messages[0]?.body, "m11");
    assert.equal(newest.page.messages[49]?.body, "m60");

    const older = await page(w, w.member, `?before=${newest.page.messages[0]?.id}`);
    assert.deepEqual(
      older.page.messages.map((message) => message.body),
      Array.from({ length: 10 }, (_, index) => `m${index + 1}`),
    );
    assert.equal(older.page.hasMore, false);

    const sent = (await send(w, w.member, "nova")).json() as Message;
    const caught = await page(w, w.member, `?after=${newest.page.messages[49]?.id}`);
    assert.deepEqual(
      caught.page.messages.map((message) => message.id),
      [sent.id],
    );
    assert.equal((await page(w, w.member, "?after=abc")).status, 400);
    assert.equal((await page(w, w.member, "?after=1&before=2")).status, 400);
  } finally {
    await w.app.close();
  }
});

test("authors edit their own, moderators remove and pin, removed text is gone", async () => {
  const w = await world();
  try {
    const first = (await send(w, w.member, "primeira")).json() as Message;
    const reply = await send(w, w.owner, "resposta", first.id);
    assert.equal(reply.statusCode, 201);
    assert.equal((reply.json() as Message).replyTo?.body, "primeira");
    assert.equal((await send(w, w.owner, "fantasma", "999999")).statusCode, 404);

    assert.equal((await act(w, w.moderator, first.id, "edit", { body: "não é minha" })).statusCode, 403);
    const edited = await act(w, w.member, first.id, "edit", { body: "primeira, corrigida" });
    assert.equal(edited.statusCode, 200);
    assert.equal((edited.json() as Message).edited, true);

    assert.equal((await act(w, w.member, first.id, "pin", { pinned: true })).statusCode, 403);
    assert.equal((await act(w, w.moderator, first.id, "pin", { pinned: true })).statusCode, 200);
    const pins = await w.app.inject({ method: "GET", url: `/api/v1/rooms/${w.roomId}/pins`, headers: auth(w.member) });
    assert.deepEqual(
      (pins.json() as { messages: Message[] }).messages.map((message) => message.id),
      [first.id],
    );

    const ownerReply = (reply.json() as Message).id;
    assert.equal((await act(w, w.member, ownerReply, "delete")).statusCode, 403);
    await w.db.query("insert into message_reactions (message_id, user_id, emoji) values ($1, $2, '👍')", [first.id, w.memberId]);
    const removed = (await act(w, w.moderator, first.id, "delete")).json() as Message;
    assert.deepEqual({ body: removed.body, deleted: removed.deleted, pinned: removed.pinned }, { body: "", deleted: true, pinned: false });
    const stored = await w.db.query("select body from messages where id = $1", [first.id]);
    assert.equal(stored.rows[0]?.body, "");
    const reactions = await w.db.query("select count(*)::int as total from message_reactions");
    assert.equal(reactions.rows[0]?.total, 0);
    assert.equal((await act(w, w.member, first.id, "edit", { body: "volta" })).statusCode, 404);
    assert.equal((await act(w, w.moderator, first.id, "delete")).statusCode, 404);

    const shown = (await page(w, w.member)).page.messages.find((message) => message.id === ownerReply);
    assert.equal(shown?.replyTo?.deleted, true);
    assert.equal(shown?.replyTo?.body, "");
  } finally {
    await w.app.close();
  }
});

test("search finds words in live messages, and sending is rate limited", async () => {
  const w = await world();
  try {
    await send(w, w.member, "vamos jogar amanhã");
    const gone = (await send(w, w.member, "jogar hoje não")).json() as Message;
    await send(w, w.member, "outra coisa");
    await act(w, w.member, gone.id, "delete");
    const search = (query: string) =>
      w.app.inject({ method: "POST", url: `/api/v1/rooms/${w.roomId}/messages/search`, headers: auth(w.member), payload: { query } });
    const found = await search("jogar");
    assert.equal(found.statusCode, 200);
    assert.deepEqual(
      (found.json() as Page).messages.map((message) => message.body),
      ["vamos jogar amanhã"],
    );
    assert.equal((await search(" ")).statusCode, 400);

    for (let index = 0; index < 7; index += 1) assert.equal((await send(w, w.member, `rajada ${index}`)).statusCode, 201);
    assert.equal((await send(w, w.member, "demais")).statusCode, 429);
    assert.equal((await send(w, w.owner, "outra pessoa")).statusCode, 201);
  } finally {
    await w.app.close();
  }
});
