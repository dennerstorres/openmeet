import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { ServerError } from "livekit-server-sdk";
import { buildApp } from "../src/app.js";
import { applyMigrations, type MigrationClient } from "../src/db/migrate.js";
import { roomMedia, type RoomMedia } from "../src/rooms/media.js";
import { PlatformPresence } from "../src/rooms/platform-presence.js";
import { listServerPresence, setServerPresenceMode, setServerPresencePolicy } from "../src/rooms/service.js";

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

test("presence lists who is in each open room, once, with the name from the database", async () => {
  const pg = new PGlite();
  const db = pgliteClient(pg);
  await applyMigrations(db);
  const inRoom = new Map<string, string[]>();
  let failing = false;
  const media: RoomMedia = {
    disconnect: async () => {},
    closeRoom: async () => {},
    occupants: async (room) => {
      if (failing) throw new Error("sfu down");
      return inRoom.get(room) ?? [];
    },
  };
  const env = { AUTH_SECRET: authSecret, BOOTSTRAP_TOKEN: bootstrapToken };
  const app = await buildApp({ logger: false, env, db, media });
  const blind = await buildApp({ logger: false, env, db });
  try {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/auth/bootstrap",
      payload: { token: bootstrapToken, username: "admin", password: adminPassword, displayName: "Denner" },
    });
    const adminToken = (created.json() as { accessToken: string }).accessToken;
    const adminId = (created.json() as { user: { id: string } }).user.id;
    const server = await app.inject({ method: "POST", url: "/api/v1/servers", headers: auth(adminToken), payload: { name: "Trabalho" } });
    const serverId = (server.json() as { id: string }).id;
    const rooms: string[] = [];
    for (const slug of ["geral", "jogos", "velha"]) {
      const room = await app.inject({
        method: "POST",
        url: `/api/v1/servers/${serverId}/rooms`,
        headers: auth(adminToken),
        payload: { name: slug, slug, kind: "persistent" },
      });
      rooms.push((room.json() as { id: string }).id);
    }
    const [geral, jogos, velha] = rooms as [string, string, string];
    await db.query("update rooms set ended_at = now() where id = $1", [velha]);
    inRoom.set(geral, [adminId, adminId, "poc-identity", "6e1f9a52-0000-4000-8000-000000000000"]);
    inRoom.set(velha, [adminId]);

    const listed = await app.inject({ method: "GET", url: `/api/v1/servers/${serverId}/presence`, headers: auth(adminToken) });
    assert.equal(listed.statusCode, 200);
    assert.equal(listed.headers["cache-control"], "no-store");
    assert.deepEqual(listed.json(), {
      [geral]: [
        { id: adminId, displayName: "Denner" },
        { id: "poc-identity", displayName: "Participante" },
        { id: "6e1f9a52-0000-4000-8000-000000000000", displayName: "Participante" },
      ],
      [jogos]: [],
    });
    assert.equal(listed.body.includes('admin"'), false);

    await app.inject({
      method: "POST",
      url: "/api/v1/admin/users",
      headers: auth(adminToken),
      payload: { username: "outsider", password: memberPassword, displayName: "Outsider", role: "participant" },
    });
    const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "outsider", password: memberPassword } });
    const outsiderToken = (login.json() as { accessToken: string }).accessToken;
    const hidden = await app.inject({ method: "GET", url: `/api/v1/servers/${serverId}/presence`, headers: auth(outsiderToken) });
    assert.equal(hidden.statusCode, 404);
    const anonymous = await app.inject({ method: "GET", url: `/api/v1/servers/${serverId}/presence` });
    assert.equal(anonymous.statusCode, 401);

    failing = true;
    const down = await app.inject({ method: "GET", url: `/api/v1/servers/${serverId}/presence`, headers: auth(adminToken) });
    assert.equal(down.statusCode, 503);
    assert.equal(down.json().error, "presence_unavailable");
    assert.equal(down.body.includes("sfu down"), false);
    const unconfigured = await blind.inject({ method: "GET", url: `/api/v1/servers/${serverId}/presence`, headers: auth(adminToken) });
    assert.equal(unconfigured.statusCode, 503);

    const stored = await db.query("select count(*)::int as n from information_schema.columns where column_name ~ 'online|away|last_seen|occupant'");
    assert.equal(stored.rows[0]?.n, 0);
  } finally {
    await app.close();
    await blind.close();
    await pg.close();
  }
});

test("the SFU adapter treats a room that does not exist as empty", async () => {
  const media = roomMedia({
    listParticipants: async (room) => {
      if (room === "missing") throw new ServerError("not found", "not_found", 404);
      if (room === "broken") throw new ServerError("boom", "internal", 500);
      return [{ identity: "a" }, { identity: "" }];
    },
    removeParticipant: async () => {},
    deleteRoom: async () => {},
  });
  assert.deepEqual(await media.occupants?.("missing"), []);
  assert.deepEqual(await media.occupants?.("live"), ["a"]);
  await assert.rejects(() => media.occupants?.("broken") ?? Promise.resolve([]));
});

test("server presence expires, honors invisible policy and reveals it only to managers when allowed", async () => {
  const pg = new PGlite();
  const db = pgliteClient(pg);
  await applyMigrations(db);
  try {
    const users = await db.query(
      `insert into users (username, password_hash, display_name, role) values
       ('owner', 'hash', 'Dona', 'participant'),
       ('mod', 'hash', 'Mod', 'participant'),
       ('member', 'hash', 'Membro', 'participant')
       returning id, username, display_name, role`,
    );
    const [ownerRow, modRow, memberRow] = users.rows;
    assert.ok(ownerRow && modRow && memberRow);
    const owner = { id: String(ownerRow.id), username: "owner", displayName: "Dona", role: "participant" };
    const mod = { id: String(modRow.id), username: "mod", displayName: "Mod", role: "participant" };
    const member = { id: String(memberRow.id), username: "member", displayName: "Membro", role: "participant" };
    const server = await db.query("insert into servers (name, created_by) values ('Equipe', $1) returning id", [owner.id]);
    const serverId = String(server.rows[0]?.id);
    await db.query(
      `insert into server_members (server_id, user_id, role) values
       ($1, $2, 'owner'), ($1, $3, 'moderator'), ($1, $4, 'participant')`,
      [serverId, owner.id, mod.id, member.id],
    );
    let now = 1_000;
    const live = new PlatformPresence(75_000, () => now);
    live.touch(serverId, owner.id, "online");
    live.touch(serverId, mod.id, "away");
    live.touch(serverId, member.id, "online");

    await assert.rejects(() => setServerPresenceMode(db, member, serverId, "invisible"), /forbidden/);
    await setServerPresencePolicy(db, owner, serverId, { allowInvisible: true, managersSeeInvisible: false });
    await setServerPresenceMode(db, member, serverId, "invisible");
    const hidden = await listServerPresence(db, mod, serverId, live);
    assert.deepEqual(
      hidden.members.map(({ displayName: label, status }) => ({ label, status })),
      [
        { label: "Dona", status: "online" },
        { label: "Membro", status: "offline" },
        { label: "Mod", status: "away" },
      ],
    );

    await setServerPresencePolicy(db, owner, serverId, { allowInvisible: true, managersSeeInvisible: true });
    const revealed = await listServerPresence(db, mod, serverId, live);
    const invisible = revealed.members.find((item) => item.id === member.id);
    assert.deepEqual(invisible, { id: member.id, displayName: "Membro", role: "participant", status: "invisible", activity: "online", self: false });

    now += 75_001;
    const expired = await listServerPresence(db, owner, serverId, live);
    assert.equal(expired.members.find((item) => item.id === owner.id)?.status, "offline");
    await setServerPresencePolicy(db, owner, serverId, { allowInvisible: false, managersSeeInvisible: true });
    const stored = await db.query("select presence_mode from server_members where server_id = $1 and user_id = $2", [serverId, member.id]);
    assert.equal(stored.rows[0]?.presence_mode, "visible");
  } finally {
    await pg.close();
  }
});
