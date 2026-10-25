import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { applyMigrations, type MigrationClient } from "../src/db/migrate.js";
import type { RoomMedia } from "../src/rooms/media.js";

// ADR 0019: server icon, account avatar and the per-server nickname and avatar.
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

function u32be(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function ascii(value: string): number[] {
  return [...value].map((char) => char.charCodeAt(0));
}

function png(side: number, salt = 0): Buffer {
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
  ]);
}

function base64(bytes: Buffer): string {
  return bytes.toString("base64");
}

interface World {
  app: FastifyInstance;
  db: MigrationClient;
  serverId: string;
  owner: string;
  moderator: string;
  member: string;
  memberId: string;
  outsider: string;
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
  // A quiet SFU: removal asks it to disconnect and must not fail here.
  const media: RoomMedia = { disconnect: async () => undefined, closeRoom: async () => undefined };
  const app = await buildApp({ logger: false, env, db, media });
  const created = await app.inject({
    method: "POST",
    url: "/api/v1/auth/bootstrap",
    payload: { token: bootstrapToken, username: "admin", password: adminPassword, displayName: "Admin" },
  });
  assert.equal(created.statusCode, 201);
  const owner = (created.json() as { accessToken: string }).accessToken;
  const server = await app.inject({ method: "POST", url: "/api/v1/servers", headers: auth(owner), payload: { name: "Família" } });
  assert.equal(server.statusCode, 201);
  const serverId = (server.json() as { id: string }).id;
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
    serverId,
    owner,
    moderator: await login(app, "mod", memberPassword),
    member: await login(app, "ana", memberPassword),
    memberId,
    outsider: await login(app, "fora", memberPassword),
  };
}

async function members(
  w: World,
  token: string,
): Promise<{ members: { id: string; displayName: string; avatarId: string | null; globalName: string }[]; selfProfile: unknown }> {
  const response = await w.app.inject({ method: "GET", url: `/api/v1/servers/${w.serverId}/members`, headers: auth(token) });
  assert.equal(response.statusCode, 200);
  return response.json();
}

async function imageCount(db: MigrationClient): Promise<number> {
  return Number((await db.query("select count(*)::int as total from images")).rows[0]?.total);
}

test("only the owner changes the server icon, and only members read it", async () => {
  const w = await world();
  try {
    const url = `/api/v1/servers/${w.serverId}/icon`;
    for (const token of [w.moderator, w.member]) {
      const refused = await w.app.inject({ method: "POST", url, headers: auth(token), payload: { image: base64(png(64)) } });
      assert.equal(refused.statusCode, 403);
      assert.deepEqual(refused.json(), { error: "forbidden" });
    }
    const stranger = await w.app.inject({ method: "POST", url, headers: auth(w.outsider), payload: { image: base64(png(64)) } });
    assert.equal(stranger.statusCode, 404);
    assert.equal(await imageCount(w.db), 0);

    const set = await w.app.inject({ method: "POST", url, headers: auth(w.owner), payload: { image: base64(png(64)) } });
    assert.equal(set.statusCode, 200);
    const iconId = (set.json() as { iconId: string }).iconId;
    const listed = (await w.app.inject({ method: "GET", url: "/api/v1/servers", headers: auth(w.member) })).json() as { iconId: string | null }[];
    assert.equal(listed[0]?.iconId, iconId);
    const audited = await w.db.query("select count(*)::int as total from audit_events where action = 'server_icon'");
    assert.equal(audited.rows[0]?.total, 1);

    const read = await w.app.inject({ method: "GET", url: `/api/v1/images/${iconId}`, headers: auth(w.member) });
    assert.equal(read.statusCode, 200);
    assert.equal(read.headers["content-type"], "image/png");
    assert.equal(read.headers["x-content-type-options"], "nosniff");
    assert.equal(read.headers["content-security-policy"], "default-src 'none'; sandbox");
    assert.match(String(read.headers["cache-control"]), /^private, .*immutable$/);
    assert.deepEqual(read.rawPayload, png(64));
    const hidden = await w.app.inject({ method: "GET", url: `/api/v1/images/${iconId}`, headers: auth(w.outsider) });
    assert.equal(hidden.statusCode, 404);
    assert.deepEqual(hidden.json(), { error: "image_not_found" });
    const anonymous = await w.app.inject({ method: "GET", url: `/api/v1/images/${iconId}` });
    assert.equal(anonymous.statusCode, 401);

    // Replacing drops the old bytes; null removes the icon.
    const again = await w.app.inject({ method: "POST", url, headers: auth(w.owner), payload: { image: base64(png(32)) } });
    assert.notEqual((again.json() as { iconId: string }).iconId, iconId);
    assert.equal(await imageCount(w.db), 1);
    const gone = await w.app.inject({ method: "GET", url: `/api/v1/images/${iconId}`, headers: auth(w.owner) });
    assert.equal(gone.statusCode, 404);
    const cleared = await w.app.inject({ method: "POST", url, headers: auth(w.owner), payload: { image: null } });
    assert.deepEqual(cleared.json(), { iconId: null });
    assert.equal(await imageCount(w.db), 0);
  } finally {
    await w.app.close();
  }
});

test("only real PNG, JPEG or WebP within the limits is stored", async () => {
  const w = await world();
  try {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const html = Buffer.concat([png(16).subarray(0, 33), Buffer.from("<html><script>alert(1)</script></html>")]);
    const gif = Buffer.from("GIF89a\x01\x00\x01\x00\x00\x00\x00", "latin1");
    const huge = Buffer.concat([png(16), Buffer.alloc(256 * 1024)]);
    for (const image of [base64(svg), base64(html), base64(gif), base64(png(1024)), base64(huge), "not base64!", 42]) {
      const refused = await w.app.inject({ method: "POST", url: "/api/v1/profile/avatar", headers: auth(w.member), payload: { image } });
      assert.equal(refused.statusCode, 400);
      assert.deepEqual(refused.json(), { error: "invalid_image" });
    }
    const missing = await w.app.inject({ method: "POST", url: "/api/v1/profile/avatar", headers: auth(w.member), payload: {} });
    assert.equal(missing.statusCode, 400);
    assert.equal(await imageCount(w.db), 0);
  } finally {
    await w.app.close();
  }
});

test("each member sets only their own nickname and avatar, falling back to the account profile", async () => {
  const w = await world();
  try {
    const global = await w.app.inject({ method: "POST", url: "/api/v1/profile/avatar", headers: auth(w.member), payload: { image: base64(png(64, 1)) } });
    const globalAvatar = (global.json() as { avatarId: string }).avatarId;
    let view = await members(w, w.owner);
    let ana = view.members.find((item) => item.id === w.memberId);
    assert.deepEqual(ana && { name: ana.displayName, avatar: ana.avatarId, global: ana.globalName }, { name: "Ana", avatar: globalAvatar, global: "Ana" });
    const ownerReads = await w.app.inject({ method: "GET", url: `/api/v1/images/${globalAvatar}`, headers: auth(w.owner) });
    assert.equal(ownerReads.statusCode, 200);
    const strangerReads = await w.app.inject({ method: "GET", url: `/api/v1/images/${globalAvatar}`, headers: auth(w.outsider) });
    assert.equal(strangerReads.statusCode, 404);

    const url = `/api/v1/servers/${w.serverId}/profile`;
    const set = await w.app.inject({ method: "POST", url, headers: auth(w.member), payload: { nickname: "  Aninha ", avatar: base64(png(64, 2)) } });
    assert.equal(set.statusCode, 200);
    const serverAvatar = (set.json() as { avatarId: string }).avatarId;
    assert.equal((set.json() as { nickname: string }).nickname, "Aninha");
    view = await members(w, w.moderator);
    ana = view.members.find((item) => item.id === w.memberId);
    assert.deepEqual(ana && { name: ana.displayName, avatar: ana.avatarId, global: ana.globalName }, { name: "Aninha", avatar: serverAvatar, global: "Ana" });
    assert.deepEqual((await members(w, w.member)).selfProfile, { nickname: "Aninha", avatarId: serverAvatar, globalAvatarId: globalAvatar });

    // The owner's own profile call never reaches Ana's row.
    await w.app.inject({ method: "POST", url, headers: auth(w.owner), payload: { nickname: "Chefe" } });
    view = await members(w, w.member);
    assert.equal(view.members.find((item) => item.id === w.memberId)?.displayName, "Aninha");

    for (const nickname of ["Ana‮", "Ana\nAdmin", "x".repeat(81), 7]) {
      const refused = await w.app.inject({ method: "POST", url, headers: auth(w.member), payload: { nickname } });
      assert.equal(refused.statusCode, 400);
    }
    const outsider = await w.app.inject({ method: "POST", url, headers: auth(w.outsider), payload: { nickname: "Intrusa" } });
    assert.equal(outsider.statusCode, 404);

    // The room token carries the nickname as the LiveKit name.
    const room = await w.app.inject({
      method: "POST",
      url: `/api/v1/servers/${w.serverId}/rooms`,
      headers: auth(w.owner),
      payload: { name: "Sala", slug: "sala", kind: "persistent" },
    });
    const joined = await w.app.inject({
      method: "POST",
      url: `/api/v1/rooms/${(room.json() as { id: string }).id}/join`,
      headers: auth(w.member),
      payload: {},
    });
    assert.equal(joined.statusCode, 200);
    const payload = JSON.parse(Buffer.from((joined.json() as { token: string }).token.split(".")[1] ?? "", "base64url").toString("utf8")) as { name: string };
    assert.equal(payload.name, "Aninha");

    // Empty nickname and null avatar go back to the account profile.
    const reset = await w.app.inject({ method: "POST", url, headers: auth(w.member), payload: { nickname: " ", avatar: null } });
    assert.deepEqual(reset.json(), { nickname: null, avatarId: null });
    view = await members(w, w.owner);
    ana = view.members.find((item) => item.id === w.memberId);
    assert.deepEqual(ana && { name: ana.displayName, avatar: ana.avatarId }, { name: "Ana", avatar: globalAvatar });
    assert.equal(await imageCount(w.db), 1);
  } finally {
    await w.app.close();
  }
});

test("leaving the server takes the server profile and its reads with it", async () => {
  const w = await world();
  try {
    const icon = await w.app.inject({ method: "POST", url: `/api/v1/servers/${w.serverId}/icon`, headers: auth(w.owner), payload: { image: base64(png(64)) } });
    const iconId = (icon.json() as { iconId: string }).iconId;
    await w.app.inject({
      method: "POST",
      url: `/api/v1/servers/${w.serverId}/profile`,
      headers: auth(w.member),
      payload: { nickname: "Aninha", avatar: base64(png(64, 3)) },
    });
    assert.equal(await imageCount(w.db), 2);
    const removed = await w.app.inject({ method: "DELETE", url: `/api/v1/servers/${w.serverId}/members/${w.memberId}`, headers: auth(w.owner) });
    assert.equal(removed.statusCode, 204);
    const row = await w.db.query("select nickname, avatar_image_id from server_members where server_id = $1 and user_id = $2", [w.serverId, w.memberId]);
    assert.deepEqual(row.rows[0], { nickname: null, avatar_image_id: null });
    assert.equal(await imageCount(w.db), 1);
    const read = await w.app.inject({ method: "GET", url: `/api/v1/images/${iconId}`, headers: auth(w.member) });
    assert.equal(read.statusCode, 404);
  } finally {
    await w.app.close();
  }
});

test("uploads are limited per account", async () => {
  const w = await world();
  try {
    const statuses: number[] = [];
    for (let index = 0; index < 11; index += 1) {
      const response = await w.app.inject({
        method: "POST",
        url: "/api/v1/profile/avatar",
        headers: auth(w.member),
        payload: { image: base64(png(16, index)) },
      });
      statuses.push(response.statusCode);
    }
    assert.deepEqual(statuses.slice(0, 10), Array<number>(10).fill(200));
    assert.equal(statuses[10], 429);
    const other = await w.app.inject({ method: "POST", url: "/api/v1/profile/avatar", headers: auth(w.moderator), payload: { image: base64(png(16)) } });
    assert.equal(other.statusCode, 200);
  } finally {
    await w.app.close();
  }
});
