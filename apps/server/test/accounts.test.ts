import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { applyMigrations, type MigrationClient } from "../src/db/migrate.js";
import { databaseUrlFromCompose, passwordFromInput, recoverAdmin, RecoverError } from "../src/db/recover-admin.js";
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

type Session = { accessToken: string; refreshToken: string };

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
  return BigInt((JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as { nbf: number }).nbf);
}

function fakeMedia(): { media: RoomMedia; calls: { room: string; identity: string; revokeAt: bigint }[]; failRooms: Set<string>; absentRooms: Set<string> } {
  const calls: { room: string; identity: string; revokeAt: bigint }[] = [];
  const failRooms = new Set<string>();
  const absentRooms = new Set<string>();
  return {
    calls,
    failRooms,
    absentRooms,
    media: {
      disconnect: async (room, identity, revokeAt) => {
        calls.push({ room, identity, revokeAt });
        if (failRooms.has(room)) throw new Error("sfu down");
      },
      closeRoom: async () => {},
    },
  };
}

interface World {
  app: FastifyInstance;
  db: MigrationClient;
  admin: Session;
  memberId: string;
  otherId: string;
  rooms: string[];
  serverId: string;
}

async function world(media: RoomMedia): Promise<World & { pg: PGlite }> {
  const pg = new PGlite();
  const db = pgliteClient(pg);
  await applyMigrations(db);
  const app = await buildApp({ logger: false, env, db, media });
  const created = await app.inject({
    method: "POST",
    url: "/api/v1/auth/bootstrap",
    payload: { token: bootstrapToken, username: "admin", password: adminPassword, displayName: "Admin" },
  });
  const admin = created.json() as Session;
  const rooms: string[] = [];
  let serverId = "";
  for (const slug of ["sala-a", "sala-b"]) {
    const room = await app.inject({
      method: "POST",
      url: "/api/v1/rooms",
      headers: auth(admin.accessToken),
      payload: { name: slug, slug, kind: "persistent" },
    });
    const body = room.json() as { id: string; serverId: string };
    rooms.push(body.id);
    serverId = body.serverId;
  }
  const ids: string[] = [];
  for (const username of ["member", "other"]) {
    const account = await app.inject({
      method: "POST",
      url: "/api/v1/admin/users",
      headers: auth(admin.accessToken),
      payload: { username, password: memberPassword, displayName: username, role: "participant" },
    });
    ids.push((account.json() as { id: string }).id);
  }
  return { pg, app, db, admin, memberId: ids[0] ?? "", otherId: ids[1] ?? "", rooms, serverId };
}

async function signIn(app: FastifyInstance, username: string, password = memberPassword): Promise<Session> {
  const response = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username, password } });
  assert.equal(response.statusCode, 200);
  return response.json() as Session;
}

async function enter(w: World, session: Session, room: string): Promise<{ statusCode: number; token?: string; body: string }> {
  const invite = await w.app.inject({
    method: "POST",
    url: `/api/v1/servers/${w.serverId}/invites`,
    headers: auth(w.admin.accessToken),
    payload: { expiresInMinutes: 30, maxUses: 1 },
  });
  const code = (invite.json() as { code: string }).code;
  const joined = await w.app.inject({ method: "POST", url: `/api/v1/rooms/${room}/join`, headers: auth(session.accessToken), payload: { code } });
  const body = joined.json() as { token?: string };
  return { statusCode: joined.statusCode, body: joined.body, ...(body.token ? { token: body.token } : {}) };
}

async function hold(db: MigrationClient, id: string): Promise<boolean> {
  return (await db.query("select livekit_hold from users where id = $1", [id])).rows[0]?.livekit_hold === true;
}

test("logout cuts the account from its open rooms; the other family waits with 403 until the cut confirms", async () => {
  const sfu = fakeMedia();
  const w = await world(sfu.media);
  try {
    const laptop = await signIn(w.app, "member");
    const phone = await signIn(w.app, "member");
    const other = await signIn(w.app, "other");
    const joinedA = await enter(w, laptop, w.rooms[0] ?? "");
    assert.equal(joinedA.statusCode, 200);
    const nbf = notBefore(joinedA.token ?? "");
    assert.equal((await enter(w, other, w.rooms[0] ?? "")).statusCode, 200);

    sfu.failRooms.add(w.rooms[1] ?? "");
    const failed = await w.app.inject({ method: "POST", url: "/api/v1/auth/logout", payload: { refreshToken: laptop.refreshToken } });
    assert.equal(failed.statusCode, 502);
    assert.deepEqual(failed.json(), { error: "media_disconnect_failed" });
    assert.equal(await hold(w.db, w.memberId), true);
    assert.equal((await w.app.inject({ method: "GET", url: "/api/v1/auth/me", headers: auth(laptop.accessToken) })).statusCode, 401);
    assert.equal((await w.app.inject({ method: "POST", url: "/api/v1/auth/refresh", payload: { refreshToken: laptop.refreshToken } })).statusCode, 401);
    // The phone stays signed in to the API, but signs no room token while the hold is on. Never 401 here.
    assert.equal((await w.app.inject({ method: "GET", url: "/api/v1/auth/me", headers: auth(phone.accessToken) })).statusCode, 200);
    const waiting = await w.app.inject({ method: "POST", url: `/api/v1/rooms/${w.rooms[0]}/join`, headers: auth(phone.accessToken), payload: {} });
    assert.equal(waiting.statusCode, 403);
    assert.deepEqual(waiting.json(), { error: "forbidden" });

    sfu.failRooms.clear();
    const retried = await w.app.inject({ method: "POST", url: "/api/v1/auth/logout", payload: { refreshToken: laptop.refreshToken } });
    assert.equal(retried.statusCode, 204);
    assert.equal(await hold(w.db, w.memberId), false);
    const memberCalls = sfu.calls.filter((call) => call.identity === w.memberId);
    assert.deepEqual(new Set(memberCalls.map((call) => call.room)), new Set(w.rooms));
    for (const call of memberCalls.filter((item) => item.room === w.rooms[0])) assert.ok(call.revokeAt > nbf);
    assert.equal(
      sfu.calls.some((call) => call.identity === w.otherId),
      false,
    );
    const back = await w.app.inject({ method: "POST", url: `/api/v1/rooms/${w.rooms[0]}/join`, headers: auth(phone.accessToken), payload: {} });
    assert.equal(back.statusCode, 200);

    // Once confirmed, the same logout is a plain 204 with no SFU call.
    const calls = sfu.calls.length;
    assert.equal((await w.app.inject({ method: "POST", url: "/api/v1/auth/logout", payload: { refreshToken: laptop.refreshToken } })).statusCode, 204);
    assert.equal(sfu.calls.length, calls);
  } finally {
    await w.app.close();
    await w.pg.close();
  }
});

test("logout without an open room and logout with an absent SFU participant end at once", async () => {
  const sfu = fakeMedia();
  const w = await world(sfu.media);
  try {
    const lonely = await signIn(w.app, "member");
    assert.equal((await w.app.inject({ method: "POST", url: "/api/v1/auth/logout", payload: { refreshToken: lonely.refreshToken } })).statusCode, 204);
    assert.equal(sfu.calls.length, 0);
    assert.equal(await hold(w.db, w.memberId), false);
    const inRoom = await signIn(w.app, "other");
    assert.equal((await enter(w, inRoom, w.rooms[0] ?? "")).statusCode, 200);
    assert.equal((await w.app.inject({ method: "POST", url: "/api/v1/auth/logout", payload: { refreshToken: inRoom.refreshToken } })).statusCode, 204);
    assert.equal(await hold(w.db, w.otherId), false);
  } finally {
    await w.app.close();
    await w.pg.close();
  }
});

test("disable keeps disabled_at through an SFU failure; enable waits for the cut and creates no session", async () => {
  const sfu = fakeMedia();
  const w = await world(sfu.media);
  try {
    const member = await signIn(w.app, "member");
    const other = await signIn(w.app, "other");
    assert.equal((await enter(w, member, w.rooms[0] ?? "")).statusCode, 200);
    const listed = await w.app.inject({ method: "GET", url: "/api/v1/admin/users", headers: auth(w.admin.accessToken) });
    assert.equal(listed.statusCode, 200);
    assert.deepEqual(
      (listed.json() as { username: string; disabled: boolean }[]).map((row) => [row.username, row.disabled]),
      [
        ["admin", false],
        ["member", false],
        ["other", false],
      ],
    );
    assert.equal((await w.app.inject({ method: "GET", url: "/api/v1/admin/users", headers: auth(member.accessToken) })).statusCode, 403);
    const self = await w.app.inject({
      method: "POST",
      url: `/api/v1/admin/users/${(listed.json() as { id: string }[])[0]?.id}/disable`,
      headers: auth(w.admin.accessToken),
    });
    assert.equal(self.statusCode, 403);

    sfu.failRooms.add(w.rooms[0] ?? "");
    const failed = await w.app.inject({ method: "POST", url: `/api/v1/admin/users/${w.memberId}/disable`, headers: auth(w.admin.accessToken) });
    assert.equal(failed.statusCode, 502);
    const row = await w.db.query("select disabled_at is not null as disabled, livekit_hold from users where id = $1", [w.memberId]);
    assert.deepEqual(row.rows[0], { disabled: true, livekit_hold: true });
    assert.equal(
      (await w.app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "member", password: memberPassword } })).statusCode,
      401,
    );
    assert.equal((await w.app.inject({ method: "POST", url: "/api/v1/auth/refresh", payload: { refreshToken: member.refreshToken } })).statusCode, 401);
    assert.equal((await w.app.inject({ method: "GET", url: "/api/v1/auth/me", headers: auth(member.accessToken) })).statusCode, 401);
    assert.equal((await w.app.inject({ method: "GET", url: "/api/v1/auth/me", headers: auth(other.accessToken) })).statusCode, 200);
    assert.equal((await w.app.inject({ method: "POST", url: "/api/v1/auth/refresh", payload: { refreshToken: other.refreshToken } })).statusCode, 200);

    const early = await w.app.inject({ method: "POST", url: `/api/v1/admin/users/${w.memberId}/enable`, headers: auth(w.admin.accessToken) });
    assert.equal(early.statusCode, 502);
    assert.equal((await w.db.query("select disabled_at is not null as disabled from users where id = $1", [w.memberId])).rows[0]?.disabled, true);

    sfu.failRooms.clear();
    assert.equal(
      (await w.app.inject({ method: "POST", url: `/api/v1/admin/users/${w.memberId}/disable`, headers: auth(w.admin.accessToken) })).statusCode,
      204,
    );
    assert.equal(await hold(w.db, w.memberId), false);
    const enabled = await w.app.inject({ method: "POST", url: `/api/v1/admin/users/${w.memberId}/enable`, headers: auth(w.admin.accessToken) });
    assert.equal(enabled.statusCode, 204);
    assert.equal(enabled.body, "");
    assert.equal((await w.app.inject({ method: "POST", url: "/api/v1/auth/refresh", payload: { refreshToken: member.refreshToken } })).statusCode, 401);
    await signIn(w.app, "member");
  } finally {
    await w.app.close();
    await w.pg.close();
  }
});

test("a password change revokes every family of the account and returns one new session", async () => {
  const w = await world(fakeMedia().media);
  try {
    const laptop = await signIn(w.app, "member");
    const phone = await signIn(w.app, "member");
    const other = await signIn(w.app, "other");
    const wrong = await w.app.inject({
      method: "POST",
      url: "/api/v1/auth/password",
      headers: auth(laptop.accessToken),
      payload: { currentPassword: "not-the-password", newPassword: "brand-new-password" },
    });
    assert.equal(wrong.statusCode, 401);
    const changed = await w.app.inject({
      method: "POST",
      url: "/api/v1/auth/password",
      headers: auth(laptop.accessToken),
      payload: { currentPassword: memberPassword, newPassword: "brand-new-password" },
    });
    assert.equal(changed.statusCode, 200);
    assert.equal(changed.headers["cache-control"], "no-store");
    assert.equal(changed.body.includes("brand-new-password"), false);
    const fresh = changed.json() as Session;
    for (const old of [laptop, phone]) {
      assert.equal((await w.app.inject({ method: "POST", url: "/api/v1/auth/refresh", payload: { refreshToken: old.refreshToken } })).statusCode, 401);
    }
    assert.equal((await w.app.inject({ method: "GET", url: "/api/v1/auth/me", headers: auth(fresh.accessToken) })).statusCode, 200);
    assert.equal((await w.app.inject({ method: "GET", url: "/api/v1/auth/me", headers: auth(other.accessToken) })).statusCode, 200);
    await signIn(w.app, "member", "brand-new-password");

    // The admin resets another account; the admin account is never a target of the admin route.
    const reset = await w.app.inject({
      method: "POST",
      url: `/api/v1/admin/users/${w.otherId}/password`,
      headers: auth(w.admin.accessToken),
      payload: { password: "reset-by-admin-123" },
    });
    assert.equal(reset.statusCode, 204);
    assert.equal((await w.app.inject({ method: "POST", url: "/api/v1/auth/refresh", payload: { refreshToken: other.refreshToken } })).statusCode, 401);
    await signIn(w.app, "other", "reset-by-admin-123");
    const audit = await w.db.query(
      "select count(*)::int as n from audit_events where action like '%password%' and coalesce(target_id::text, '') like '%password%'",
    );
    assert.equal(audit.rows[0]?.n, 0);
  } finally {
    await w.app.close();
    await w.pg.close();
  }
});

test("the host recovery replaces the admin password, revokes its sessions and prints nothing secret", async () => {
  const w = await world(fakeMedia().media);
  try {
    const before = await signIn(w.app, "admin", adminPassword);
    await assert.rejects(recoverAdmin(w.db, "short"), RecoverError);
    await recoverAdmin(w.db, passwordFromInput("recovered-password-1\r\n"));
    assert.equal((await w.app.inject({ method: "POST", url: "/api/v1/auth/refresh", payload: { refreshToken: before.refreshToken } })).statusCode, 401);
    assert.equal((await w.app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: adminPassword } })).statusCode, 401);
    await signIn(w.app, "admin", "recovered-password-1");
    const audit = await w.db.query("select count(*)::int as n from audit_events where action = 'admin_password_recover'");
    assert.equal(audit.rows[0]?.n, 1);
    const settings = await w.db.query("select bootstrap_completed from instance_settings where id = 1");
    assert.equal(settings.rows[0]?.bootstrap_completed, true);
    assert.equal(
      databaseUrlFromCompose({ POSTGRES_USER: "open meet", POSTGRES_PASSWORD: "p@ss/word", POSTGRES_HOST: "postgres", POSTGRES_DB: "openmeet" }),
      "postgres://open%20meet:p%40ss%2Fword@postgres:5432/openmeet",
    );
    assert.throws(() => databaseUrlFromCompose({}), RecoverError);
  } finally {
    await w.app.close();
    await w.pg.close();
  }
});
