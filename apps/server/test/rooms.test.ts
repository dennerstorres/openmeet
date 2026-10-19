import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { TokenVerifier } from "livekit-server-sdk";
import { buildApp } from "../src/app.js";
import { hashSecret } from "../src/auth/tokens.js";
import { applyMigrations, type MigrationClient } from "../src/db/migrate.js";
import type { RoomMedia } from "../src/rooms/media.js";
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
  const mediaCalls: string[] = [];
  const media: RoomMedia = {
    disconnect: async (room, identity) => {
      mediaCalls.push(`disconnect ${room} ${identity}`);
    },
    closeRoom: async (room) => {
      mediaCalls.push(`close ${room}`);
    },
  };
  const app = await buildApp({ logger: false, env, db, media });
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
    assert.equal(grants.video?.roomAdmin, undefined);
    assert.equal(grants.video?.roomCreate, undefined);
    assert.equal(Number(grants.exp) - Number(grants.nbf), 600);

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

    for (const token of [memberToken, otherToken]) {
      const escalation = await app.inject({
        method: "POST",
        url: "/api/v1/admin/users",
        headers: auth(token),
        payload: { username: "escalation", password: memberPassword, displayName: "Escalation", role: "moderator" },
      });
      assert.equal(escalation.statusCode, 403);
      const forbiddenEnd = await app.inject({ method: "PATCH", url: `/api/v1/rooms/${roomId}`, headers: auth(token), payload: { ended: true } });
      assert.equal(forbiddenEnd.statusCode, token === memberToken ? 403 : 404);
    }
    const anonymousJoin = await app.inject({ method: "POST", url: `/api/v1/rooms/${roomId}/join`, payload: {} });
    assert.equal(anonymousJoin.statusCode, 401);
    const hiddenRoom = await app.inject({ method: "GET", url: `/api/v1/rooms/${roomId}`, headers: auth(otherToken) });
    assert.equal(hiddenRoom.statusCode, 404);
    const hiddenList = await app.inject({ method: "GET", url: "/api/v1/rooms", headers: auth(otherToken) });
    assert.deepEqual(hiddenList.json(), []);

    for (const state of ["revoked", "expired", "wrong-room"] as const) {
      const invitation = await app.inject({
        method: "POST",
        url: `/api/v1/rooms/${roomId}/invites`,
        headers: auth(adminToken),
        payload: { expiresInMinutes: 30 },
      });
      assert.equal(invitation.statusCode, 201);
      const inviteBody = invitation.json() as { id: string; code: string };
      let targetRoom = roomId;
      if (state === "revoked") {
        const revoke = await app.inject({ method: "DELETE", url: `/api/v1/rooms/${roomId}/invites/${inviteBody.id}`, headers: auth(adminToken) });
        assert.equal(revoke.statusCode, 204);
      } else if (state === "expired") {
        await db.query("update invites set expires_at = now() - interval '1 second' where id = $1", [inviteBody.id]);
      } else {
        const another = await app.inject({
          method: "POST",
          url: "/api/v1/rooms",
          headers: auth(adminToken),
          payload: { name: "Another", slug: "another", kind: "persistent" },
        });
        assert.equal(another.statusCode, 201);
        targetRoom = (another.json() as { id: string }).id;
      }
      const invalidInvite = await app.inject({
        method: "POST",
        url: `/api/v1/rooms/${targetRoom}/join`,
        headers: auth(otherToken),
        payload: { code: inviteBody.code },
      });
      assert.equal(invalidInvite.statusCode, 403);
      const uses = await db.query("select use_count from invites where id = $1", [inviteBody.id]);
      assert.equal(uses.rows[0]?.use_count, 0);
    }

    const reusable = await app.inject({
      method: "POST",
      url: `/api/v1/rooms/${roomId}/invites`,
      headers: auth(adminToken),
      payload: { expiresInMinutes: 30, maxUses: 2 },
    });
    assert.equal(reusable.statusCode, 201);
    const reusableBody = reusable.json() as { id: string; code: string };

    const removed = await app.inject({ method: "DELETE", url: `/api/v1/rooms/${roomId}/members/${memberId}`, headers: auth(adminToken) });
    assert.equal(removed.statusCode, 204);
    assert.equal(mediaCalls.includes(`disconnect sala ${memberId}`), true);
    const blocked = await app.inject({ method: "POST", url: `/api/v1/rooms/${roomId}/join`, headers: auth(memberToken), payload: {} });
    assert.equal(blocked.statusCode, 403);
    const restored = await app.inject({
      method: "POST",
      url: `/api/v1/rooms/${roomId}/join`,
      headers: auth(memberToken),
      payload: { code: reusableBody.code },
    });
    assert.equal(restored.statusCode, 403);
    assert.equal(restored.json().error, "forbidden");
    const stillRemoved = await db.query("select removed_at is not null as removed from memberships where room_id = $1 and user_id = $2", [roomId, memberId]);
    assert.equal(stillRemoved.rows[0]?.removed === true || stillRemoved.rows[0]?.removed === "t", true);
    const spent = await db.query("select use_count from invites where id = $1", [reusableBody.id]);
    assert.equal(spent.rows[0]?.use_count, 0);
    const readmit = await app.inject({
      method: "POST",
      url: `/api/v1/rooms/${roomId}/invites`,
      headers: auth(adminToken),
      payload: { expiresInMinutes: 30 },
    });
    assert.equal(readmit.statusCode, 201);
    const back = await app.inject({
      method: "POST",
      url: `/api/v1/rooms/${roomId}/join`,
      headers: auth(memberToken),
      payload: { code: (readmit.json() as { code: string }).code },
    });
    assert.equal(back.statusCode, 200);
    const ended = await app.inject({ method: "PATCH", url: `/api/v1/rooms/${roomId}`, headers: auth(adminToken), payload: { ended: true } });
    assert.equal(ended.statusCode, 204);
    assert.equal(mediaCalls.includes("close sala"), true);
    const closed = await app.inject({ method: "POST", url: `/api/v1/rooms/${roomId}/join`, headers: auth(adminToken), payload: {} });
    assert.equal(closed.statusCode, 403);
    assert.equal(closed.json().error, "room_ended");
    // The previously issued JWT remains cryptographically valid. The SFU adapter was invoked; this still does not prove a live room.
    const stillValid = await new TokenVerifier(apiKey, apiSecret).verify(body.token);
    assert.equal(stillValid.video?.roomJoin, true);
    const preflight = await app.inject({
      method: "OPTIONS",
      url: `/api/v1/rooms/${roomId}`,
      headers: { origin: "http://localhost:1420", "access-control-request-method": "PATCH" },
    });
    const allow = String(preflight.headers["access-control-allow-methods"]);
    for (const method of ["GET", "POST", "PATCH", "DELETE"]) {
      assert.equal(allow.includes(method), true, method);
    }

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

test("a failed SFU disconnect stays revoked and the retry reaches the SFU again", async () => {
  const pg = new PGlite();
  const db = pgliteClient(pg);
  await applyMigrations(db);
  let fail = true;
  let closes = 0;
  const media: RoomMedia = {
    disconnect: async () => {},
    closeRoom: async () => {
      closes += 1;
      if (fail) throw new Error("sfu down");
    },
  };
  const app = await buildApp({
    logger: false,
    env: {
      AUTH_SECRET: authSecret,
      BOOTSTRAP_TOKEN: bootstrapToken,
      LIVEKIT_URL: "ws://127.0.0.1:7880",
      LIVEKIT_API_KEY: apiKey,
      LIVEKIT_API_SECRET: apiSecret,
    },
    db,
    media,
  });
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
    const failed = await app.inject({ method: "PATCH", url: `/api/v1/rooms/${roomId}`, headers: auth(adminToken), payload: { ended: true } });
    assert.equal(failed.statusCode, 502);
    assert.equal(failed.json().error, "media_disconnect_failed");
    const ended = await db.query("select ended_at is not null as ended from rooms where id = $1", [roomId]);
    assert.equal(ended.rows[0]?.ended === true || ended.rows[0]?.ended === "t", true);
    fail = false;
    const retry = await app.inject({ method: "PATCH", url: `/api/v1/rooms/${roomId}`, headers: auth(adminToken), payload: { ended: true } });
    assert.equal(retry.statusCode, 204);
    assert.equal(closes, 2);
  } finally {
    await app.close();
    await pg.close();
  }
});
