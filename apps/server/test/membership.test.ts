import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { applyMigrations, type MigrationClient } from "../src/db/migrate.js";

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

function assertNoCredential(body: string): void {
  assert.equal(body.includes("eyJ"), false);
  assert.equal(body.includes('"url"'), false);
  assert.equal(body.includes('"token"'), false);
}

// S-01: the instance admin is a person with an account, not a visitor of every server.
test("the instance admin does not see, read or join a room of a server they are not part of", async () => {
  const pg = new PGlite();
  const db = pgliteClient(pg);
  await applyMigrations(db);
  const app = await buildApp({ logger: false, env, db });
  try {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/auth/bootstrap",
      payload: { token: bootstrapToken, username: "admin", password: adminPassword, displayName: "Admin" },
    });
    assert.equal(created.statusCode, 201);
    const adminToken = (created.json() as { accessToken: string }).accessToken;
    const ownerId = await account(app, adminToken, "dona", "Dona");
    const ownerToken = await login(app, "dona", memberPassword);

    // A server the admin never joined, owned by another account.
    const server = await db.query("insert into servers (name, created_by) values ('Privado', $1) returning id", [ownerId]);
    const serverId = String(server.rows[0]?.id);
    await db.query("insert into server_members (server_id, user_id, role) values ($1, $2, 'owner')", [serverId, ownerId]);
    const room = await app.inject({
      method: "POST",
      url: `/api/v1/servers/${serverId}/rooms`,
      headers: auth(ownerToken),
      payload: { name: "Reservada", slug: "reservada", kind: "persistent" },
    });
    assert.equal(room.statusCode, 201);
    const roomId = (room.json() as { id: string }).id;

    const listed = (await app.inject({ method: "GET", url: "/api/v1/rooms", headers: auth(adminToken) })).json() as { id: string }[];
    assert.equal(
      listed.some((item) => item.id === roomId),
      false,
    );
    const read = await app.inject({ method: "GET", url: `/api/v1/rooms/${roomId}`, headers: auth(adminToken) });
    assert.equal(read.statusCode, 404);
    assert.deepEqual(read.json(), { error: "room_not_found" });
    const join = await app.inject({ method: "POST", url: `/api/v1/rooms/${roomId}/join`, headers: auth(adminToken), payload: {} });
    assert.equal(join.statusCode, 403);
    assert.deepEqual(join.json(), { error: "forbidden" });
    assertNoCredential(join.body);
    const end = await app.inject({ method: "PATCH", url: `/api/v1/rooms/${roomId}`, headers: auth(adminToken), payload: { ended: true } });
    assert.notEqual(end.statusCode, 204);

    // An ended room looks the same as an open one to someone with no membership and no code.
    await db.query("update rooms set ended_at = now() where id = $1", [roomId]);
    const ended = await app.inject({ method: "POST", url: `/api/v1/rooms/${roomId}/join`, headers: auth(adminToken), payload: {} });
    assert.equal(ended.statusCode, 403);
    assert.deepEqual(ended.json(), { error: "forbidden" });
    await db.query("update rooms set ended_at = null where id = $1", [roomId]);

    const ownerJoin = await app.inject({ method: "POST", url: `/api/v1/rooms/${roomId}/join`, headers: auth(ownerToken), payload: {} });
    assert.equal(ownerJoin.statusCode, 200);
    assert.equal(typeof (ownerJoin.json() as { token: string }).token, "string");

    // A valid invite is the only way in, for the admin too.
    const invite = await app.inject({
      method: "POST",
      url: `/api/v1/servers/${serverId}/invites`,
      headers: auth(ownerToken),
      payload: { expiresInMinutes: 30, maxUses: 1 },
    });
    assert.equal(invite.statusCode, 201);
    const code = (invite.json() as { code: string }).code;
    const invited = await app.inject({ method: "POST", url: `/api/v1/rooms/${roomId}/join`, headers: auth(adminToken), payload: { code } });
    assert.equal(invited.statusCode, 200);
    const membership = await db.query("select role from server_members where server_id = $1 and user_id = (select id from users where username = 'admin')", [
      serverId,
    ]);
    assert.equal(membership.rows[0]?.role, "participant");

    // The admin keeps owning what they create.
    const own = await app.inject({
      method: "POST",
      url: "/api/v1/rooms",
      headers: auth(adminToken),
      payload: { name: "Minha", slug: "minha", kind: "persistent" },
    });
    assert.equal(own.statusCode, 201);
    const ownRoom = await app.inject({ method: "GET", url: `/api/v1/rooms/${(own.json() as { id: string }).id}`, headers: auth(adminToken) });
    assert.equal(ownRoom.statusCode, 200);
  } finally {
    await app.close();
    await pg.close();
  }
});

// S-10: the login of an account is not shown to the other members.
test("room members carry name and role, never the username", async () => {
  const pg = new PGlite();
  const db = pgliteClient(pg);
  await applyMigrations(db);
  const app = await buildApp({ logger: false, env, db });
  try {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/auth/bootstrap",
      payload: { token: bootstrapToken, username: "admin-login", password: adminPassword, displayName: "Admin" },
    });
    const adminToken = (created.json() as { accessToken: string }).accessToken;
    const room = await app.inject({
      method: "POST",
      url: "/api/v1/rooms",
      headers: auth(adminToken),
      payload: { name: "Sala", slug: "sala", kind: "persistent" },
    });
    const roomId = (room.json() as { id: string; serverId: string }).id;
    const serverId = (room.json() as { serverId: string }).serverId;
    await account(app, adminToken, "segredo-login", "Bia");
    const memberToken = await login(app, "segredo-login", memberPassword);
    const invite = await app.inject({
      method: "POST",
      url: `/api/v1/servers/${serverId}/invites`,
      headers: auth(adminToken),
      payload: { expiresInMinutes: 30, maxUses: 1 },
    });
    const code = (invite.json() as { code: string }).code;
    assert.equal((await app.inject({ method: "POST", url: `/api/v1/rooms/${roomId}/join`, headers: auth(memberToken), payload: { code } })).statusCode, 200);

    const read = await app.inject({ method: "GET", url: `/api/v1/rooms/${roomId}`, headers: auth(memberToken) });
    assert.equal(read.statusCode, 200);
    assert.equal(read.body.includes("admin-login"), false);
    assert.equal(read.body.includes("segredo-login"), false);
    assert.equal(read.body.includes("username"), false);
    const members = (read.json() as { members: Record<string, unknown>[] }).members;
    assert.deepEqual(
      members.map((member) => [member.displayName, member.role, Object.keys(member).sort().join(",")]),
      [
        ["Admin", "owner", "displayName,id,role"],
        ["Bia", "participant", "displayName,id,role"],
      ],
    );

    const me = await app.inject({ method: "GET", url: "/api/v1/auth/me", headers: auth(memberToken) });
    assert.equal((me.json() as { username: string }).username, "segredo-login");
  } finally {
    await app.close();
    await pg.close();
  }
});
