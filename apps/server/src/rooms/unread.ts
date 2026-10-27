import type { MigrationClient } from "../db/migrate.js";
import type { PublicUser } from "../auth/service.js";
import { loadChat, messageId, type Chat, type ChatKind } from "./messages.js";
import { RoomError, loadServerAccess, requireMember, roomId, serverId, text } from "./service.js";
import { loadDm } from "./dms.js";

// ADR 0024 (F13-13): what each account has read, and how loud each chat may be. Counting is done on demand
// from the messages table: own and removed messages never count as unread.

export type NotifyLevel = "all" | "mentions" | "none";
const LEVELS: readonly NotifyLevel[] = ["all", "mentions", "none"];

export interface UnreadChat {
  kind: ChatKind;
  id: string;
  /** The server of a text room; null in a DM. */
  serverId: string | null;
  lastReadId: string | null;
  unread: number;
  mentions: number;
  /** What this chat set for itself; null follows the server (rooms) or the default. */
  level: NotifyLevel | null;
}

export interface UnreadState {
  chats: UnreadChat[];
  /** Server levels that were set; a missing server is "mentions". */
  servers: { serverId: string; level: NotifyLevel }[];
}

function level(value: unknown): NotifyLevel | null {
  return typeof value === "string" && (LEVELS as readonly string[]).includes(value) ? (value as NotifyLevel) : null;
}

function count(value: unknown): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

// Both counts for the messages after the last read one; $1 is the account.
const COUNTS = (column: "room_id" | "dm_id", target: string) => `
  (select count(*) from messages m where m.${column} = ${target} and m.deleted_at is null and m.author_id <> $1
     and m.id > coalesce(cr.last_read_id, 0))::int as unread,
  (select count(*) from messages m where m.${column} = ${target} and m.deleted_at is null and m.author_id <> $1
     and m.id > coalesce(cr.last_read_id, 0)
     and (m.mentions_everyone or exists (select 1 from message_mentions x where x.message_id = m.id and x.user_id = $1)))::int as mentions`;

function readChat(row: Record<string, unknown>, kind: ChatKind): UnreadChat | undefined {
  const id = text(row.id);
  if (!id) return undefined;
  return {
    kind,
    id,
    serverId: text(row.server_id) ?? null,
    lastReadId: text(row.last_read_id) ?? null,
    unread: count(row.unread),
    mentions: count(row.mentions),
    level: level(row.level),
  };
}

/** Every text room of the servers the account is in, and every DM it has not left. */
export async function unreadState(db: MigrationClient, actor: PublicUser): Promise<UnreadState> {
  const rooms = await db.query(
    `select r.id::text as id, r.server_id::text as server_id, cr.last_read_id::text as last_read_id, p.level::text as level, ${COUNTS("room_id", "r.id")}
     from server_members sm
     join servers s on s.id = sm.server_id and s.deleted_at is null
     join rooms r on r.server_id = s.id and r.deleted_at is null and r.channel = 'text'
     left join chat_reads cr on cr.user_id = $1 and cr.room_id = r.id
     left join notify_prefs p on p.user_id = $1 and p.room_id = r.id
     where sm.user_id = $1 and sm.removed_at is null`,
    [actor.id],
  );
  const dms = await db.query(
    `select d.dm_id::text as id, cr.last_read_id::text as last_read_id, p.level::text as level, ${COUNTS("dm_id", "d.dm_id")}
     from dm_members d
     left join chat_reads cr on cr.user_id = $1 and cr.dm_id = d.dm_id
     left join notify_prefs p on p.user_id = $1 and p.dm_id = d.dm_id
     where d.user_id = $1 and d.left_at is null`,
    [actor.id],
  );
  const servers = await db.query(
    `select p.server_id::text as server_id, p.level::text as level
     from notify_prefs p join server_members sm on sm.server_id = p.server_id and sm.user_id = $1 and sm.removed_at is null
     where p.user_id = $1 and p.server_id is not null`,
    [actor.id],
  );
  return {
    chats: [
      ...rooms.rows.map((row) => readChat(row, "room")).filter((chat): chat is UnreadChat => chat !== undefined),
      ...dms.rows.map((row) => readChat(row, "dm")).filter((chat): chat is UnreadChat => chat !== undefined),
    ],
    servers: servers.rows.flatMap((row) => {
      const id = text(row.server_id);
      const found = level(row.level);
      return id && found ? [{ serverId: id, level: found }] : [];
    }),
  };
}

async function upsertRead(db: MigrationClient, userId: string, chat: Pick<Chat, "column" | "target">, message: string): Promise<void> {
  // A read never moves back: an older tab that marks an older message leaves the newer read in place.
  await db.query(
    `insert into chat_reads (user_id, ${chat.column}, last_read_id) values ($1, $2, $3::bigint)
     on conflict (user_id, ${chat.column}) where ${chat.column} is not null
     do update set last_read_id = greatest(chat_reads.last_read_id, excluded.last_read_id), updated_at = now()`,
    [userId, chat.target, message],
  );
}

/** The author has read their own message. */
export async function readOwnMessage(db: MigrationClient, userId: string, message: { id: string; roomId: string | null; dmId?: string | null }): Promise<void> {
  const chat = message.dmId
    ? { column: "dm_id" as const, target: message.dmId }
    : message.roomId
      ? { column: "room_id" as const, target: message.roomId }
      : null;
  if (chat) await upsertRead(db, userId, chat, message.id);
}

async function oneChat(db: MigrationClient, actor: PublicUser, chat: Chat, kind: ChatKind): Promise<UnreadChat> {
  const found = await db.query(
    `select $2::uuid::text as id, cr.last_read_id::text as last_read_id, p.level::text as level, ${COUNTS(chat.column, "$2::uuid")}
     from (select 1) one
     left join chat_reads cr on cr.user_id = $1 and cr.${chat.column} = $2::uuid
     left join notify_prefs p on p.user_id = $1 and p.${chat.column} = $2::uuid`,
    [actor.id, chat.target],
  );
  const read = found.rows[0] ? readChat(found.rows[0], kind) : undefined;
  if (!read) throw new RoomError("conflict");
  return { ...read, serverId: chat.room?.serverId ?? null };
}

/**
 * Marks the chat read up to a message of it, or to its newest message when none is named. A message from
 * elsewhere is not found. Answers the new counts.
 */
export async function markRead(db: MigrationClient, actor: PublicUser, id: string, kind: ChatKind, input: { messageId: unknown }): Promise<UnreadChat> {
  if (input.messageId !== undefined && typeof input.messageId !== "string") throw new RoomError("invalid_body");
  const named = input.messageId === undefined ? undefined : messageId(input.messageId);
  const chat = await loadChat(db, actor, id, kind);
  const found = await db.query(
    named === undefined
      ? `select max(id)::text as id from messages where ${chat.column} = $1`
      : `select id::text as id from messages where ${chat.column} = $1 and id = $2::bigint`,
    named === undefined ? [chat.target] : [chat.target, named],
  );
  const message = text(found.rows[0]?.id);
  if (message) await upsertRead(db, actor.id, chat, message);
  else if (named !== undefined) throw new RoomError("message_not_found");
  return oneChat(db, actor, chat, kind);
}

/** Sets (or, with null, clears) the level of a server, a text room or a DM the account belongs to. */
export async function setNotifyLevel(db: MigrationClient, actor: PublicUser, input: { scope: unknown; id: unknown; level: unknown }): Promise<void> {
  const chosen = input.level === null ? null : level(input.level);
  if (chosen === null && input.level !== null) throw new RoomError("invalid_body");
  if (typeof input.id !== "string") throw new RoomError("invalid_body");
  let column: "server_id" | "room_id" | "dm_id";
  let target: string;
  if (input.scope === "server") {
    const access = await loadServerAccess(db, actor, serverId(input.id));
    requireMember(access);
    column = "server_id";
    target = input.id;
  } else if (input.scope === "room") {
    const chat = await loadChat(db, actor, roomId(input.id), "room");
    column = "room_id";
    target = chat.target;
  } else if (input.scope === "dm") {
    const dm = await loadDm(db, actor, input.id);
    column = "dm_id";
    target = dm.id;
  } else {
    throw new RoomError("invalid_body");
  }
  await db.transaction(async (tx) => {
    await tx.query(`delete from notify_prefs where user_id = $1 and ${column} = $2`, [actor.id, target]);
    if (chosen !== null) await tx.query(`insert into notify_prefs (user_id, ${column}, level) values ($1, $2, $3)`, [actor.id, target, chosen]);
  });
}
