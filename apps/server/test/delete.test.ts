import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { buildApp } from "../src/app.js";
import { applyMigrations, type MigrationClient } from "../src/db/migrate.js";
import type { RoomMedia } from "../src/rooms/media.js";
import type { FastifyInstance } from "fastify";

const bootstrapToken = "unit-test-bootstrap-token";
const authSecret = "unit-test-auth-secret-do-not-leak";
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

interface Setup {
  app: FastifyInstance;
  db: MigrationClient;
  pg: PGlite;
  admin: string;
  member: string;
  server: string;
  room: string;
}

async function setup(media: RoomMedia): Promise<Setup> {
  const pg = new PGlite();
  const db = pgliteClient(pg);
  await applyMigrations(db);
  const app = await buildApp({
    logger: false,
    env: { AUTH_SECRET: authSecret, BOOTSTRAP_TOKEN: bootstrapToken, LIVEKIT_URL: "ws://127.0.0.1:7880", LIVEKIT_API_KEY: "k", LIVEKIT_API_SECRET: "s" },
    db,
    media,
  });
  const created = await app.inject({
    method: "POST",
    url: "/api/v1/auth/bootstrap",
    payload: { token: bootstrapToken, username: "admin", password: adminPassword, displayName: "Admin" },
  });
  const admin = (created.json() as { accessToken: string }).accessToken;
  await app.inject({
    method: "POST",
    url: "/api/v1/admin/users",
    headers: auth(admin),
    payload: { username: "member", password: memberPassword, displayName: "Member", role: "participant" },
  });
  const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "member", password: memberPassword } });
  const member = (login.json() as { accessToken: string }).accessToken;
  const server = (await app.inject({ method: "POST", url: "/api/v1/servers", headers: auth(admin), payload: { name: "Time" } })).json() as { id: string };
  const room = (
    await app.inject({
      method: "POST",
      url: `/api/v1/servers/${server.id}/rooms`,
      headers: auth(admin),
      payload: { name: "Sala", slug: "sala", kind: "persistent" },
    })
  ).json() as { id: string };
  const invite = await app.inject({ method: "POST", url: `/api/v1/servers/${server.id}/invites`, headers: auth(admin), payload: { expiresInMinutes: 30 } });
  const joined = await app.inject({
    method: "POST",
    url: `/api/v1/servers/${server.id}/join`,
    headers: auth(member),
    payload: { code: (invite.json() as { code: string }).code },
  });
  assert.equal(joined.statusCode, 200);
  return { app, db, pg, admin, member, server: server.id, room: room.id };
}

test("a manager removes a room: the call closes, the room hides and its slug is free again", async () => {
  const closes: string[] = [];
  const { app, db, pg, admin, member, server, room } = await setup({
    disconnect: async () => {},
    closeRoom: async (id) => {
      closes.push(id);
    },
  });
  try {
    const denied = await app.inject({ method: "POST", url: `/api/v1/rooms/${room}/delete`, headers: auth(member) });
    assert.equal(denied.statusCode, 403);

    const removed = await app.inject({ method: "POST", url: `/api/v1/rooms/${room}/delete`, headers: auth(admin) });
    assert.equal(removed.statusCode, 204);
    assert.deepEqual(closes, [room]);
    const again = await app.inject({ method: "POST", url: `/api/v1/rooms/${room}/delete`, headers: auth(admin) });
    assert.equal(again.statusCode, 204);
    assert.deepEqual(closes, [room]);

    assert.deepEqual((await app.inject({ method: "GET", url: `/api/v1/servers/${server}/rooms`, headers: auth(member) })).json(), []);
    assert.equal((await app.inject({ method: "GET", url: `/api/v1/rooms/${room}`, headers: auth(admin) })).statusCode, 404);
    const join = await app.inject({ method: "POST", url: `/api/v1/rooms/${room}/join`, headers: auth(admin), payload: {} });
    assert.equal(join.statusCode, 404);

    const reused = await app.inject({
      method: "POST",
      url: `/api/v1/servers/${server}/rooms`,
      headers: auth(admin),
      payload: { name: "Sala", slug: "sala", kind: "persistent" },
    });
    assert.equal(reused.statusCode, 201);
    assert.equal((await db.query("select 1 from audit_events where action = 'room_delete'")).rows.length, 1);
  } finally {
    await app.close();
    await pg.close();
  }
});

test("only the owner removes a server; its rooms close, a failed SFU call retries and invites stop working", async () => {
  const closes: string[] = [];
  let fail = true;
  const { app, db, pg, admin, member, server, room } = await setup({
    disconnect: async () => {},
    closeRoom: async (id) => {
      if (fail) throw new Error("sfu down");
      closes.push(id);
    },
  });
  try {
    const invite = await app.inject({ method: "POST", url: `/api/v1/servers/${server}/invites`, headers: auth(admin), payload: { expiresInMinutes: 30 } });
    const code = (invite.json() as { code: string }).code;

    const denied = await app.inject({ method: "POST", url: `/api/v1/servers/${server}/delete`, headers: auth(member) });
    assert.equal(denied.statusCode, 403);

    const failed = await app.inject({ method: "POST", url: `/api/v1/servers/${server}/delete`, headers: auth(admin) });
    assert.equal(failed.statusCode, 502);
    assert.deepEqual((await app.inject({ method: "GET", url: "/api/v1/servers", headers: auth(admin) })).json(), []);
    fail = false;
    const retry = await app.inject({ method: "POST", url: `/api/v1/servers/${server}/delete`, headers: auth(admin) });
    assert.equal(retry.statusCode, 204);
    assert.deepEqual(closes, [room]);

    assert.deepEqual((await app.inject({ method: "GET", url: "/api/v1/servers", headers: auth(member) })).json(), []);
    assert.deepEqual((await app.inject({ method: "GET", url: "/api/v1/rooms", headers: auth(member) })).json(), []);
    assert.equal((await app.inject({ method: "GET", url: `/api/v1/servers/${server}`, headers: auth(member) })).statusCode, 404);
    const join = await app.inject({ method: "POST", url: `/api/v1/rooms/${room}/join`, headers: auth(member), payload: {} });
    assert.equal(join.statusCode, 404);
    const accept = await app.inject({ method: "POST", url: "/api/v1/invites/accept", headers: auth(member), payload: { code } });
    assert.notEqual(accept.statusCode, 200);
    assert.equal((await db.query("select 1 from audit_events where action = 'server_delete'")).rows.length, 1);
  } finally {
    await app.close();
    await pg.close();
  }
});
