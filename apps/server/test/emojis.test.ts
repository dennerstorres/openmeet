import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { applyMigrations, type MigrationClient } from "../src/db/migrate.js";
import type { RoomMedia } from "../src/rooms/media.js";

// ADR 0024 / F13-10: server emojis, their limits and how messages and reactions resolve them.
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

function u32be(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function ascii(value: string): number[] {
  return [...value].map((char) => char.charCodeAt(0));
}

function png(side: number, salt = 0): string {
  return Buffer.from([
    ...[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    ...u32be(13),
    ...ascii("IHDR"),
    ...u32be(side),
    ...u32be(side),
    ...[8, 6, 0, 0, 0],
    ...u32be(salt),
    ...u32be(0),
    ...ascii("IEND"),
    ...[0xae, 0x42, 0x60, 0x82],
  ]).toString("base64");
}

/** A GIF with two one-pixel frames: animated. */
function animatedGif(): string {
  const frame = [0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0x02, 0x02, 0x44, 0x01, 0x00];
  return Buffer.from([...ascii("GIF89a"), 1, 0, 1, 0, 0x80, 0, 0, 0, 0, 0, 0xff, 0xff, 0xff, ...frame, ...frame, 0x3b]).toString("base64");
}

interface World {
  app: FastifyInstance;
  db: MigrationClient;
  serverId: string;
  otherServerId: string;
  roomId: string;
  owner: string;
  ownerId: string;
  moderator: string;
  moderatorId: string;
  member: string;
  outsider: string;
}

interface Emoji {
  id: string;
  serverId: string;
  name: string;
  animated: boolean;
}

interface Message {
  id: string;
  body: string;
  reactions: { emoji: string; userIds: string[] }[];
  emojis: { id: string; name: string; animated: boolean; removed: boolean }[];
}

async function world(): Promise<World> {
  const db = pgliteClient(new PGlite());
  await applyMigrations(db);
  const media: RoomMedia = { disconnect: async () => undefined, closeRoom: async () => undefined };
  const app = await buildApp({ env, db, media });
  const created = await app.inject({
    method: "POST",
    url: "/api/v1/auth/bootstrap",
    payload: { token: bootstrapToken, username: "admin", password: adminPassword, displayName: "Admin" },
  });
  assert.equal(created.statusCode, 201);
  const owner = (created.json() as { accessToken: string }).accessToken;
  const server = await app.inject({ method: "POST", url: "/api/v1/servers", headers: auth(owner), payload: { name: "Família" } });
  const serverId = (server.json() as { id: string }).id;
  const other = await app.inject({ method: "POST", url: "/api/v1/servers", headers: auth(owner), payload: { name: "Outro" } });
  const otherServerId = (other.json() as { id: string }).id;
  const room = await app.inject({
    method: "POST",
    url: `/api/v1/servers/${serverId}/rooms`,
    headers: auth(owner),
    payload: { name: "geral", slug: "geral", kind: "persistent", channel: "text" },
  });
  assert.equal(room.statusCode, 201);
  const moderatorId = await account(app, owner, "mod", "Moderadora");
  const memberId = await account(app, owner, "ana", "Ana");
  await account(app, owner, "fora", "Fora");
  await db.query("insert into server_members (server_id, user_id, role) values ($1, $2, 'moderator'), ($1, $3, 'participant')", [
    serverId,
    moderatorId,
    memberId,
  ]);
  const admin = await db.query("select id::text as id from users where username = 'admin'");
  return {
    app,
    db,
    serverId,
    otherServerId,
    roomId: (room.json() as { id: string }).id,
    owner,
    ownerId: String(admin.rows[0]?.id),
    moderator: await login(app, "mod", memberPassword),
    moderatorId,
    member: await login(app, "ana", memberPassword),
    outsider: await login(app, "fora", memberPassword),
  };
}

async function upload(w: World, token: string, name: string, image: string, server = w.serverId) {
  return w.app.inject({ method: "POST", url: `/api/v1/servers/${server}/emojis`, headers: auth(token), payload: { name, image } });
}

async function post(w: World, token: string, url: string, payload: Record<string, unknown> = {}) {
  return w.app.inject({ method: "POST", url, headers: auth(token), payload });
}

async function send(w: World, token: string, body: string): Promise<Message> {
  const response = await post(w, token, `/api/v1/rooms/${w.roomId}/messages`, { body });
  assert.equal(response.statusCode, 201);
  return response.json() as Message;
}

async function latest(w: World, token: string): Promise<Message | undefined> {
  const response = await w.app.inject({ method: "GET", url: `/api/v1/rooms/${w.roomId}/messages`, headers: auth(token) });
  assert.equal(response.statusCode, 200);
  return (response.json() as { messages: Message[] }).messages.at(-1);
}

test("owner and moderators send, rename and remove emojis; participants get 403 and outsiders 404", async () => {
  const w = await world();
  try {
    assert.equal((await upload(w, w.member, "festa", png(64))).statusCode, 403);
    assert.equal((await upload(w, w.outsider, "festa", png(64))).statusCode, 404);
    const sent = await upload(w, w.owner, "festa", png(64));
    assert.equal(sent.statusCode, 201);
    const emoji = sent.json() as Emoji;
    assert.equal(emoji.name, "festa");
    assert.equal(emoji.animated, false);
    assert.equal((await upload(w, w.moderator, "gato", animatedGif())).statusCode, 201);

    const listed = await w.app.inject({ method: "GET", url: `/api/v1/servers/${w.serverId}/emojis`, headers: auth(w.member) });
    assert.equal(listed.statusCode, 200);
    const library = listed.json() as { emojis: Emoji[]; canManage: boolean };
    assert.deepEqual(
      library.emojis.map((item) => [item.name, item.animated]),
      [
        ["festa", false],
        ["gato", true],
      ],
    );
    assert.equal(library.canManage, false);
    const mine = await w.app.inject({ method: "GET", url: "/api/v1/emojis", headers: auth(w.member) });
    assert.equal((mine.json() as { emojis: Emoji[] }).emojis.length, 2);
    assert.deepEqual((await w.app.inject({ method: "GET", url: "/api/v1/emojis", headers: auth(w.outsider) })).json(), { emojis: [] });

    const picture = await w.app.inject({ method: "GET", url: `/api/v1/emojis/${emoji.id}`, headers: auth(w.member) });
    assert.equal(picture.statusCode, 200);
    assert.equal(picture.headers["content-type"], "image/png");
    assert.equal(picture.headers["x-content-type-options"], "nosniff");
    assert.equal((await w.app.inject({ method: "GET", url: `/api/v1/emojis/${emoji.id}`, headers: auth(w.outsider) })).statusCode, 404);

    const rename = (token: string, name: string) => post(w, token, `/api/v1/emojis/${emoji.id}/rename`, { name });
    assert.equal((await rename(w.member, "festinha")).statusCode, 403);
    assert.equal((await rename(w.outsider, "festinha")).statusCode, 404);
    assert.equal((await rename(w.owner, "a")).statusCode, 400);
    assert.equal((await rename(w.moderator, "festinha")).statusCode, 200);
    const remove = (token: string) => post(w, token, `/api/v1/emojis/${emoji.id}/delete`);
    assert.equal((await remove(w.member)).statusCode, 403);
    assert.equal((await remove(w.moderator)).statusCode, 200);
    assert.equal((await remove(w.moderator)).statusCode, 404);
    const audited = await w.db.query("select action from audit_events where action like 'emoji_%' order by created_at, action");
    assert.deepEqual(
      audited.rows.map((row) => row.action),
      ["emoji_upload", "emoji_upload", "emoji_rename", "emoji_delete"],
    );
  } finally {
    await w.app.close();
  }
});

test("only PNG, GIF or WebP up to 256 KB, 50 of each kind and a name unique per server", async () => {
  const w = await world();
  try {
    assert.equal((await upload(w, w.owner, "texto", Buffer.from("<svg/>").toString("base64"))).statusCode, 400);
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0xff, 0xd9]).toString("base64");
    assert.equal((await upload(w, w.owner, "foto", jpeg)).statusCode, 400);
    const huge = Buffer.concat([Buffer.from(png(64), "base64"), Buffer.alloc(256 * 1024)]).toString("base64");
    const tooLarge = await upload(w, w.owner, "grande", huge);
    assert.equal(tooLarge.statusCode, 413);
    assert.equal((tooLarge.json() as { error: string }).error, "emoji_too_large");
    assert.equal((await upload(w, w.owner, "x", png(64))).statusCode, 400);
    assert.equal((await upload(w, w.owner, "com espaço", png(64))).statusCode, 400);
    assert.equal((await upload(w, w.owner, "enorme", png(512))).statusCode, 400);

    assert.equal((await upload(w, w.owner, "Festa", png(64))).statusCode, 201);
    const taken = await upload(w, w.owner, "festa", png(64, 1));
    assert.equal(taken.statusCode, 409);
    assert.equal((taken.json() as { error: string }).error, "emoji_name_taken");
    // Another server keeps its own names.
    assert.equal((await upload(w, w.owner, "festa", png(64, 1), w.otherServerId)).statusCode, 201);

    await w.db.query(
      `insert into server_emojis (server_id, name, content_type, animated, bytes, byte_size, sha256, created_by)
       select $1::uuid, 'e' || g, 'image/png', false, $2::bytea, octet_length($2::bytea), repeat('a', 64), $3::uuid from generate_series(1, 49) g`,
      [w.serverId, Buffer.from(png(64), "base64"), w.ownerId],
    );
    const full = await upload(w, w.owner, "mais_um", png(64, 2));
    assert.equal(full.statusCode, 409);
    assert.equal((full.json() as { error: string }).error, "emoji_limit");
    // Animated ones have their own 50.
    assert.equal((await upload(w, w.owner, "anima", animatedGif())).statusCode, 201);

    const listed = (await w.app.inject({ method: "GET", url: `/api/v1/servers/${w.serverId}/emojis`, headers: auth(w.owner) })).json() as {
      emojis: Emoji[];
    };
    const festa = listed.emojis.find((item) => item.name === "Festa");
    assert.ok(festa);
    assert.equal((await post(w, w.owner, `/api/v1/emojis/${festa.id}/rename`, { name: "E1" })).statusCode, 409);
    // A removed emoji frees its place and its name.
    assert.equal((await post(w, w.owner, `/api/v1/emojis/${festa.id}/delete`)).statusCode, 200);
    assert.equal((await upload(w, w.owner, "festa", png(64, 3))).statusCode, 201);
  } finally {
    await w.app.close();
  }
});

test("messages and reactions resolve only this server's emojis; a removed one turns back into :name:", async () => {
  const w = await world();
  try {
    const own = (await upload(w, w.owner, "festa", png(64))).json() as Emoji;
    const foreign = (await upload(w, w.owner, "alheio", png(64, 1), w.otherServerId)).json() as Emoji;

    const sent = await send(w, w.member, `oi <:festa:${own.id}> e <:alheio:${foreign.id}>`);
    assert.equal(sent.body, `oi <:festa:${own.id}> e :alheio:`);
    assert.deepEqual(sent.emojis, [{ id: own.id, name: "festa", animated: false, removed: false }]);

    const react = (token: string, emoji: string, on = true) => post(w, token, `/api/v1/messages/${sent.id}/reactions`, { emoji, on });
    assert.equal((await react(w.member, `custom:${foreign.id}`)).statusCode, 404);
    assert.equal((await react(w.member, "custom:not-an-id")).statusCode, 400);
    const reacted = await react(w.moderator, `custom:${own.id.toUpperCase()}`);
    assert.equal(reacted.statusCode, 200);
    assert.deepEqual((reacted.json() as Message).reactions, [{ emoji: `custom:${own.id}`, userIds: [w.moderatorId] }]);

    // A rename shows the new name in old messages.
    await post(w, w.owner, `/api/v1/emojis/${own.id}/rename`, { name: "festao" });
    assert.equal((await latest(w, w.member))?.body, `oi <:festao:${own.id}> e :alheio:`);

    await post(w, w.owner, `/api/v1/emojis/${own.id}/delete`);
    const after = await latest(w, w.member);
    assert.equal(after?.body, "oi :festao: e :alheio:");
    assert.deepEqual(after?.emojis, [{ id: own.id, name: "festao", animated: false, removed: true }]);
    // The reaction stays and can be taken back, but nobody adds it again.
    assert.equal((await react(w.member, `custom:${own.id}`)).statusCode, 404);
    const off = await react(w.moderator, `custom:${own.id}`, false);
    assert.equal(off.statusCode, 200);
    assert.deepEqual((off.json() as Message).reactions, []);
    assert.equal((await w.app.inject({ method: "GET", url: `/api/v1/emojis/${own.id}`, headers: auth(w.member) })).statusCode, 404);
  } finally {
    await w.app.close();
  }
});
