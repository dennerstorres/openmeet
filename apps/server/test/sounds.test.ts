import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { SOUND_SAMPLE_RATE, encodeSound } from "@openmeet/shared";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { applyMigrations, type MigrationClient } from "../src/db/migrate.js";
import type { RoomMedia } from "../src/rooms/media.js";

// ADR 0021: server sound libraries, their permissions and the canonical WAV.
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

function wav(seconds: number): string {
  const samples = new Float32Array(Math.round(SOUND_SAMPLE_RATE * seconds)).map((_, index) => Math.sin(index / 7) * 0.5);
  return Buffer.from(encodeSound(samples)).toString("base64");
}

interface World {
  app: FastifyInstance;
  db: MigrationClient;
  serverId: string;
  otherServerId: string;
  owner: string;
  moderator: string;
  member: string;
  outsider: string;
}

interface Listed {
  id: string;
  name: string;
  durationMs: number;
  mine: boolean;
  canRemove: boolean;
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
  const media: RoomMedia = { disconnect: async () => undefined, closeRoom: async () => undefined };
  const app = await buildApp({ logger: false, env, db, media });
  const created = await app.inject({
    method: "POST",
    url: "/api/v1/auth/bootstrap",
    payload: { token: bootstrapToken, username: "admin", password: adminPassword, displayName: "Admin" },
  });
  assert.equal(created.statusCode, 201);
  const owner = (created.json() as { accessToken: string }).accessToken;
  const server = async (name: string) => {
    const response = await app.inject({ method: "POST", url: "/api/v1/servers", headers: auth(owner), payload: { name } });
    assert.equal(response.statusCode, 201);
    return (response.json() as { id: string }).id;
  };
  const serverId = await server("Família");
  const otherServerId = await server("Trabalho");
  const moderatorId = await account(app, owner, "mod", "Moderadora");
  const memberId = await account(app, owner, "ana", "Ana");
  await account(app, owner, "fora", "Fora");
  await db.query("insert into server_members (server_id, user_id, role) values ($1, $2, 'moderator'), ($1, $3, 'participant'), ($4, $3, 'participant')", [
    serverId,
    moderatorId,
    memberId,
    otherServerId,
  ]);
  return {
    app,
    db,
    serverId,
    otherServerId,
    owner,
    moderator: await login(app, "mod", memberPassword),
    member: await login(app, "ana", memberPassword),
    outsider: await login(app, "fora", memberPassword),
  };
}

async function upload(w: World, token: string, name: string, seconds = 1, server = w.serverId) {
  return w.app.inject({ method: "POST", url: `/api/v1/servers/${server}/sounds`, headers: auth(token), payload: { name, sound: wav(seconds) } });
}

async function library(w: World, token: string, server = w.serverId): Promise<{ status: number; sounds: Listed[] | undefined }> {
  const response = await w.app.inject({ method: "GET", url: `/api/v1/servers/${server}/sounds`, headers: auth(token) });
  return { status: response.statusCode, sounds: (response.json() as { sounds?: Listed[] }).sounds };
}

async function soundCount(db: MigrationClient): Promise<number> {
  return Number((await db.query("select count(*)::int as total from sounds")).rows[0]?.total);
}

test("members share a server library; outsiders neither list, send nor hear it", async () => {
  const w = await world();
  try {
    const sent = await upload(w, w.member, "Buzina", 1.5);
    assert.equal(sent.statusCode, 201);
    const sound = sent.json() as { id: string; durationMs: number };
    assert.equal(sound.durationMs, 1500);

    for (const token of [w.owner, w.moderator]) {
      const seen = await library(w, token);
      assert.equal(seen.status, 200);
      assert.deepEqual(seen.sounds, [{ id: sound.id, name: "Buzina", durationMs: 1500, mine: false, canRemove: true }]);
      const bytes = await w.app.inject({ method: "GET", url: `/api/v1/sounds/${sound.id}`, headers: auth(token) });
      assert.equal(bytes.statusCode, 200);
      assert.equal(bytes.headers["content-type"], "audio/wav");
      assert.equal(bytes.rawPayload.length, 44 + SOUND_SAMPLE_RATE * 2 * 1.5);
    }
    assert.equal((await library(w, w.member)).sounds?.[0]?.mine, true);

    assert.equal((await library(w, w.outsider)).status, 404);
    assert.equal((await upload(w, w.outsider, "Intruso")).statusCode, 404);
    const stranger = await w.app.inject({ method: "GET", url: `/api/v1/sounds/${sound.id}`, headers: auth(w.outsider) });
    assert.equal(stranger.statusCode, 404);
    // The other server never sees it until imported.
    assert.deepEqual((await library(w, w.member, w.otherServerId)).sounds, []);
    const unauth = await w.app.inject({ method: "GET", url: `/api/v1/servers/${w.serverId}/sounds` });
    assert.equal(unauth.statusCode, 401);
  } finally {
    await w.app.close();
  }
});

test("only canonical WAV up to 20 s and a safe name are stored", async () => {
  const w = await world();
  try {
    assert.equal((await upload(w, w.member, "Longo", 20)).statusCode, 201, "20 s fits, beyond the default body limit");
    const send = (payload: unknown) =>
      w.app.inject({ method: "POST", url: `/api/v1/servers/${w.serverId}/sounds`, headers: auth(w.member), payload: payload as object });
    const stereo = Buffer.from(wav(1), "base64");
    stereo.writeUInt16LE(2, 22);
    const tooLong = Buffer.alloc(44 + SOUND_SAMPLE_RATE * 2 * 21);
    tooLong.set(Buffer.from(wav(1), "base64").subarray(0, 44));
    const cases: [unknown, string][] = [
      [{ name: "x", sound: stereo.toString("base64") }, "invalid_sound"],
      [{ name: "x", sound: Buffer.from("ID3 not a wav at all").toString("base64") }, "invalid_sound"],
      [{ name: "x", sound: "%%%%" }, "invalid_sound"],
      [{ name: "x" }, "invalid_sound"],
      [{ name: "x", sound: tooLong.toString("base64") }, "invalid_sound"],
      [{ name: "", sound: wav(1) }, "invalid_display_name"],
      [{ name: "a".repeat(33), sound: wav(1) }, "invalid_display_name"],
      [{ name: "evil‮", sound: wav(1) }, "invalid_display_name"],
      [{ name: 7, sound: wav(1) }, "invalid_display_name"],
    ];
    for (const [payload, error] of cases) {
      const refused = await send(payload);
      const label = `${JSON.stringify(payload).slice(0, 50)} → ${refused.statusCode}`;
      // A body past the route limit stops at Fastify with 413 before reaching the validator.
      assert.ok(refused.statusCode === 400 || refused.statusCode === 413, label);
      if (refused.statusCode === 400) assert.deepEqual(refused.json(), { error }, label);
    }
    assert.equal(await soundCount(w.db), 1);
  } finally {
    await w.app.close();
  }
});

test("only the owner imports, renames and deletes; moderators take sounds out of their server", async () => {
  const w = await world();
  try {
    const own = (await upload(w, w.member, "Palmas")).json() as { id: string };
    const theirs = (await upload(w, w.owner, "Sino")).json() as { id: string };
    const call = (token: string, url: string, payload?: object) => w.app.inject({ method: "POST", url, headers: auth(token), payload: payload ?? {} });

    // Someone else's sound: visible means forbidden, invisible means missing.
    assert.equal((await call(w.member, `/api/v1/servers/${w.otherServerId}/sounds/${theirs.id}/import`)).statusCode, 403);
    assert.equal((await call(w.outsider, `/api/v1/sounds/${own.id}/rename`, { name: "Meu" })).statusCode, 404);
    assert.equal((await call(w.moderator, `/api/v1/sounds/${own.id}/delete`)).statusCode, 403);
    // A server the owner of the sound does not belong to.
    const lone = (await w.app.inject({ method: "POST", url: "/api/v1/servers", headers: auth(w.owner), payload: { name: "Só admin" } })).json() as {
      id: string;
    };
    assert.equal((await call(w.member, `/api/v1/servers/${lone.id}/sounds/${own.id}/import`)).statusCode, 404);

    assert.equal((await call(w.member, `/api/v1/servers/${w.otherServerId}/sounds/${own.id}/import`)).statusCode, 200);
    assert.equal((await call(w.member, `/api/v1/servers/${w.otherServerId}/sounds/${own.id}/import`)).statusCode, 200, "twice is a no-op");
    assert.deepEqual(
      (await library(w, w.member, w.otherServerId)).sounds?.map((item) => item.name),
      ["Palmas"],
    );
    const mine = await w.app.inject({ method: "GET", url: "/api/v1/sounds/mine", headers: auth(w.member) });
    assert.deepEqual(
      (mine.json() as { sounds: { serverIds: string[] }[] }).sounds.map((item) => item.serverIds.length),
      [2],
    );

    assert.equal((await call(w.member, `/api/v1/sounds/${own.id}/rename`, { name: "Aplausos" })).statusCode, 200);
    assert.equal((await library(w, w.owner)).sounds?.find((item) => item.id === own.id)?.name, "Aplausos");

    // A plain member cannot remove another's sound; the moderator can, from this server only.
    assert.equal((await call(w.member, `/api/v1/servers/${w.serverId}/sounds/${theirs.id}/remove`)).statusCode, 403);
    assert.equal((await call(w.moderator, `/api/v1/servers/${w.serverId}/sounds/${own.id}/remove`)).statusCode, 200);
    assert.equal(
      (await library(w, w.member)).sounds?.some((item) => item.id === own.id),
      false,
    );
    assert.equal((await library(w, w.member, w.otherServerId)).sounds?.length, 1, "still in the other library");
    assert.equal((await call(w.moderator, `/api/v1/servers/${w.serverId}/sounds/${own.id}/remove`)).statusCode, 404);

    assert.equal((await call(w.member, `/api/v1/sounds/${own.id}/delete`)).statusCode, 200);
    assert.deepEqual((await library(w, w.member, w.otherServerId)).sounds, []);
    const gone = await w.app.inject({ method: "GET", url: `/api/v1/sounds/${own.id}`, headers: auth(w.member) });
    assert.equal(gone.statusCode, 404);
    assert.equal(await soundCount(w.db), 1);
  } finally {
    await w.app.close();
  }
});

test("uploads are rate limited per account; a removed member loses the library", async () => {
  const w = await world();
  try {
    for (let index = 0; index < 20; index++) assert.equal((await upload(w, w.member, `Som ${index}`, 0.1)).statusCode, 201);
    assert.equal((await upload(w, w.member, "Demais", 0.1)).statusCode, 429);
    assert.equal((await upload(w, w.moderator, "Outro", 0.1)).statusCode, 201, "the budget is per account");

    const sample = (await library(w, w.moderator)).sounds?.[0];
    assert.ok(sample);
    await w.db.query("update server_members set removed_at = now() where server_id = $1 and user_id = (select id from users where username = 'mod')", [
      w.serverId,
    ]);
    assert.equal((await library(w, w.moderator)).status, 404);
    // The moderator still owns "Outro"; a sound of someone else is gone for them.
    const foreign = (await library(w, w.member)).sounds?.find((item) => item.name !== "Outro");
    assert.ok(foreign);
    const after = await w.app.inject({ method: "GET", url: `/api/v1/sounds/${foreign.id}`, headers: auth(w.moderator) });
    assert.equal(after.statusCode, 404);
  } finally {
    await w.app.close();
  }
});
