import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { applyMigrations, type MigrationClient } from "../src/db/migrate.js";
import { ChatEvents } from "../src/rooms/events.js";
import type { RoomMedia } from "../src/rooms/media.js";

// ADR 0024: the SSE stream per account, its audience, replay and limits.
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
  base: string;
  roomId: string;
  owner: string;
  member: string;
  outsider: string;
  memberId: string;
}

interface Received {
  id: string | undefined;
  name: string;
  data: Record<string, unknown>;
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
  const app = await buildApp({ logger: false, env, db, media });
  const created = await app.inject({
    method: "POST",
    url: "/api/v1/auth/bootstrap",
    payload: { token: bootstrapToken, username: "admin", password: adminPassword, displayName: "Admin" },
  });
  const owner = (created.json() as { accessToken: string }).accessToken;
  const server = await app.inject({ method: "POST", url: "/api/v1/servers", headers: auth(owner), payload: { name: "Família" } });
  const serverId = (server.json() as { id: string }).id;
  const room = await app.inject({
    method: "POST",
    url: `/api/v1/servers/${serverId}/rooms`,
    headers: auth(owner),
    payload: { name: "geral", slug: "geral", kind: "persistent", channel: "text" },
  });
  const memberId = await account(app, owner, "ana");
  await account(app, owner, "fora");
  await db.query("insert into server_members (server_id, user_id, role) values ($1, $2, 'participant')", [serverId, memberId]);
  const base = await app.listen({ port: 0, host: "127.0.0.1" });
  return {
    app,
    db,
    base,
    roomId: (room.json() as { id: string }).id,
    owner,
    member: await login(app, "ana"),
    outsider: await login(app, "fora"),
    memberId,
  };
}

/** Reads SSE frames from a real HTTP connection; comments and `retry` lines are skipped. */
class Stream {
  private buffered = "";
  private readonly queue: Received[] = [];
  private waiting: ((event: Received) => void) | undefined;
  private readonly controller = new AbortController();
  status = 0;

  static async open(base: string, token: string, lastEventId?: string): Promise<Stream> {
    const stream = new Stream();
    const headers: Record<string, string> = auth(token);
    if (lastEventId !== undefined) headers["last-event-id"] = lastEventId;
    const response = await fetch(`${base}/api/v1/events`, { headers, signal: stream.controller.signal });
    stream.status = response.status;
    if (response.ok && response.body) void stream.pump(response.body.getReader());
    else await response.body?.cancel();
    return stream;
  }

  private async pump(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        this.buffered += decoder.decode(value, { stream: true });
        let cut = this.buffered.indexOf("\n\n");
        while (cut >= 0) {
          this.parse(this.buffered.slice(0, cut));
          this.buffered = this.buffered.slice(cut + 2);
          cut = this.buffered.indexOf("\n\n");
        }
      }
    } catch {
      // aborted by close()
    }
  }

  private parse(block: string): void {
    let id: string | undefined;
    let name: string | undefined;
    let data = "";
    for (const line of block.split("\n")) {
      if (line.startsWith("id: ")) id = line.slice(4);
      else if (line.startsWith("event: ")) name = line.slice(7);
      else if (line.startsWith("data: ")) data = line.slice(6);
    }
    if (name === undefined) return;
    const event = { id, name, data: JSON.parse(data) as Record<string, unknown> };
    if (this.waiting) {
      const resolve = this.waiting;
      this.waiting = undefined;
      resolve(event);
    } else this.queue.push(event);
  }

  next(timeoutMs = 2_000): Promise<Received> {
    const queued = this.queue.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting = undefined;
        reject(new Error("no event"));
      }, timeoutMs);
      this.waiting = (event) => {
        clearTimeout(timer);
        resolve(event);
      };
    });
  }

  pending(): number {
    return this.queue.length;
  }

  close(): void {
    this.controller.abort();
  }
}

async function send(w: World, token: string, body: string) {
  const response = await w.app.inject({ method: "POST", url: `/api/v1/rooms/${w.roomId}/messages`, headers: auth(token), payload: { body } });
  assert.equal(response.statusCode, 201);
  return response.json() as { id: string };
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 100));
}

test("server members receive room messages live; outsiders and removed members do not", async () => {
  const w = await world();
  const streams: Stream[] = [];
  try {
    const owner = await Stream.open(w.base, w.owner);
    const member = await Stream.open(w.base, w.member);
    const outsider = await Stream.open(w.base, w.outsider);
    streams.push(owner, member, outsider);
    for (const stream of streams) assert.equal((await stream.next()).name, "ready");

    const sent = await send(w, w.member, "ao vivo");
    for (const stream of [owner, member]) {
      const event = await stream.next();
      assert.equal(event.name, "message.created");
      assert.equal(event.data.id, sent.id);
      assert.equal(event.data.body, "ao vivo");
      assert.equal("canEdit" in event.data, false);
    }

    const edited = await w.app.inject({ method: "POST", url: `/api/v1/messages/${sent.id}/edit`, headers: auth(w.member), payload: { body: "editada" } });
    assert.equal(edited.statusCode, 200);
    assert.equal((await owner.next()).name, "message.updated");
    const removed = await w.app.inject({ method: "POST", url: `/api/v1/messages/${sent.id}/delete`, headers: auth(w.owner), payload: {} });
    assert.equal(removed.statusCode, 200);
    const deleted = await owner.next();
    assert.deepEqual([deleted.name, deleted.data.body, deleted.data.deleted], ["message.deleted", "", true]);

    await w.db.query("update server_members set removed_at = now() where user_id = $1", [w.memberId]);
    await send(w, w.owner, "só para quem ficou");
    assert.equal((await owner.next()).name, "message.created");
    await settle();
    assert.equal(outsider.pending(), 0);
    // The member saw created, updated and deleted, then nothing once removed.
    assert.deepEqual([(await member.next()).name, (await member.next()).name], ["message.updated", "message.deleted"]);
    await settle();
    assert.equal(member.pending(), 0);
  } finally {
    for (const stream of streams) stream.close();
    await w.app.close();
  }
});

test("a reconnect with Last-Event-ID replays what was missed; an unknown id asks for a reset", async () => {
  const w = await world();
  const streams: Stream[] = [];
  try {
    const first = await Stream.open(w.base, w.member);
    streams.push(first);
    const ready = await first.next();
    first.close();
    await settle();
    const one = await send(w, w.owner, "um");
    const two = await send(w, w.owner, "dois");

    const again = await Stream.open(w.base, w.member, ready.id);
    streams.push(again);
    assert.deepEqual([(await again.next()).data.id, (await again.next()).data.id], [one.id, two.id]);
    assert.equal((await again.next()).name, "ready");

    const stale = await Stream.open(w.base, w.member, "000000000000-1");
    streams.push(stale);
    assert.equal((await stale.next()).name, "reset");
  } finally {
    for (const stream of streams) stream.close();
    await w.app.close();
  }
});

test("streams need a session, are limited per account, and typing reaches only the others", async () => {
  const w = await world();
  const streams: Stream[] = [];
  try {
    const anonymous = await fetch(`${w.base}/api/v1/events`);
    assert.equal(anonymous.status, 401);
    await anonymous.body?.cancel();

    for (let index = 0; index < 5; index += 1) {
      const stream = await Stream.open(w.base, w.member);
      streams.push(stream);
      assert.equal(stream.status, 200);
      assert.equal((await stream.next()).name, "ready");
    }
    const sixth = await Stream.open(w.base, w.member);
    assert.equal(sixth.status, 429);

    const owner = await Stream.open(w.base, w.owner);
    streams.push(owner);
    await owner.next();
    const typed = await w.app.inject({ method: "POST", url: `/api/v1/rooms/${w.roomId}/typing`, headers: auth(w.owner), payload: {} });
    assert.equal(typed.statusCode, 204);
    const typing = await streams[0]?.next();
    assert.deepEqual([typing?.name, typing?.id, typing?.data.roomId], ["typing", undefined, w.roomId]);
    await settle();
    assert.equal(owner.pending(), 0);
    const outsider = await w.app.inject({ method: "POST", url: `/api/v1/rooms/${w.roomId}/typing`, headers: auth(w.outsider), payload: {} });
    assert.equal(outsider.statusCode, 404);
  } finally {
    for (const stream of streams) stream.close();
    await w.app.close();
  }
});

test("the keepalive tick closes streams whose session was revoked", async () => {
  const w = await world();
  try {
    const events = new ChatEvents(w.db, 60_000);
    const sessions = await w.db.query("select id from refresh_sessions where user_id = $1", [w.memberId]);
    const sessionId = String(sessions.rows[0]?.id);
    const written: string[] = [];
    let ended = false;
    events.open(w.memberId, sessionId, { write: (chunk) => void written.push(chunk), end: () => (ended = true) }, undefined);
    await events.tick();
    assert.equal(ended, false);
    assert.ok(written.includes(": keepalive\n\n"));
    await w.db.query("update refresh_sessions set revoked_at = now() where id = $1", [sessionId]);
    await events.tick();
    assert.equal(ended, true);
    assert.equal(events.size, 0);
  } finally {
    await w.app.close();
  }
});
