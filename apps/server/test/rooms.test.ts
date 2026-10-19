import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { TokenVerifier } from "livekit-server-sdk";
import { buildApp } from "../src/app.js";
import { hashSecret } from "../src/auth/tokens.js";
import { applyMigrations, type MigrationClient } from "../src/db/migrate.js";
import type { FastifyInstance } from "fastify";

const bootstrapToken = "unit-test-bootstrap-token";
const authSecret = "unit-test-auth-secret-do-not-leak";
const apiKey = "unit-test-key";
const apiSecret = "unit-test-secret-do-not-leak";
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

test("room routes stay closed without a database", async () => {
  const app = await buildApp({ logger: false, env: { AUTH_SECRET: authSecret } });
  const response = await app.inject({ method: "POST", url: "/api/v1/rooms", payload: { name: "Sala", slug: "sala", kind: "persistent" } });
  assert.equal(response.statusCode, 503);
  assert.equal(response.json().error, "auth_unconfigured");
  await app.close();
});

test("invite join issues a room-scoped token and hides the invite code", async () => {
  const pg = new PGlite();
  const db = pgliteClient(pg);
  await applyMigrations(db);
  const env = {
    AUTH_SECRET: authSecret,
    BOOTSTRAP_TOKEN: bootstrapToken,
    LIVEKIT_URL: "ws://127.0.0.1:7880",
    LIVEKIT_API_KEY: apiKey,
    LIVEKIT_API_SECRET: apiSecret,
  };
  const app = await buildApp({ logger: false, env, db });
  const offline = await buildApp({ logger: false, env: { AUTH_SECRET: authSecret, BOOTSTRAP_TOKEN: bootstrapToken }, db });
  try {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/auth/bootstrap",
      payload: { token: bootstrapToken, username: "admin", password: adminPassword, displayName: "Admin" },
    });
    assert.equal(created.statusCode, 201);
    const adminToken = (created.json() as { accessToken: string }).accessToken;
    const roomResponse = await app.inject({
      method: "POST",
      url: "/api/v1/rooms",
      headers: auth(adminToken),
      payload: { name: "Sala", slug: "sala", kind: "persistent" },
    });
    assert.equal(roomResponse.statusCode, 201);
    const roomId = (roomResponse.json() as { id: string }).id;

    const account = await app.inject({
      method: "POST",
      url: "/api/v1/admin/users",
      headers: auth(adminToken),
      payload: { username: "member", password: memberPassword, displayName: "Member", role: "participant" },
    });
    assert.equal(account.statusCode, 201);
    assert.equal(account.body.includes(memberPassword), false);
    const memberId = (account.json() as { id: string }).id;
    const memberToken = await login(app, "member", memberPassword);
    const denied = await app.inject({
      method: "POST",
      url: "/api/v1/rooms",
      headers: auth(memberToken),
      payload: { name: "Outra", slug: "outra", kind: "temporary" },
    });
    assert.equal(denied.statusCode, 403);
    const hidden = await app.inject({ method: "POST", url: `/api/v1/rooms/${roomId}/invites`, headers: auth(memberToken), payload: { expiresInMinutes: 30 } });
    assert.equal(hidden.statusCode, 404);

    const offlineJoin = await offline.inject({ method: "POST", url: `/api/v1/rooms/${roomId}/join`, headers: auth(adminToken), payload: {} });
    assert.equal(offlineJoin.statusCode, 503);
    assert.equal(offlineJoin.body.includes("eyJ"), false);

    const invite = await app.inject({
      method: "POST",
      url: `/api/v1/rooms/${roomId}/invites`,
      headers: auth(adminToken),
      payload: { expiresInMinutes: 30, maxUses: 1 },
    });
    assert.equal(invite.statusCode, 201);
    const code = (invite.json() as { code: string; id: string }).code;
    const stored = await db.query("select code_hash from invites");
    assert.equal(
      stored.rows.some((row) => row.code_hash === code),
      false,
    );
    assert.equal(
      stored.rows.some((row) => row.code_hash === hashSecret(code)),
      true,
    );

    const joined = await app.inject({ method: "POST", url: `/api/v1/rooms/${roomId}/join`, headers: auth(memberToken), payload: { code } });
    assert.equal(joined.statusCode, 200);
    assert.equal(joined.headers["cache-control"], "no-store");
    assert.equal(joined.body.includes(apiSecret), false);
    assert.equal(joined.body.includes(code), false);
    const body = joined.json() as { url: string; token: string; expiresIn: number };
    assert.equal(body.url, "ws://127.0.0.1:7880/");
    assert.equal(body.expiresIn, 600);
    const grants = await new TokenVerifier(apiKey, apiSecret).verify(body.token);
    assert.equal(grants.sub, memberId);
    assert.equal(grants.video?.room, "sala");
    assert.equal(grants.video?.roomJoin, true);
    assert.equal(grants.video?.canPublishData, false);

    const again = await app.inject({ method: "POST", url: `/api/v1/rooms/${roomId}/join`, headers: auth(memberToken), payload: {} });
    assert.equal(again.statusCode, 200);
    const listed = await app.inject({ method: "GET", url: "/api/v1/rooms", headers: auth(memberToken) });
    assert.equal(listed.statusCode, 200);
    assert.equal(
      (listed.json() as { slug: string }[]).some((room) => room.slug === "sala"),
      true,
    );

    const other = await app.inject({
      method: "POST",
      url: "/api/v1/admin/users",
      headers: auth(adminToken),
      payload: { username: "other", password: memberPassword, displayName: "Other", role: "participant" },
    });
    assert.equal(other.statusCode, 201);
    const otherToken = await login(app, "other", memberPassword);
    const reused = await app.inject({ method: "POST", url: `/api/v1/rooms/${roomId}/join`, headers: auth(otherToken), payload: { code } });
    assert.equal(reused.statusCode, 403);

    const removed = await app.inject({ method: "DELETE", url: `/api/v1/rooms/${roomId}/members/${memberId}`, headers: auth(adminToken) });
    assert.equal(removed.statusCode, 204);
    const blocked = await app.inject({ method: "POST", url: `/api/v1/rooms/${roomId}/join`, headers: auth(memberToken), payload: {} });
    assert.equal(blocked.statusCode, 403);
    const ended = await app.inject({ method: "PATCH", url: `/api/v1/rooms/${roomId}`, headers: auth(adminToken), payload: { ended: true } });
    assert.equal(ended.statusCode, 204);
    const closed = await app.inject({ method: "POST", url: `/api/v1/rooms/${roomId}/join`, headers: auth(adminToken), payload: {} });
    assert.equal(closed.statusCode, 403);
    assert.equal(closed.json().error, "room_ended");

    const audit = await db.query("select action from audit_events");
    const blob = audit.rows.map((row) => String(row.action)).join(" ");
    assert.equal(blob.includes(code), false);
    assert.equal(blob.includes(apiSecret), false);
  } finally {
    await app.close();
    await offline.close();
    await pg.close();
  }
});
