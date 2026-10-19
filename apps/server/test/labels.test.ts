import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { applyMigrations, type MigrationClient } from "../src/db/migrate.js";
import { instanceName } from "../src/instance.js";

const bootstrapToken = "unit-test-bootstrap-token";
const authSecret = "unit-test-auth-secret-do-not-leak";
const adminPassword = "correct-horse-battery";
const memberPassword = "member-horse-battery";
const env = {
  AUTH_SECRET: authSecret,
  BOOTSTRAP_TOKEN: bootstrapToken,
  LIVEKIT_URL: "ws://127.0.0.1:7880",
  LIVEKIT_API_KEY: "unit-test-key",
  LIVEKIT_API_SECRET: "unit-test-secret-do-not-leak",
};

// S-21: line break, DEL, C1 next line, separators, and the bidi controls.
const hidden = ["Ana\nAdmin", "Ana\u007f", "Ana\u0085", "Ana ", "Ana ", "‮anA", "Ana؜", "Ana‏", "Ana⁦"];

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

function sqlState(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string") return error.code;
  return "";
}

async function bootstrap(app: FastifyInstance, displayName: string): Promise<{ statusCode: number; body: string; token: string }> {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/bootstrap",
    payload: { token: bootstrapToken, username: "admin", password: adminPassword, displayName },
  });
  const body = response.json() as { accessToken?: string };
  return { statusCode: response.statusCode, body: response.body, token: body.accessToken ?? "" };
}

test("bootstrap refuses control and bidi characters in the display name", async () => {
  const pg = new PGlite();
  const db = pgliteClient(pg);
  await applyMigrations(db);
  const app = await buildApp({ logger: false, env, db });
  try {
    for (const name of hidden) {
      const refused = await bootstrap(app, name);
      assert.equal(refused.statusCode, 400, JSON.stringify(name));
      assert.equal((JSON.parse(refused.body) as { error: string }).error, "invalid_display_name");
      assert.equal(refused.body.includes("eyJ"), false);
    }
    const accepted = await bootstrap(app, "  João Ação  ");
    assert.equal(accepted.statusCode, 201);
    assert.equal((JSON.parse(accepted.body) as { user: { displayName: string } }).user.displayName, "João Ação");
  } finally {
    await app.close();
    await pg.close();
  }
});

test("account, room and server names refuse control and bidi characters", async () => {
  const pg = new PGlite();
  const db = pgliteClient(pg);
  await applyMigrations(db);
  const app = await buildApp({ logger: false, env, db });
  try {
    const admin = await bootstrap(app, "Admin");
    assert.equal(admin.statusCode, 201);
    for (const [index, name] of hidden.entries()) {
      const account = await app.inject({
        method: "POST",
        url: "/api/v1/admin/users",
        headers: auth(admin.token),
        payload: { username: `member${index}`, password: memberPassword, displayName: name, role: "participant" },
      });
      assert.equal(account.statusCode, 400, JSON.stringify(name));
      assert.equal(account.json().error, "invalid_display_name");
      const room = await app.inject({
        method: "POST",
        url: "/api/v1/rooms",
        headers: auth(admin.token),
        payload: { name, slug: `sala${index}`, kind: "persistent" },
      });
      assert.equal(room.statusCode, 400, JSON.stringify(name));
      assert.equal(room.json().error, "invalid_body");
      const server = await app.inject({ method: "POST", url: "/api/v1/servers", headers: auth(admin.token), payload: { name } });
      assert.equal(server.statusCode, 400, JSON.stringify(name));
      assert.equal(server.json().error, "invalid_body");
    }
    const longest = "á".repeat(80);
    const account = await app.inject({
      method: "POST",
      url: "/api/v1/admin/users",
      headers: auth(admin.token),
      payload: { username: "member", password: memberPassword, displayName: longest, role: "participant" },
    });
    assert.equal(account.statusCode, 201);
    const tooLong = await app.inject({
      method: "POST",
      url: "/api/v1/rooms",
      headers: auth(admin.token),
      payload: { name: `${longest}a`, slug: "longa", kind: "persistent" },
    });
    assert.equal(tooLong.statusCode, 400);
    const room = await app.inject({
      method: "POST",
      url: "/api/v1/rooms",
      headers: auth(admin.token),
      payload: { name: "Reunião", slug: "reuniao", kind: "persistent" },
    });
    assert.equal(room.statusCode, 201);
    const server = await app.inject({ method: "POST", url: "/api/v1/servers", headers: auth(admin.token), payload: { name: "Equipe Ação" } });
    assert.equal(server.statusCode, 201);
  } finally {
    await app.close();
    await pg.close();
  }
});

test("the CHECK refuses U+0085 and bidi in PGlite, not only the function", async () => {
  const pg = new PGlite();
  const db = pgliteClient(pg);
  await applyMigrations(db);
  try {
    const user = await db.query("insert into users (username, password_hash, display_name, role) values ('admin', 'hash', 'Admin', 'admin') returning id");
    const userId = String(user.rows[0]?.id);
    const server = await db.query("insert into servers (name, created_by) values ('Equipe', $1) returning id", [userId]);
    const serverId = String(server.rows[0]?.id);
    const statements: [string, (name: string) => unknown[]][] = [
      ["insert into users (username, password_hash, display_name) values ('other', 'hash', $1)", (name) => [name]],
      ["insert into servers (name, created_by) values ($1, $2)", (name) => [name, userId]],
      ["insert into rooms (server_id, name, slug, kind, created_by) values ($1, $2, 'sala', 'persistent', $3)", (name) => [serverId, name, userId]],
    ];
    for (const name of [...hidden, " Ana", "Ana ", "", "a".repeat(81)]) {
      for (const [statement, params] of statements) {
        await assert.rejects(db.query(statement, params(name)), (error) => sqlState(error) === "23514", `${statement} ${JSON.stringify(name)}`);
      }
    }
    await db.query("insert into users (username, password_hash, display_name) values ('other', 'hash', 'Ação Ünïcode 名前')");
    await db.query("insert into rooms (server_id, name, slug, kind, created_by) values ($1, 'Sala', 'sala', 'persistent', $2)", [serverId, userId]);
  } finally {
    await pg.close();
  }
});

test("a display name stored before 0004 is never signed into a room token", async () => {
  const pg = new PGlite();
  const db = pgliteClient(pg);
  await applyMigrations(db);
  const app = await buildApp({ logger: false, env, db });
  try {
    const admin = await bootstrap(app, "Admin");
    const room = await app.inject({
      method: "POST",
      url: "/api/v1/rooms",
      headers: auth(admin.token),
      payload: { name: "Sala", slug: "sala", kind: "persistent" },
    });
    assert.equal(room.statusCode, 201);
    const roomId = (room.json() as { id: string }).id;
    await db.exec("alter table users drop constraint users_display_name_safe");
    await db.query("update users set display_name = $1 where username = 'admin'", ["‮Admin"]);
    const join = await app.inject({ method: "POST", url: `/api/v1/rooms/${roomId}/join`, headers: auth(admin.token), payload: {} });
    assert.equal(join.statusCode, 400);
    assert.equal(join.json().error, "invalid_display_name");
    assert.equal(join.body.includes("eyJ"), false);
  } finally {
    await app.close();
    await pg.close();
  }
});

test("INSTANCE_NAME with control or bidi falls back to OpenMeet", () => {
  for (const name of hidden) assert.equal(instanceName({ INSTANCE_NAME: name }), "OpenMeet");
  assert.equal(instanceName({ INSTANCE_NAME: " Sala Norte " }), "Sala Norte");
});
