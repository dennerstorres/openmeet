import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { applyMigrations, type MigrationClient } from "../src/db/migrate.js";
import { purgeOrphanAttachments } from "../src/rooms/attachments.js";
import type { RoomMedia } from "../src/rooms/media.js";

// ADR 0024: attachments of text room messages. The bytes decide the type and every answer is a download.
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

interface World {
  app: FastifyInstance;
  db: MigrationClient;
  logs: string[];
  roomId: string;
  voiceId: string;
  owner: string;
  moderator: string;
  member: string;
  outsider: string;
}

interface Attachment {
  id: string;
  name: string;
  contentType: string;
  size: number;
  width: number | null;
  height: number | null;
}

interface Message {
  id: string;
  body: string;
  attachments: Attachment[];
}

async function login(app: FastifyInstance, username: string): Promise<string> {
  const response = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username, password: memberPassword } });
  assert.equal(response.statusCode, 200);
  return (response.json() as { accessToken: string }).accessToken;
}

async function account(app: FastifyInstance, adminToken: string, username: string): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/admin/users",
    headers: auth(adminToken),
    payload: { username, password: memberPassword, displayName: username, role: "participant" },
  });
  assert.equal(response.statusCode, 201);
  return (response.json() as { id: string }).id;
}

async function world(): Promise<World> {
  const db = pgliteClient(new PGlite());
  await applyMigrations(db);
  const media: RoomMedia = { disconnect: async () => undefined, closeRoom: async () => undefined };
  const logs: string[] = [];
  const app = await buildApp({ env, db, media, logStream: { write: (line) => void logs.push(line) } });
  const created = await app.inject({
    method: "POST",
    url: "/api/v1/auth/bootstrap",
    payload: { token: bootstrapToken, username: "admin", password: adminPassword, displayName: "Admin" },
  });
  assert.equal(created.statusCode, 201);
  const owner = (created.json() as { accessToken: string }).accessToken;
  const server = await app.inject({ method: "POST", url: "/api/v1/servers", headers: auth(owner), payload: { name: "Família" } });
  const serverId = (server.json() as { id: string }).id;
  const room = async (slug: string, channel: string | undefined): Promise<string> => {
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/servers/${serverId}/rooms`,
      headers: auth(owner),
      payload: { name: slug, slug, kind: "persistent", channel },
    });
    assert.equal(response.statusCode, 201);
    return (response.json() as { id: string }).id;
  };
  const roomId = await room("geral", "text");
  const voiceId = await room("voz", undefined);
  const moderatorId = await account(app, owner, "mod");
  const memberId = await account(app, owner, "ana");
  await account(app, owner, "fora");
  await db.query("insert into server_members (server_id, user_id, role) values ($1, $2, 'moderator'), ($1, $3, 'participant')", [
    serverId,
    moderatorId,
    memberId,
  ]);
  return {
    app,
    db,
    logs,
    roomId,
    voiceId,
    owner,
    moderator: await login(app, "mod"),
    member: await login(app, "ana"),
    outsider: await login(app, "fora"),
  };
}

// Signature, IHDR (3×2) and IEND: the smallest file the image check accepts. CRCs are not checked.
function png(): Uint8Array {
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 3, 0, 0, 0, 2, 8, 2, 0, 0, 0, 1, 2, 3, 4, 0, 0, 0, 0, 0x49,
    0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ]);
}

function base64(bytes: Uint8Array | string): string {
  return Buffer.from(bytes).toString("base64");
}

async function upload(w: World, token: string, name: unknown, data: string, room = w.roomId) {
  return w.app.inject({ method: "POST", url: `/api/v1/rooms/${room}/attachments`, headers: auth(token), payload: { name, data } });
}

async function send(w: World, token: string, body: unknown, attachmentIds: unknown) {
  return w.app.inject({ method: "POST", url: `/api/v1/rooms/${w.roomId}/messages`, headers: auth(token), payload: { body, attachmentIds } });
}

async function download(w: World, token: string, id: string) {
  return w.app.inject({ method: "GET", url: `/api/v1/attachments/${id}`, headers: auth(token) });
}

test("a picture goes up first, rides on a message and comes back only as a download", async () => {
  const w = await world();
  try {
    const up = await upload(w, w.member, "Férias na praia.png", base64(png()));
    assert.equal(up.statusCode, 201);
    const file = up.json() as Attachment;
    assert.deepEqual({ ...file, id: "" }, { id: "", name: "Férias na praia.png", contentType: "image/png", size: 45, width: 3, height: 2 });
    // Unsent, the file is nobody's to read, not even the uploader's.
    assert.equal((await download(w, w.member, file.id)).statusCode, 404);

    const sent = await send(w, w.member, "", [file.id]);
    assert.equal(sent.statusCode, 201);
    const message = sent.json() as Message;
    assert.equal(message.body, "");
    assert.deepEqual(message.attachments, [file]);
    const listed = await w.app.inject({ method: "GET", url: `/api/v1/rooms/${w.roomId}/messages`, headers: auth(w.owner) });
    assert.deepEqual((listed.json() as { messages: Message[] }).messages.at(-1)?.attachments, [file]);

    const got = await download(w, w.owner, file.id);
    assert.equal(got.statusCode, 200);
    assert.equal(got.headers["content-type"], "image/png");
    assert.equal(got.headers["x-content-type-options"], "nosniff");
    assert.equal(got.headers["content-security-policy"], "default-src 'none'; sandbox");
    assert.equal(got.headers["content-disposition"], "attachment; filename=\"F_rias na praia.png\"; filename*=UTF-8''F%C3%A9rias%20na%20praia.png");
    assert.deepEqual(new Uint8Array(got.rawPayload), png());

    assert.equal((await download(w, w.outsider, file.id)).statusCode, 404);
    assert.equal((await download(w, w.member, "not-an-id")).statusCode, 404);
    assert.equal((await upload(w, w.outsider, "x.png", base64(png()))).statusCode, 404);
    assert.equal((await upload(w, w.member, "x.png", base64(png()), w.voiceId)).statusCode, 409);

    // Removing the message takes the bytes with it.
    const removed = await w.app.inject({ method: "POST", url: `/api/v1/messages/${message.id}/delete`, headers: auth(w.member), payload: {} });
    assert.deepEqual((removed.json() as Message).attachments, []);
    assert.equal((await download(w, w.owner, file.id)).statusCode, 404);
    const left = await w.db.query("select count(*)::int as total from message_attachments where message_id is not null");
    assert.equal(left.rows[0]?.total, 0);
    assert.equal(
      w.logs.some((line) => line.includes("Férias") || line.includes("praia")),
      false,
    );
  } finally {
    await w.app.close();
  }
});

test("a fake picture and an SVG are stored as plain files and never shown inline", async () => {
  const w = await world();
  try {
    const fake = (await upload(w, w.member, "foto.png", base64("<html><script>alert(1)</script></html>"))).json() as Attachment;
    assert.equal(fake.contentType, "application/octet-stream");
    assert.equal(fake.width, null);
    const svg = (await upload(w, w.member, "logo.svg", base64('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'))).json() as Attachment;
    assert.equal(svg.contentType, "application/octet-stream");
    // A PNG cut short is not a picture either.
    const cut = (await upload(w, w.member, "cortada.png", base64(png().subarray(0, 40)))).json() as Attachment;
    assert.equal(cut.contentType, "application/octet-stream");
    assert.equal((await send(w, w.member, "arquivos", [fake.id, svg.id, cut.id])).statusCode, 201);
    for (const file of [fake, svg, cut]) {
      const got = await download(w, w.owner, file.id);
      assert.equal(got.headers["content-type"], "application/octet-stream");
      assert.match(String(got.headers["content-disposition"]), /^attachment; /);
      assert.equal(got.headers["x-content-type-options"], "nosniff");
    }
  } finally {
    await w.app.close();
  }
});

test("names, sizes and claims are checked: over 10 MB is 413, someone else's file is refused", async () => {
  const w = await world();
  try {
    for (const name of ["", "  ", "../etc/passwd", "a\\b.txt", "a\u0000b", "evil‮gnp.exe", "x".repeat(256), 7]) {
      assert.equal((await upload(w, w.member, name, base64("oi"))).statusCode, 400, JSON.stringify(name));
    }
    assert.equal((await upload(w, w.member, "a.txt", "!!!!")).statusCode, 400);
    assert.equal((await upload(w, w.member, "a.txt", "")).statusCode, 400);
    assert.equal((await upload(w, w.member, "grande.bin", base64(new Uint8Array(10 * 1024 * 1024 + 1)))).statusCode, 413);
    assert.equal((await upload(w, w.member, "limite.bin", base64(new Uint8Array(10 * 1024 * 1024)))).statusCode, 201);

    const mine = (await upload(w, w.member, "a.txt", base64("oi"))).json() as Attachment;
    const theirs = (await upload(w, w.moderator, "b.txt", base64("oi"))).json() as Attachment;
    const count = async () => (await w.db.query("select count(*)::int as total from messages")).rows[0]?.total;
    const before = await count();
    assert.equal((await send(w, w.member, "dois", [mine.id, theirs.id])).statusCode, 400);
    assert.equal(await count(), before);
    assert.equal((await send(w, w.member, "", [])).statusCode, 400);
    assert.equal((await send(w, w.member, "dup", [mine.id, mine.id])).statusCode, 400);
    assert.equal(
      (
        await send(
          w,
          w.member,
          "muitos",
          Array.from({ length: 11 }, () => randomUUID()),
        )
      ).statusCode,
      400,
    );
    assert.equal((await send(w, w.member, "ok", [mine.id])).statusCode, 201);
    // Sent once, a file cannot ride on a second message.
    assert.equal((await send(w, w.member, "de novo", [mine.id])).statusCode, 400);
  } finally {
    await w.app.close();
  }
});

test("an upload never sent goes after 24 hours and can no longer be claimed", async () => {
  const w = await world();
  try {
    const old = (await upload(w, w.member, "velho.txt", base64("oi"))).json() as Attachment;
    const fresh = (await upload(w, w.member, "novo.txt", base64("oi"))).json() as Attachment;
    await w.db.query("update message_attachments set created_at = now() - interval '25 hours' where id = $1", [old.id]);
    assert.equal((await send(w, w.member, "atrasado", [old.id])).statusCode, 400);
    assert.equal(await purgeOrphanAttachments(w.db), 1);
    const left = await w.db.query("select id from message_attachments");
    assert.deepEqual(
      left.rows.map((row) => row.id),
      [fresh.id],
    );
    assert.equal((await send(w, w.member, "a tempo", [fresh.id])).statusCode, 201);
    await w.db.query("update message_attachments set created_at = now() - interval '25 hours'");
    // A sent file is never an orphan, however old.
    assert.equal(await purgeOrphanAttachments(w.db), 0);
  } finally {
    await w.app.close();
  }
});

test("the upload budget is 20 MB a minute per person", async () => {
  const w = await world();
  try {
    const ten = base64(new Uint8Array(10 * 1024 * 1024));
    assert.equal((await upload(w, w.member, "1.bin", ten)).statusCode, 201);
    assert.equal((await upload(w, w.member, "2.bin", ten)).statusCode, 201);
    assert.equal((await upload(w, w.member, "3.bin", base64("x"))).statusCode, 429);
    assert.equal((await upload(w, w.moderator, "4.bin", base64("x"))).statusCode, 201);
  } finally {
    await w.app.close();
  }
});

test("a DM takes files too, and only its members read them", async () => {
  const w = await world();
  try {
    const ids = await w.db.query("select id, username from users");
    const id = (name: string) => String(ids.rows.find((row) => row.username === name)?.id);
    const opened = await w.app.inject({ method: "POST", url: "/api/v1/dms", headers: auth(w.member), payload: { userIds: [id("mod")] } });
    assert.ok(opened.statusCode === 200 || opened.statusCode === 201, String(opened.statusCode));
    const dm = (opened.json() as { id: string }).id;
    const up = await w.app.inject({
      method: "POST",
      url: `/api/v1/dms/${dm}/attachments`,
      headers: auth(w.member),
      payload: { name: "foto.png", data: base64(png()) },
    });
    assert.equal(up.statusCode, 201);
    const file = up.json() as Attachment;
    const sent = await w.app.inject({
      method: "POST",
      url: `/api/v1/dms/${dm}/messages`,
      headers: auth(w.member),
      payload: { body: "", attachmentIds: [file.id] },
    });
    assert.equal(sent.statusCode, 201);
    assert.deepEqual((sent.json() as Message).attachments, [file]);
    assert.equal((await download(w, w.moderator, file.id)).statusCode, 200);
    // The server owner is no member of the DM: the file is not there for them.
    assert.equal((await download(w, w.owner, file.id)).statusCode, 404);
    assert.equal((await download(w, w.outsider, file.id)).statusCode, 404);
    const intruder = await w.app.inject({
      method: "POST",
      url: `/api/v1/dms/${dm}/attachments`,
      headers: auth(w.owner),
      payload: { name: "x.txt", data: base64("oi") },
    });
    assert.equal(intruder.statusCode, 404);
  } finally {
    await w.app.close();
  }
});
