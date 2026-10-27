import type { MigrationClient } from "../db/migrate.js";
import type { PublicUser } from "../auth/service.js";
import { RoomError, canManage, loadRoomAccess, requireMember, roomId, text, type RoomRecord } from "./service.js";

// ADR 0024: messages of text rooms. A removed message keeps its row with an empty body, so replies and
// cursors stay whole. DMs (F13-11) reuse the same table with dm_id.

export const MESSAGE_MAX_CHARS = 4000;
export const PAGE_SIZE = 50;
const AFTER_PAGE_SIZE = 100;
const SEARCH_MAX_CHARS = 100;
const SEARCH_PAGE_SIZE = 25;
const REPLY_PREVIEW_CHARS = 200;
const AROUND_SIDE = 25;
/** Like Discord: at most 20 different reactions on one message. */
export const REACTIONS_PER_MESSAGE = 20;
const MESSAGE_ID = /^[1-9][0-9]{0,17}$/;
// C0 controls other than tab and newline, DEL, and bidi overrides that can disguise a link.
function hidden(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if ((code < 32 && code !== 9 && code !== 10) || code === 127 || (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069)) return true;
  }
  return false;
}

export interface MessageView {
  id: string;
  roomId: string;
  authorId: string;
  body: string;
  replyTo: { id: string; authorId: string; body: string; deleted: boolean } | null;
  pinned: boolean;
  edited: boolean;
  deleted: boolean;
  createdAt: string;
  /** Who reacted is public in the room, so the same list serves every viewer and the live events. */
  reactions: { emoji: string; userIds: string[] }[];
  canEdit: boolean;
  canDelete: boolean;
}

export interface MessagePage {
  messages: MessageView[];
  hasMore: boolean;
  /** Only with `around`: newer messages exist past this page. */
  hasNewer?: boolean;
}

interface Chat {
  room: RoomRecord;
  moderator: boolean;
}

export function messageId(value: string): string {
  if (!MESSAGE_ID.test(value)) throw new RoomError("message_not_found");
  return value;
}

/** Newlines are kept and CRLF becomes LF; anything hidden is refused, never cleaned in silence. */
export function parseBody(value: unknown): string {
  if (typeof value !== "string") throw new RoomError("invalid_message");
  const body = value.replace(/\r\n?/g, "\n");
  if (body.trim().length === 0 || [...body].length > MESSAGE_MAX_CHARS || hidden(body)) throw new RoomError("invalid_message");
  return body;
}

function cursor(value: string | undefined): string | undefined {
  if (value === undefined || value === "") return undefined;
  if (!MESSAGE_ID.test(value)) throw new RoomError("invalid_body");
  return value;
}

// A voice room has no messages; a missing room and a room in someone else's server look the same.
async function textRoom(db: MigrationClient, actor: PublicUser, id: string): Promise<Chat> {
  const { room, access } = await loadRoomAccess(db, actor, roomId(id));
  requireMember(access);
  if (room.channel !== "text") throw new RoomError("voice_room");
  return { room, moderator: canManage(access.membership) };
}

/** Typing is only signalled into a text room the caller may write in. */
export async function typingRoom(db: MigrationClient, actor: PublicUser, id: string): Promise<string> {
  const chat = await textRoom(db, actor, id);
  if (chat.room.ended) throw new RoomError("room_ended");
  return chat.room.id;
}

/** What every member receives: the flags that depend on the viewer are left to each client. */
export function publicMessage(view: MessageView): Omit<MessageView, "canEdit" | "canDelete"> {
  return {
    reactions: view.reactions,
    id: view.id,
    roomId: view.roomId,
    authorId: view.authorId,
    body: view.body,
    replyTo: view.replyTo,
    pinned: view.pinned,
    edited: view.edited,
    deleted: view.deleted,
    createdAt: view.createdAt,
  };
}

const SELECT = `
  select m.id::text as id, m.room_id, m.author_id, m.body, m.pinned_at is not null as pinned, m.edited_at is not null as edited,
         m.deleted_at is not null as deleted, m.created_at,
         r.id::text as reply_id, r.author_id as reply_author, left(r.body, ${REPLY_PREVIEW_CHARS}) as reply_body, r.deleted_at is not null as reply_deleted,
         coalesce((
           select json_agg(json_build_object('emoji', x.emoji, 'userIds', x.users) order by x.first, x.emoji)
           from (
             select emoji, array_agg(user_id::text order by created_at, user_id) as users, min(created_at) as first
             from message_reactions where message_id = m.id group by emoji
           ) x
         ), '[]'::json) as reactions
  from messages m
  left join messages r on r.id = m.reply_to_id`;

function readMessage(row: Record<string, unknown>, actor: PublicUser, chat: Chat): MessageView {
  const id = text(row.id) ?? "";
  const authorId = text(row.author_id) ?? "";
  const deleted = row.deleted === true;
  const replyId = text(row.reply_id);
  const mine = authorId === actor.id;
  return {
    id,
    roomId: text(row.room_id) ?? chat.room.id,
    authorId,
    body: deleted ? "" : typeof row.body === "string" ? row.body : "",
    replyTo: replyId
      ? {
          id: replyId,
          authorId: text(row.reply_author) ?? "",
          body: row.reply_deleted === true ? "" : typeof row.reply_body === "string" ? row.reply_body : "",
          deleted: row.reply_deleted === true,
        }
      : null,
    pinned: row.pinned === true,
    edited: row.edited === true,
    deleted,
    createdAt: new Date(String(row.created_at)).toISOString(),
    reactions: readReactions(row.reactions),
    canEdit: mine && !deleted,
    canDelete: !deleted && (mine || chat.moderator),
  };
}

function readReactions(value: unknown): MessageView["reactions"] {
  const list: unknown = typeof value === "string" ? JSON.parse(value) : value;
  if (!Array.isArray(list)) return [];
  return list.flatMap((item: unknown) => {
    if (typeof item !== "object" || item === null) return [];
    const { emoji, userIds } = item as { emoji?: unknown; userIds?: unknown };
    if (typeof emoji !== "string" || !Array.isArray(userIds)) return [];
    return [{ emoji, userIds: userIds.filter((user): user is string => typeof user === "string") }];
  });
}

/**
 * Newest page with no cursor, older with `before`, newer with `after` (oldest first, as the client catches up),
 * and with `around` the message itself between up to 25 older and 25 newer, to jump to it.
 */
export async function listMessages(
  db: MigrationClient,
  actor: PublicUser,
  id: string,
  query: { before?: string | undefined; after?: string | undefined; around?: string | undefined },
): Promise<MessagePage> {
  const before = cursor(query.before);
  const after = cursor(query.after);
  const around = cursor(query.around);
  if ([before, after, around].filter((value) => value !== undefined).length > 1) throw new RoomError("invalid_body");
  const chat = await textRoom(db, actor, id);
  if (around !== undefined) {
    const older = await db.query(`${SELECT} where m.room_id = $1 and m.id <= $2::bigint order by m.id desc limit ${AROUND_SIDE + 2}`, [chat.room.id, around]);
    if (text(older.rows[0]?.id) !== around) throw new RoomError("message_not_found");
    const newer = await db.query(`${SELECT} where m.room_id = $1 and m.id > $2::bigint order by m.id limit ${AROUND_SIDE + 1}`, [chat.room.id, around]);
    return {
      messages: [
        ...older.rows
          .slice(0, AROUND_SIDE + 1)
          .reverse()
          .map((row) => readMessage(row, actor, chat)),
        ...newer.rows.slice(0, AROUND_SIDE).map((row) => readMessage(row, actor, chat)),
      ],
      hasMore: older.rows.length > AROUND_SIDE + 1,
      hasNewer: newer.rows.length > AROUND_SIDE,
    };
  }
  if (after !== undefined) {
    const rows = await db.query(`${SELECT} where m.room_id = $1 and m.id > $2::bigint order by m.id limit ${AFTER_PAGE_SIZE + 1}`, [chat.room.id, after]);
    const page = rows.rows.slice(0, AFTER_PAGE_SIZE).map((row) => readMessage(row, actor, chat));
    return { messages: page, hasMore: rows.rows.length > AFTER_PAGE_SIZE };
  }
  const rows =
    before === undefined
      ? await db.query(`${SELECT} where m.room_id = $1 order by m.id desc limit ${PAGE_SIZE + 1}`, [chat.room.id])
      : await db.query(`${SELECT} where m.room_id = $1 and m.id < $2::bigint order by m.id desc limit ${PAGE_SIZE + 1}`, [chat.room.id, before]);
  const page = rows.rows
    .slice(0, PAGE_SIZE)
    .map((row) => readMessage(row, actor, chat))
    .reverse();
  return { messages: page, hasMore: rows.rows.length > PAGE_SIZE };
}

async function readOne(db: MigrationClient, actor: PublicUser, chat: Chat, id: string): Promise<MessageView> {
  const found = await db.query(`${SELECT} where m.id = $1::bigint and m.room_id = $2`, [id, chat.room.id]);
  const row = found.rows[0];
  if (!row) throw new RoomError("message_not_found");
  return readMessage(row, actor, chat);
}

export async function sendMessage(
  db: MigrationClient,
  actor: PublicUser,
  id: string,
  input: { body: unknown; replyToId: string | undefined },
): Promise<MessageView> {
  const body = parseBody(input.body);
  const replyTo = input.replyToId === undefined ? undefined : messageId(input.replyToId);
  const chat = await textRoom(db, actor, id);
  if (chat.room.ended) throw new RoomError("room_ended");
  if (replyTo !== undefined) {
    const target = await db.query("select 1 from messages where id = $1::bigint and room_id = $2", [replyTo, chat.room.id]);
    if (!target.rows[0]) throw new RoomError("message_not_found");
  }
  const inserted = await db.query("insert into messages (room_id, author_id, body, reply_to_id) values ($1, $2, $3, $4::bigint) returning id::text as id", [
    chat.room.id,
    actor.id,
    body,
    replyTo ?? null,
  ]);
  const created = text(inserted.rows[0]?.id);
  if (!created) throw new RoomError("conflict");
  return readOne(db, actor, chat, created);
}

// The room a message lives in decides who sees it; a message elsewhere is simply not found.
async function messageChat(db: MigrationClient, actor: PublicUser, id: string): Promise<{ chat: Chat; authorId: string; deleted: boolean }> {
  const found = await db.query("select room_id, author_id, deleted_at is not null as deleted from messages where id = $1::bigint", [messageId(id)]);
  const row = found.rows[0];
  const room = text(row?.room_id);
  if (!row || !room) throw new RoomError("message_not_found");
  let chat: Chat;
  try {
    chat = await textRoom(db, actor, room);
  } catch (error) {
    if (error instanceof RoomError) throw new RoomError("message_not_found");
    throw error;
  }
  return { chat, authorId: text(row.author_id) ?? "", deleted: row.deleted === true };
}

export async function editMessage(db: MigrationClient, actor: PublicUser, id: string, input: { body: unknown }): Promise<MessageView> {
  const body = parseBody(input.body);
  const { chat, authorId, deleted } = await messageChat(db, actor, id);
  if (deleted) throw new RoomError("message_not_found");
  if (authorId !== actor.id) throw new RoomError("forbidden");
  if (chat.room.ended) throw new RoomError("room_ended");
  await db.query("update messages set body = $2, edited_at = now() where id = $1::bigint and deleted_at is null", [id, body]);
  return readOne(db, actor, chat, id);
}

/** The text is gone for good: body cleared, attachments, reactions and mentions dropped, pin lifted. */
export async function deleteMessage(db: MigrationClient, actor: PublicUser, id: string): Promise<MessageView> {
  const { chat, authorId, deleted } = await messageChat(db, actor, id);
  if (deleted) throw new RoomError("message_not_found");
  if (authorId !== actor.id && !chat.moderator) throw new RoomError("forbidden");
  await db.transaction(async (tx) => {
    await tx.query("delete from message_attachments where message_id = $1::bigint", [id]);
    await tx.query("delete from message_reactions where message_id = $1::bigint", [id]);
    await tx.query("delete from message_mentions where message_id = $1::bigint", [id]);
    await tx.query(
      "update messages set body = '', mentions_everyone = false, pinned_at = null, pinned_by = null, deleted_at = now() where id = $1::bigint and deleted_at is null",
      [id],
    );
  });
  return readOne(db, actor, chat, id);
}

export async function pinMessage(db: MigrationClient, actor: PublicUser, id: string, pinned: boolean): Promise<MessageView> {
  const { chat, deleted } = await messageChat(db, actor, id);
  if (deleted) throw new RoomError("message_not_found");
  if (!chat.moderator) throw new RoomError("forbidden");
  if (pinned) {
    await db.query("update messages set pinned_at = coalesce(pinned_at, now()), pinned_by = coalesce(pinned_by, $2) where id = $1::bigint", [id, actor.id]);
  } else {
    await db.query("update messages set pinned_at = null, pinned_by = null where id = $1::bigint", [id]);
  }
  return readOne(db, actor, chat, id);
}

/** One reaction per person and emoji; `on` adds it, otherwise it is taken back. Custom emojis come with F13-10. */
export async function reactMessage(db: MigrationClient, actor: PublicUser, id: string, input: { emoji: unknown; on: boolean }): Promise<MessageView> {
  const emoji = parseEmoji(input.emoji);
  const { chat, deleted } = await messageChat(db, actor, id);
  if (deleted) throw new RoomError("message_not_found");
  if (chat.room.ended) throw new RoomError("room_ended");
  if (input.on) {
    await db.transaction(async (tx) => {
      // The lock keeps two people from both adding the 21st emoji.
      await tx.query("select 1 from messages where id = $1::bigint for update", [id]);
      const distinct = await tx.query(
        "select count(distinct emoji)::int as total, bool_or(emoji = $2) as present from message_reactions where message_id = $1::bigint",
        [id, emoji],
      );
      if (distinct.rows[0]?.present !== true && Number(distinct.rows[0]?.total ?? 0) >= REACTIONS_PER_MESSAGE) throw new RoomError("conflict");
      await tx.query("insert into message_reactions (message_id, user_id, emoji) values ($1::bigint, $2, $3) on conflict do nothing", [id, actor.id, emoji]);
    });
  } else {
    await db.query("delete from message_reactions where message_id = $1::bigint and user_id = $2 and emoji = $3", [id, actor.id, emoji]);
  }
  return readOne(db, actor, chat, id);
}

/** A Unicode emoji as typed: up to 16 UTF-16 units, no letters, digits, spaces, controls or markup. */
export function parseEmoji(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 16 ||
    hidden(value) ||
    /[\s<>:A-Za-z0-9]/.test(value) ||
    !/\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(value)
  ) {
    throw new RoomError("invalid_body");
  }
  return value;
}

export async function listPinned(db: MigrationClient, actor: PublicUser, id: string): Promise<MessageView[]> {
  const chat = await textRoom(db, actor, id);
  const rows = await db.query(`${SELECT} where m.room_id = $1 and m.pinned_at is not null order by m.pinned_at desc, m.id desc limit ${PAGE_SIZE}`, [
    chat.room.id,
  ]);
  return rows.rows.map((row) => readMessage(row, actor, chat));
}

/** Word search with the `simple` dictionary, newest first; `before` pages further back. */
export async function searchMessages(
  db: MigrationClient,
  actor: PublicUser,
  id: string,
  input: { query: unknown; before: string | undefined },
): Promise<MessagePage> {
  const query = typeof input.query === "string" ? input.query.trim() : "";
  if (query.length === 0 || [...query].length > SEARCH_MAX_CHARS || hidden(query)) throw new RoomError("invalid_body");
  const before = cursor(input.before);
  const chat = await textRoom(db, actor, id);
  const rows = await db.query(
    `${SELECT}
     where m.room_id = $1 and m.deleted_at is null and ($3::bigint is null or m.id < $3::bigint)
       and to_tsvector('simple', m.body) @@ plainto_tsquery('simple', $2)
     order by m.id desc limit ${SEARCH_PAGE_SIZE + 1}`,
    [chat.room.id, query, before ?? null],
  );
  return {
    messages: rows.rows.slice(0, SEARCH_PAGE_SIZE).map((row) => readMessage(row, actor, chat)),
    hasMore: rows.rows.length > SEARCH_PAGE_SIZE,
  };
}
