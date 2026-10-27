import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { applyMigrations, type MigrationClient } from "../src/db/migrate.js";
import type { RoomMedia } from "../src/rooms/media.js";

// ADR 0024 (F13-11): direct and group DMs, blocks, and who hears them on the live stream.
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

interface Person {
  id: string;
  token: string;
}

interface World {
  app: FastifyInstance;
  db: MigrationClient;
  base: string;
  serverId: string;
  /** Owner of the server and admin of the instance. */
  owner: Person;
  ana: Person;
  bia: Person;
  /** Shares no server with anyone. */
  fora: Person;
  /** Nine more members of the server, for the group limit. */
  crowd: Person[];
}

interface Dm {
  id: string;
  kind: string;
  name: string | null;
  createdBy: string;
  memberIds: string[];
  members: { id: string; label: string; avatarId: string | null }[];
  readOnly: boolean;
}

interface Message {
  id: string;
  roomId: string | null;
  dmId: string | null;
  authorId: string;
  body: string;
  pinned: boolean;
  canDelete: boolean;
}

async function person(app: FastifyInstance, adminToken: string, username: string): Promise<Person> {
  const created = await app.inject({
    method: "POST",
    url: "/api/v1/admin/users",
    headers: auth(adminToken),
    payload: { username, password: memberPassword, displayName: username, role: "participant" },
  });
  assert.equal(created.statusCode, 201);
  const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username, password: memberPassword } });
  assert.equal(login.statusCode, 200);
  return { id: (created.json() as { id: string }).id, token: (login.json() as { accessToken: string }).accessToken };
}

async function world(listen = false): Promise<World> {
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
  const ownerToken = (created.json() as { accessToken: string }).accessToken;
  const ownerId = (await db.query("select id from users where username = 'admin'")).rows[0]?.id as string;
  const server = await app.inject({ method: "POST", url: "/api/v1/servers", headers: auth(ownerToken), payload: { name: "Família" } });
  const serverId = (server.json() as { id: string }).id;
  const join = async (member: Person) =>
    db.query("insert into server_members (server_id, user_id, role) values ($1, $2, 'participant')", [serverId, member.id]);
  const ana = await person(app, ownerToken, "ana");
  const bia = await person(app, ownerToken, "bia");
  const fora = await person(app, ownerToken, "fora");
  await join(ana);
  await join(bia);
  const crowd: Person[] = [];
  for (let index = 0; index < 9; index += 1) {
    const member = await person(app, ownerToken, `p${index}`);
    await join(member);
    crowd.push(member);
  }
  const base = listen ? await app.listen({ port: 0, host: "127.0.0.1" }) : "";
  return { app, db, base, serverId, owner: { id: ownerId, token: ownerToken }, ana, bia, fora, crowd };
}

async function open(w: World, who: Person, userIds: string[], name?: unknown) {
  const response = await w.app.inject({ method: "POST", url: "/api/v1/dms", headers: auth(who.token), payload: { userIds, name } });
  return { status: response.statusCode, dm: response.json() as Dm };
}

async function call(w: World, who: Person, method: "GET" | "POST", url: string, payload?: Record<string, unknown>) {
  const response = await w.app.inject({ method, url, headers: auth(who.token), ...(method === "POST" ? { payload: payload ?? {} } : {}) });
  return { status: response.statusCode, body: response.statusCode === 204 ? undefined : (response.json() as unknown) };
}

test("a direct DM is one per pair and only opens with someone who shares a server", async () => {
  const w = await world();
  try {
    const first = await open(w, w.ana, [w.bia.id]);
    assert.equal(first.status, 201);
    assert.equal(first.dm.kind, "direct");
    assert.deepEqual([...first.dm.memberIds].sort(), [w.ana.id, w.bia.id].sort());
    // The account names travel with the DM, so the client shows them outside any server.
    assert.deepEqual(
      first.dm.members.map((member) => member.id),
      first.dm.memberIds,
    );
    assert.equal(
      first.dm.members.every((member) => member.label.length > 0 && member.avatarId === null),
      true,
    );
    const again = await open(w, w.ana, [w.bia.id]);
    assert.deepEqual([again.status, again.dm.id], [200, first.dm.id]);
    const back = await open(w, w.bia, [w.ana.id]);
    assert.deepEqual([back.status, back.dm.id], [200, first.dm.id]);
    assert.equal((await w.db.query("select count(*)::int as total from dm_channels")).rows[0]?.total, 1);

    assert.equal((await open(w, w.ana, [w.fora.id])).status, 404);
    assert.equal((await open(w, w.ana, ["00000000-0000-4000-8000-000000000000"])).status, 404);
    assert.equal((await open(w, w.ana, [w.ana.id])).status, 400);
    assert.equal((await open(w, w.ana, [])).status, 400);
    assert.equal((await open(w, w.ana, ["not-a-uuid"])).status, 400);
    // Someone who left every shared server is out of reach for a new DM.
    await w.db.query("update server_members set removed_at = now() where user_id = $1", [w.crowd[0]?.id]);
    assert.equal((await open(w, w.ana, [w.crowd[0]?.id ?? ""])).status, 404);

    const listed = await call(w, w.bia, "GET", "/api/v1/dms");
    assert.deepEqual(
      (listed.body as { dms: Dm[] }).dms.map((dm) => dm.id),
      [first.dm.id],
    );
    assert.deepEqual((await call(w, w.fora, "GET", "/api/v1/dms")).body, { dms: [] });
  } finally {
    await w.app.close();
  }
});

test("only DM members read and write it; owners, moderators and the admin do not", async () => {
  const w = await world();
  try {
    const { dm } = await open(w, w.ana, [w.bia.id]);
    const sent = await call(w, w.ana, "POST", `/api/v1/dms/${dm.id}/messages`, { body: "oi, bia" });
    assert.equal(sent.status, 201);
    const message = sent.body as Message;
    assert.deepEqual([message.dmId, message.roomId, message.authorId], [dm.id, null, w.ana.id]);

    const read = await call(w, w.bia, "GET", `/api/v1/dms/${dm.id}/messages`);
    assert.equal(read.status, 200);
    assert.deepEqual(
      (read.body as { messages: Message[] }).messages.map((item) => [item.body, item.canDelete]),
      [["oi, bia", false]],
    );
    const reply = await call(w, w.bia, "POST", `/api/v1/dms/${dm.id}/messages`, { body: "oi!", replyToId: message.id });
    assert.equal(reply.status, 201);

    // The instance admin owns the server both are in, and still sees nothing.
    for (const outsider of [w.owner, w.fora]) {
      assert.equal((await call(w, outsider, "GET", `/api/v1/dms/${dm.id}`)).status, 404);
      assert.equal((await call(w, outsider, "GET", `/api/v1/dms/${dm.id}/messages`)).status, 404);
      assert.equal((await call(w, outsider, "POST", `/api/v1/dms/${dm.id}/messages`, { body: "intruso" })).status, 404);
      assert.equal((await call(w, outsider, "GET", `/api/v1/dms/${dm.id}/pins`)).status, 404);
      assert.equal((await call(w, outsider, "POST", `/api/v1/dms/${dm.id}/messages/search`, { query: "bia" })).status, 404);
      assert.equal((await call(w, outsider, "POST", `/api/v1/dms/${dm.id}/typing`)).status, 404);
      assert.equal((await call(w, outsider, "POST", `/api/v1/messages/${message.id}/delete`)).status, 404);
      assert.equal((await call(w, outsider, "POST", `/api/v1/messages/${message.id}/pin`, { pinned: true })).status, 404);
      assert.equal((await call(w, outsider, "POST", `/api/v1/messages/${message.id}/reactions`, { emoji: "👍", on: true })).status, 404);
    }
    // A DM id used as a room, or a room action on it, is not found either.
    assert.equal((await call(w, w.ana, "GET", `/api/v1/rooms/${dm.id}/messages`)).status, 404);

    // Any member pins; only the author removes.
    const pinned = await call(w, w.bia, "POST", `/api/v1/messages/${message.id}/pin`, { pinned: true });
    assert.equal((pinned.body as Message).pinned, true);
    assert.equal(((await call(w, w.ana, "GET", `/api/v1/dms/${dm.id}/pins`)).body as { messages: Message[] }).messages.length, 1);
    assert.equal((await call(w, w.bia, "POST", `/api/v1/messages/${message.id}/delete`)).status, 403);
    assert.equal((await call(w, w.bia, "POST", `/api/v1/messages/${message.id}/edit`, { body: "não é meu" })).status, 403);
    assert.equal((await call(w, w.bia, "POST", `/api/v1/messages/${message.id}/reactions`, { emoji: "👍", on: true })).status, 200);
    const found = await call(w, w.bia, "POST", `/api/v1/dms/${dm.id}/messages/search`, { query: "bia" });
    assert.equal((found.body as { messages: Message[] }).messages.length, 1);
    assert.equal((await call(w, w.ana, "POST", `/api/v1/messages/${message.id}/delete`)).status, 200);
  } finally {
    await w.app.close();
  }
});

test("a group holds up to ten people; the creator adds and renames, anyone leaves and then reads nothing", async () => {
  const w = await world();
  try {
    const everyone = [w.bia, ...w.crowd].map((member) => member.id);
    assert.equal(everyone.length, 10);
    assert.deepEqual(await open(w, w.ana, everyone).then((result) => result.status), 409);
    assert.equal((await open(w, w.ana, [w.bia.id, w.crowd[0]?.id ?? ""], "\u0007")).status, 400);

    const created = await open(w, w.ana, everyone.slice(0, 8), "Turma");
    assert.equal(created.status, 201);
    assert.deepEqual([created.dm.kind, created.dm.name, created.dm.memberIds.length], ["group", "Turma", 9]);
    // A second group with the same people is a new group, unlike a direct DM.
    const second = await open(w, w.ana, [w.bia.id], "Só nós");
    assert.deepEqual([second.status, second.dm.kind], [201, "group"]);

    const id = created.dm.id;
    const ninth = w.crowd[7];
    const tenth = w.crowd[8];
    assert.ok(ninth && tenth);
    assert.equal((await call(w, w.bia, "POST", `/api/v1/dms/${id}/members`, { userId: ninth.id })).status, 403);
    const added = await call(w, w.ana, "POST", `/api/v1/dms/${id}/members`, { userId: ninth.id });
    assert.equal((added.body as Dm).memberIds.length, 10);
    assert.equal((await call(w, w.ana, "POST", `/api/v1/dms/${id}/members`, { userId: ninth.id })).status, 200);
    assert.equal((await call(w, w.ana, "POST", `/api/v1/dms/${id}/members`, { userId: tenth.id })).status, 409);
    assert.equal((await call(w, w.ana, "POST", `/api/v1/dms/${id}/members`, { userId: w.fora.id })).status, 404);

    assert.equal((await call(w, w.bia, "POST", `/api/v1/dms/${id}/rename`, { name: "Minha" })).status, 403);
    assert.equal(((await call(w, w.ana, "POST", `/api/v1/dms/${id}/rename`, { name: "Turma 2" })).body as Dm).name, "Turma 2");
    assert.equal(((await call(w, w.ana, "POST", `/api/v1/dms/${id}/rename`, { name: null })).body as Dm).name, null);

    assert.equal((await call(w, w.bia, "POST", `/api/v1/dms/${id}/messages`, { body: "antes de sair" })).status, 201);
    const left = await call(w, w.bia, "POST", `/api/v1/dms/${id}/leave`);
    assert.equal((left.body as Dm).memberIds.includes(w.bia.id), false);
    assert.equal((await call(w, w.bia, "GET", `/api/v1/dms/${id}/messages`)).status, 404);
    assert.equal((await call(w, w.bia, "POST", `/api/v1/dms/${id}/messages`, { body: "voltei?" })).status, 404);
    assert.equal(
      ((await call(w, w.bia, "GET", "/api/v1/dms")).body as { dms: Dm[] }).dms.some((dm) => dm.id === id),
      false,
    );
    // Her place is free again.
    assert.equal((await call(w, w.ana, "POST", `/api/v1/dms/${id}/members`, { userId: tenth.id })).status, 200);

    // The creator leaving hands adding and renaming to the longest-standing member.
    const handed = await call(w, w.ana, "POST", `/api/v1/dms/${id}/leave`);
    assert.notEqual((handed.body as Dm).createdBy, w.ana.id);
    assert.equal((handed.body as Dm).memberIds.includes((handed.body as Dm).createdBy), true);

    const direct = await open(w, w.bia, [w.owner.id]);
    assert.equal((await call(w, w.bia, "POST", `/api/v1/dms/${direct.dm.id}/leave`)).status, 409);
    assert.equal((await call(w, w.bia, "POST", `/api/v1/dms/${direct.dm.id}/members`, { userId: w.ana.id })).status, 409);
  } finally {
    await w.app.close();
  }
});

test("a block keeps the blocked one out and leaves an existing direct DM read only", async () => {
  const w = await world();
  try {
    const { dm } = await open(w, w.ana, [w.bia.id]);
    const before = await call(w, w.bia, "POST", `/api/v1/dms/${dm.id}/messages`, { body: "oi" });
    const message = before.body as Message;

    assert.equal((await call(w, w.ana, "POST", `/api/v1/users/${w.bia.id}/block`, { blocked: true })).status, 204);
    assert.equal((await call(w, w.ana, "POST", `/api/v1/users/${w.bia.id}/block`, { blocked: true })).status, 204);
    assert.deepEqual((await call(w, w.ana, "GET", "/api/v1/blocks")).body, { userIds: [w.bia.id] });
    assert.deepEqual((await call(w, w.bia, "GET", "/api/v1/blocks")).body, { userIds: [] });
    assert.equal((await call(w, w.ana, "POST", `/api/v1/users/${w.ana.id}/block`, { blocked: true })).status, 400);
    assert.equal((await call(w, w.ana, "POST", "/api/v1/users/00000000-0000-4000-8000-000000000000/block", { blocked: true })).status, 404);

    // History stays readable, nobody writes, and the DM says so.
    assert.equal(((await call(w, w.bia, "GET", `/api/v1/dms/${dm.id}`)).body as Dm).readOnly, true);
    assert.equal((await call(w, w.bia, "GET", `/api/v1/dms/${dm.id}/messages`)).status, 200);
    for (const who of [w.bia, w.ana]) {
      const refused = await call(w, who, "POST", `/api/v1/dms/${dm.id}/messages`, { body: "ainda aí?" });
      assert.deepEqual([refused.status, refused.body], [403, { error: "blocked" }]);
      assert.equal((await call(w, who, "POST", `/api/v1/dms/${dm.id}/typing`)).status, 403);
      assert.equal((await call(w, who, "POST", `/api/v1/messages/${message.id}/reactions`, { emoji: "👍", on: true })).status, 403);
    }
    assert.equal((await call(w, w.bia, "POST", `/api/v1/messages/${message.id}/edit`, { body: "editada" })).status, 403);
    // The existing DM still opens; a group with the blocker does not, either way round.
    assert.equal((await open(w, w.bia, [w.ana.id])).status, 200);
    assert.equal((await open(w, w.bia, [w.ana.id, w.owner.id])).status, 403);
    assert.equal((await open(w, w.ana, [w.bia.id, w.owner.id])).status, 403);
    // A block is between two people: a third may still bring both into a group.
    const group = await open(w, w.owner, [w.ana.id], "Grupo");
    assert.equal((await call(w, w.owner, "POST", `/api/v1/dms/${group.dm.id}/members`, { userId: w.bia.id })).status, 200);

    // A new direct DM with the blocker is refused.
    await w.db.query("delete from dm_members where dm_id = $1", [dm.id]);
    await w.db.query("delete from messages where dm_id = $1", [dm.id]);
    await w.db.query("delete from dm_channels where id = $1", [dm.id]);
    assert.deepEqual(await open(w, w.bia, [w.ana.id]).then((result) => result.status), 403);

    assert.equal((await call(w, w.ana, "POST", `/api/v1/users/${w.bia.id}/block`, { blocked: false })).status, 204);
    const reopened = await open(w, w.bia, [w.ana.id]);
    assert.deepEqual([reopened.status, reopened.dm.readOnly], [201, false]);
    assert.equal((await call(w, w.bia, "POST", `/api/v1/dms/${reopened.dm.id}/messages`, { body: "de novo" })).status, 201);
  } finally {
    await w.app.close();
  }
});

interface Received {
  name: string;
  data: Record<string, unknown>;
}

/** Reads SSE frames from a real HTTP connection; `ready` and comments are skipped. */
class Stream {
  private buffered = "";
  private readonly queue: Received[] = [];
  private waiting: ((event: Received) => void) | undefined;
  private readonly controller = new AbortController();

  static async open(base: string, token: string): Promise<Stream> {
    const stream = new Stream();
    const response = await fetch(`${base}/api/v1/events`, { headers: auth(token), signal: stream.controller.signal });
    assert.equal(response.status, 200);
    if (response.body) void stream.pump(response.body.getReader());
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
    let name: string | undefined;
    let data = "";
    for (const line of block.split("\n")) {
      if (line.startsWith("event: ")) name = line.slice(7);
      else if (line.startsWith("data: ")) data = line.slice(6);
    }
    if (name === undefined || name === "ready") return;
    const event = { name, data: JSON.parse(data) as Record<string, unknown> };
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

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 150));
}

test("DM events reach only its active members, never the server owner or someone who left", async () => {
  const w = await world(true);
  const streams: Stream[] = [];
  try {
    const owner = await Stream.open(w.base, w.owner.token);
    const ana = await Stream.open(w.base, w.ana.token);
    const bia = await Stream.open(w.base, w.bia.token);
    const fora = await Stream.open(w.base, w.fora.token);
    streams.push(owner, ana, bia, fora);
    await settle();

    const { dm } = await open(w, w.ana, [w.bia.id]);
    for (const stream of [ana, bia]) {
      const event = await stream.next();
      assert.deepEqual([event.name, event.data.id], ["dm.created", dm.id]);
    }
    const sent = await call(w, w.ana, "POST", `/api/v1/dms/${dm.id}/messages`, { body: "segredo" });
    for (const stream of [ana, bia]) {
      const event = await stream.next();
      assert.deepEqual([event.name, event.data.id, event.data.dmId, event.data.body], ["message.created", (sent.body as Message).id, dm.id, "segredo"]);
      assert.equal("canDelete" in event.data, false);
    }
    assert.equal((await call(w, w.ana, "POST", `/api/v1/dms/${dm.id}/typing`)).status, 204);
    assert.deepEqual((await bia.next()).data, { dmId: dm.id, userId: w.ana.id });

    await call(w, w.ana, "POST", `/api/v1/users/${w.bia.id}/block`, { blocked: true });
    for (const stream of [ana, bia]) {
      const event = await stream.next();
      assert.deepEqual([event.name, event.data.readOnly], ["dm.updated", true]);
    }

    const group = await open(w, w.ana, [w.crowd[0]?.id ?? "", w.owner.id], "Grupo");
    for (const stream of [ana, owner]) assert.equal((await stream.next()).name, "dm.created");
    await call(w, w.owner, "POST", `/api/v1/dms/${group.dm.id}/leave`);
    for (const stream of [ana, owner]) assert.equal((await stream.next()).name, "dm.updated");
    await call(w, w.ana, "POST", `/api/v1/dms/${group.dm.id}/messages`, { body: "só quem ficou" });
    assert.equal((await ana.next()).name, "message.created");

    await settle();
    assert.equal(owner.pending(), 0);
    assert.equal(bia.pending(), 0);
    assert.equal(fora.pending(), 0);
  } finally {
    for (const stream of streams) stream.close();
    await w.app.close();
  }
});
