import { randomBytes } from "node:crypto";
import type { MigrationClient } from "../db/migrate.js";
import { text } from "./service.js";

// ADR 0024: one SSE stream per client with everything the account may see. The hub lives in memory on the
// single API node, like platform presence (ADR 0017). Each event id is "<epoch>-<seq>": a restarted API has a
// new epoch, so a client that comes back with an old id is told to reload instead of being replayed wrongly.

export const STREAMS_PER_USER = 5;
const KEEPALIVE_MS = 25_000;
const REPLAY_SIZE = 2_000;

export type ChatEventName =
  "message.created" | "message.updated" | "message.deleted" | "reaction" | "typing" | "read" | "mention" | "dm.created" | "dm.updated" | "emoji.updated";

export interface StreamSink {
  write(chunk: string): void;
  end(): void;
}

interface Stream {
  userId: string;
  sessionId: string;
  sink: StreamSink;
}

interface Buffered {
  seq: number;
  name: ChatEventName;
  data: string;
  audience: ReadonlySet<string>;
}

function frame(id: string | undefined, name: string, data: string): string {
  return `${id === undefined ? "" : `id: ${id}\n`}event: ${name}\ndata: ${data}\n\n`;
}

export class ChatEvents {
  readonly epoch = randomBytes(6).toString("hex");
  private seq = 0;
  private readonly buffer: Buffered[] = [];
  private readonly streams = new Set<Stream>();
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly db: MigrationClient,
    private readonly keepaliveMs = KEEPALIVE_MS,
  ) {}

  full(userId: string): boolean {
    let held = 0;
    for (const stream of this.streams) if (stream.userId === userId) held += 1;
    return held >= STREAMS_PER_USER;
  }

  /** Undefined when the account already holds STREAMS_PER_USER streams. */
  open(userId: string, sessionId: string, sink: StreamSink, lastEventId: string | undefined): (() => void) | undefined {
    if (this.full(userId)) return undefined;
    const stream: Stream = { userId, sessionId, sink };
    this.streams.add(stream);
    sink.write(`retry: 3000\n\n`);
    this.replay(stream, lastEventId);
    this.startKeepalive();
    return () => this.close(stream);
  }

  // Replays what the account missed, or tells it to reload when the gap is gone (restart or buffer overrun).
  private replay(stream: Stream, lastEventId: string | undefined): void {
    if (lastEventId === undefined || lastEventId === "") {
      stream.sink.write(frame(this.currentId(), "ready", "{}"));
      return;
    }
    const [epoch, raw] = lastEventId.split("-");
    const last = Number(raw);
    const oldest = this.buffer[0]?.seq ?? this.seq + 1;
    if (epoch !== this.epoch || !Number.isInteger(last) || last > this.seq || last < oldest - 1) {
      stream.sink.write(frame(this.currentId(), "reset", "{}"));
      return;
    }
    for (const event of this.buffer) {
      if (event.seq > last && event.audience.has(stream.userId)) stream.sink.write(frame(`${this.epoch}-${event.seq}`, event.name, event.data));
    }
    stream.sink.write(frame(this.currentId(), "ready", "{}"));
  }

  private currentId(): string {
    return `${this.epoch}-${this.seq}`;
  }

  /** Sends to every open stream of these accounts and keeps it for replay. */
  publish(audience: Iterable<string>, name: ChatEventName, payload: unknown): void {
    this.seq += 1;
    const event: Buffered = { seq: this.seq, name, data: JSON.stringify(payload), audience: new Set(audience) };
    this.buffer.push(event);
    if (this.buffer.length > REPLAY_SIZE) this.buffer.shift();
    const line = frame(`${this.epoch}-${event.seq}`, name, event.data);
    for (const stream of this.streams) if (event.audience.has(stream.userId)) stream.sink.write(line);
  }

  /** Short-lived signals such as typing: not numbered, not replayed. */
  signal(audience: Iterable<string>, name: ChatEventName, payload: unknown): void {
    const targets = new Set(audience);
    const line = frame(undefined, name, JSON.stringify(payload));
    for (const stream of this.streams) if (targets.has(stream.userId)) stream.sink.write(line);
  }

  /** Active members of the server that holds this live room. */
  async roomAudience(roomId: string): Promise<string[]> {
    const found = await this.db.query(
      `select m.user_id
       from rooms r
       join servers s on s.id = r.server_id and s.deleted_at is null
       join server_members m on m.server_id = r.server_id and m.removed_at is null
       where r.id = $1 and r.deleted_at is null`,
      [roomId],
    );
    return found.rows.map((row) => text(row.user_id)).filter((id): id is string => id !== undefined);
  }

  /** Active members of a live server: who sees its emojis change. */
  async serverAudience(serverId: string): Promise<string[]> {
    const found = await this.db.query(
      `select m.user_id from servers s join server_members m on m.server_id = s.id and m.removed_at is null
       where s.id = $1 and s.deleted_at is null`,
      [serverId],
    );
    return found.rows.map((row) => text(row.user_id)).filter((id): id is string => id !== undefined);
  }

  /** Members of a DM who have not left it: nobody else, not even an admin, hears it. */
  async dmAudience(dmId: string): Promise<string[]> {
    const found = await this.db.query("select user_id from dm_members where dm_id = $1 and left_at is null", [dmId]);
    return found.rows.map((row) => text(row.user_id)).filter((id): id is string => id !== undefined);
  }

  /** Ends the streams of one account now, for logout or a disabled account. */
  closeUser(userId: string): void {
    for (const stream of [...this.streams]) if (stream.userId === userId) this.close(stream);
  }

  closeAll(): void {
    for (const stream of [...this.streams]) this.close(stream);
  }

  get size(): number {
    return this.streams.size;
  }

  private close(stream: Stream): void {
    if (!this.streams.delete(stream)) return;
    stream.sink.end();
    if (this.streams.size === 0) this.stopKeepalive();
  }

  private startKeepalive(): void {
    if (this.timer !== undefined) return;
    this.timer = setInterval(() => void this.tick(), this.keepaliveMs);
    this.timer.unref();
  }

  private stopKeepalive(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
  }

  // Each tick also checks the session behind every stream: a revoked, expired or disabled one is closed.
  async tick(): Promise<void> {
    for (const stream of [...this.streams]) {
      const alive = await this.db.query(
        `select 1
         from refresh_sessions s
         join users u on u.id = s.user_id and u.disabled_at is null
         where s.id = $1 and s.user_id = $2 and s.revoked_at is null and s.expires_at > now()`,
        [stream.sessionId, stream.userId],
      );
      if (alive.rows[0] === undefined) this.close(stream);
      else stream.sink.write(": keepalive\n\n");
    }
  }
}
