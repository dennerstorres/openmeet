import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { applyMigrations, type MigrationClient } from "../src/db/migrate.js";
import type { RoomMedia } from "../src/rooms/media.js";

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

function notBefore(token: string): bigint {
  const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as { nbf: number };
  return BigInt(payload.nbf);
}

// A fake SFU that fails on demand and records the revoke time it was given.
function fakeMedia(): { media: RoomMedia; calls: { kind: string; room: string; revokeAt: bigint }[]; fail: { on: boolean } } {
  const calls: { kind: string; room: string; revokeAt: bigint }[] = [];
  const fail = { on: false };
  const media: RoomMedia = {
    disconnect: async (room, _identity, revokeAt) => {
      calls.push({ kind: "disconnect", room, revokeAt });
      if (fail.on) throw new Error("sfu down");
    },
    closeRoom: async (room, revokeAt) => {
      calls.push({ kind: "close", room, revokeAt });
      if (fail.on) throw new Error("sfu down");
    },
  };
  return { media, calls, fail };
}

async function setup(app: FastifyInstance): Promise<{ adminToken: string; memberToken: string; memberId: string; roomId: string; serverId: string }> {
  const created = await app.inject({
    method: "POST",
    url: "/api/v1/auth/bootstrap",
    payload: { token: bootstrapToken, username: "admin", password: adminPassword, displayName: "Admin" },
  });
  const adminToken = (created.json() as { accessToken: string }).accessToken;
  const room = await app.inject({
    method: "POST",
    url: "/api/v1/rooms",
    headers: auth(adminToken),
    payload: { name: "Sala", slug: "sala", kind: "persistent" },
  });
  const { id: roomId, serverId } = room.json() as { id: string; serverId: string };
  const account = await app.inject({
    method: "POST",
    url: "/api/v1/admin/users",
    headers: auth(adminToken),
    payload: { username: "member", password: memberPassword, displayName: "Member", role: "participant" },
  });
  const memberId = (account.json() as { id: string }).id;
  const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "member", password: memberPassword } });
  const memberToken = (login.json() as { accessToken: string }).accessToken;
  const code = await invite(app, adminToken, serverId);
  const joined = await app.inject({ method: "POST", url: `/api/v1/rooms/${roomId}/join`, headers: auth(memberToken), payload: { code } });
  assert.equal(joined.statusCode, 200);
  return { adminToken, memberToken, memberId, roomId, serverId };
}

async function invite(app: FastifyInstance, adminToken: string, serverId: string): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: `/api/v1/servers/${serverId}/invites`,
    headers: auth(adminToken),
    payload: { expiresInMinutes: 30, maxUses: 5 },
  });
  assert.equal(response.statusCode, 201);
  return (response.json() as { code: string }).code;
}

function assertNoCredential(body: string): void {
  assert.equal(body.includes("eyJ"), false);
  assert.equal(body.includes('"url"'), false);
  assert.equal(body.includes('"token"'), false);
}

test("room kick checks permissions, preserves membership and reports SFU failure", async () => {
  const pg = new PGlite();
  const db = pgliteClient(pg);
  await applyMigrations(db);
  const sfu = fakeMedia();
  const app = await buildApp({ logger: false, env, db, media: sfu.media });
  try {
    const { adminToken, memberToken, memberId, roomId, serverId } = await setup(app);
    const url = `/api/v1/rooms/${roomId}/participants/${memberId}/kick`;
    assert.equal((await app.inject({ method: "POST", url })).statusCode, 401);
    assert.equal((await app.inject({ method: "POST", url, headers: auth(memberToken) })).statusCode, 403);
    const owner = await db.query("select user_id from server_members where server_id = $1 and role = 'owner'", [serverId]);
    const ownerId = String(owner.rows[0]?.user_id);
    assert.equal(
      (await app.inject({ method: "POST", url: `/api/v1/rooms/${roomId}/participants/${ownerId}/kick`, headers: auth(adminToken) })).statusCode,
      403,
    );
    assert.equal(sfu.calls.length, 0);
    sfu.fail.on = true;
    assert.equal((await app.inject({ method: "POST", url, headers: auth(adminToken) })).statusCode, 502);
    sfu.fail.on = false;
    assert.equal((await app.inject({ method: "POST", url, headers: auth(adminToken) })).statusCode, 204);
    assert.ok(sfu.calls.every((call) => call.room === roomId && call.kind === "disconnect"));
    const member = await db.query("select removed_at from server_members where server_id = $1 and user_id = $2", [serverId, memberId]);
    assert.equal(member.rows[0]?.removed_at, null);
    assert.equal((await app.inject({ method: "POST", url: `/api/v1/rooms/${roomId}/join`, headers: auth(memberToken), payload: {} })).statusCode, 200);
    await db.query("update server_members set removed_at = now() where server_id = $1 and user_id = $2", [serverId, ownerId]);
    assert.equal((await app.inject({ method: "POST", url, headers: auth(adminToken) })).statusCode, 404);
  } finally {
    await app.close();
    await pg.close();
  }
});

test("a removed member gets no token and no invite back until the SFU confirms the cut", async () => {
  const pg = new PGlite();
  const db = pgliteClient(pg);
  await applyMigrations(db);
  const sfu = fakeMedia();
  const app = await buildApp({ logger: false, env, db, media: sfu.media });
  try {
    const { adminToken, memberToken, memberId, roomId, serverId } = await setup(app);
    const again = await app.inject({ method: "POST", url: `/api/v1/rooms/${roomId}/join`, headers: auth(memberToken), payload: {} });
    const newest = notBefore((again.json() as { token: string }).token);

    sfu.fail.on = true;
    const failed = await app.inject({ method: "DELETE", url: `/api/v1/servers/${serverId}/members/${memberId}`, headers: auth(adminToken) });
    assert.equal(failed.statusCode, 502);
    assert.deepEqual(failed.json(), { error: "media_disconnect_failed" });
    const removed = await db.query("select removed_at is not null as removed, media_cut_at from server_members where user_id = $1", [memberId]);
    assert.equal(removed.rows[0]?.removed, true);
    assert.equal(removed.rows[0]?.media_cut_at, null);

    // Between the failure and the confirmation: nothing, not even with an invite made after the removal.
    const plain = await app.inject({ method: "POST", url: `/api/v1/rooms/${roomId}/join`, headers: auth(memberToken), payload: {} });
    assert.equal(plain.statusCode, 403);
    assertNoCredential(plain.body);
    const fresh = await invite(app, adminToken, serverId);
    const withCode = await app.inject({ method: "POST", url: `/api/v1/rooms/${roomId}/join`, headers: auth(memberToken), payload: { code: fresh } });
    assert.equal(withCode.statusCode, 403);
    assertNoCredential(withCode.body);
    const accepted = await app.inject({ method: "POST", url: "/api/v1/invites/accept", headers: auth(memberToken), payload: { code: fresh } });
    assert.equal(accepted.statusCode, 403);

    sfu.fail.on = false;
    const retried = await app.inject({ method: "DELETE", url: `/api/v1/servers/${serverId}/members/${memberId}`, headers: auth(adminToken) });
    assert.equal(retried.statusCode, 204);
    const cuts = sfu.calls.filter((call) => call.kind === "disconnect");
    assert.equal(cuts.length, 2);
    for (const cut of cuts) {
      assert.equal(cut.room, roomId);
      assert.ok(cut.revokeAt > newest, `${cut.revokeAt} > ${newest}`);
    }
    const confirmed = await app.inject({ method: "DELETE", url: `/api/v1/servers/${serverId}/members/${memberId}`, headers: auth(adminToken) });
    assert.equal(confirmed.statusCode, 204);
    assert.equal(sfu.calls.filter((call) => call.kind === "disconnect").length, 2);

    // After the cut, an invite made after the removal brings the member back, as before.
    const back = await app.inject({ method: "POST", url: `/api/v1/rooms/${roomId}/join`, headers: auth(memberToken), payload: { code: fresh } });
    assert.equal(back.statusCode, 200);
  } finally {
    await app.close();
    await pg.close();
  }
});

test("an ended room is closed after the newest token and stays closed on a retry", async () => {
  const pg = new PGlite();
  const db = pgliteClient(pg);
  await applyMigrations(db);
  const sfu = fakeMedia();
  const app = await buildApp({ logger: false, env, db, media: sfu.media });
  try {
    const { adminToken, memberToken, roomId, serverId } = await setup(app);
    const joined = await app.inject({ method: "POST", url: `/api/v1/rooms/${roomId}/join`, headers: auth(adminToken), payload: {} });
    const newest = notBefore((joined.json() as { token: string }).token);

    sfu.fail.on = true;
    const failed = await app.inject({ method: "PATCH", url: `/api/v1/rooms/${roomId}`, headers: auth(adminToken), payload: { ended: true } });
    assert.equal(failed.statusCode, 502);
    const code = await invite(app, adminToken, serverId);
    for (const payload of [{}, { code }]) {
      const blocked = await app.inject({ method: "POST", url: `/api/v1/rooms/${roomId}/join`, headers: auth(memberToken), payload });
      assert.equal(blocked.statusCode, 403);
      assert.equal(blocked.json().error, "room_ended");
      assertNoCredential(blocked.body);
    }
    sfu.fail.on = false;
    assert.equal((await app.inject({ method: "PATCH", url: `/api/v1/rooms/${roomId}`, headers: auth(adminToken), payload: { ended: true } })).statusCode, 204);
    assert.equal((await app.inject({ method: "PATCH", url: `/api/v1/rooms/${roomId}`, headers: auth(adminToken), payload: { ended: true } })).statusCode, 204);
    const closes = sfu.calls.filter((call) => call.kind === "close");
    assert.equal(closes.length, 2);
    for (const close of closes) assert.ok(close.revokeAt > newest);
    const audit = await db.query("select count(*)::int as n from audit_events where action = 'room_end'");
    assert.equal(audit.rows[0]?.n, 1);
  } finally {
    await app.close();
    await pg.close();
  }
});

test("a held account or a revoked session signs no room token", async () => {
  const pg = new PGlite();
  const db = pgliteClient(pg);
  await applyMigrations(db);
  const app = await buildApp({ logger: false, env, db, media: fakeMedia().media });
  try {
    const { memberToken, memberId, roomId } = await setup(app);
    await db.query("update users set livekit_hold = true where id = $1", [memberId]);
    const held = await app.inject({ method: "POST", url: `/api/v1/rooms/${roomId}/join`, headers: auth(memberToken), payload: {} });
    assert.equal(held.statusCode, 403);
    assertNoCredential(held.body);
    await db.query("update users set livekit_hold = false where id = $1", [memberId]);
    assert.equal((await app.inject({ method: "POST", url: `/api/v1/rooms/${roomId}/join`, headers: auth(memberToken), payload: {} })).statusCode, 200);
    await db.query("update refresh_sessions set revoked_at = now() where user_id = $1", [memberId]);
    const revoked = await app.inject({ method: "POST", url: `/api/v1/rooms/${roomId}/join`, headers: auth(memberToken), payload: {} });
    assert.equal(revoked.statusCode, 401);
    assertNoCredential(revoked.body);
  } finally {
    await app.close();
    await pg.close();
  }
});
