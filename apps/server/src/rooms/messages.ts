import type { MigrationClient } from "../db/migrate.js";
import type { PublicUser } from "../auth/service.js";
import { ATTACHMENTS_SELECT, claimAttachments, readAttachments, type AttachmentView } from "./attachments.js";
import { RoomError, canManage, loadRoomAccess, requireMember, roomId, text, type RoomRecord } from "./service.js";
import { loadDm } from "./dms.js";
import { requireUsableEmoji } from "./emojis.js";

// ADR 0024: messages of text rooms. A removed message keeps its row with an empty body, so replies and
// cursors stay whole. DMs (F13-11) reuse the same table and functions with dm_id.

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
/** A person is mentioned as `<@user id>`; the client shows the name. */
const MENTION = /<@([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})>/gi;
const EVERYONE = /(^|[^\w@])@(everyone|here)(?![\w])/;
// Code is shown as typed, so nothing inside it mentions anyone.
const CODE = /```[\s\S]*?```|`[^`\n]*`/g;
/** Past this many people in one message the rest stay as text. */
export const MENTIONS_PER_MESSAGE = 20;
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
  /** Exactly one of roomId and dmId is set. */
  roomId: string | null;
  dmId: string | null;
  authorId: string;
  body: string;
  replyTo: { id: string; authorId: string; body: string; deleted: boolean } | null;
  pinned: boolean;
  edited: boolean;
  deleted: boolean;
  createdAt: string;
  /** Who reacted is public in the room, so the same list serves every viewer and the live events. */
  reactions: { emoji: string; userIds: string[] }[];
  /** Members the message resolved to; a `<@id>` of anyone else stays plain text. */
  mentions: string[];
  /** `@everyone` or `@here` from an owner or moderator; from anyone else it is only text. */
  mentionsEveryone: boolean;
  /** ADR 0024: files sent with the message, in upload order; gone with the message. */
  attachments: AttachmentView[];
  /** Server emojis the body or the reactions name; the body already reads `:name:` for any not usable here. */
  emojis: EmojiRef[];
  canEdit: boolean;
  canDelete: boolean;
}

export interface EmojiRef {
  id: string;
  name: string;
  animated: boolean;
  removed: boolean;
}

export interface MessagePage {
  messages: MessageView[];
  hasMore: boolean;
  /** Only with `around`: newer messages exist past this page. */
  hasNewer?: boolean;
}

export type ChatKind = "room" | "dm";

// Where the messages hang from: a text room of a server, or a DM. The column is one of two fixed names, so it
// is safe to place in the SQL text.
interface Chat {
  column: "room_id" | "dm_id";
  target: string;
  /** Null in a DM. */
  room: RoomRecord | null;
  /** Removes anyone's message. Nobody does in a DM: there only the author removes. */
  moderator: boolean;
  /** Room moderators pin; in a DM every member does. */
  canPin: boolean;
  /** Why nothing new may be written: an ended room, or a direct DM with a block. */
  closed: "room_ended" | "blocked" | undefined;
}

export function messageId(value: string): string {
  if (!MESSAGE_ID.test(value)) throw new RoomError("message_not_found");
  return value;
}

/** Newlines are kept and CRLF becomes LF; anything hidden is refused, never cleaned in silence. Blank only with files. */
export function parseBody(value: unknown, blankAllowed = false): string {
  if (blankAllowed && (value === undefined || value === "")) return "";
  if (typeof value !== "string") throw new RoomError("invalid_message");
  const body = value.replace(/\r\n?/g, "\n");
  if ((body.trim().length === 0 && !blankAllowed) || [...body].length > MESSAGE_MAX_CHARS || hidden(body)) throw new RoomError("invalid_message");
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
  const moderator = canManage(access.membership);
  return { column: "room_id", target: room.id, room, moderator, canPin: moderator, closed: room.ended ? "room_ended" : undefined };
}

async function dmChat(db: MigrationClient, actor: PublicUser, id: string): Promise<Chat> {
  const dm = await loadDm(db, actor, id);
  return { column: "dm_id", target: dm.id, room: null, moderator: false, canPin: true, closed: dm.readOnly ? "blocked" : undefined };
}

function loadChat(db: MigrationClient, actor: PublicUser, id: string, kind: ChatKind): Promise<Chat> {
  return kind === "dm" ? dmChat(db, actor, id) : textRoom(db, actor, id);
}

function requireOpen(chat: Chat): void {
  if (chat.closed !== undefined) throw new RoomError(chat.closed);
}

/** Typing is only signalled into a text room or DM the caller may write in. */
export async function typingRoom(db: MigrationClient, actor: PublicUser, id: string, kind: ChatKind = "room"): Promise<string> {
  const chat = await loadChat(db, actor, id, kind);
  requireOpen(chat);
  return chat.target;
}

/** What every member receives: the flags that depend on the viewer are left to each client. */
export function publicMessage(view: MessageView): Omit<MessageView, "canEdit" | "canDelete"> {
  return {
    reactions: view.reactions,
    mentions: view.mentions,
    mentionsEveryone: view.mentionsEveryone,
    attachments: view.attachments,
    emojis: view.emojis,
    id: view.id,
    roomId: view.roomId,
    dmId: view.dmId,
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
  select m.id::text as id, m.room_id, m.dm_id, m.author_id, m.body, m.pinned_at is not null as pinned, m.edited_at is not null as edited,
         m.deleted_at is not null as deleted, m.created_at, m.mentions_everyone,
         array(select x.user_id::text from message_mentions x where x.message_id = m.id order by x.user_id) as mentions,
         r.id::text as reply_id, r.author_id as reply_author, left(r.body, ${REPLY_PREVIEW_CHARS}) as reply_body, r.deleted_at is not null as reply_deleted,
         coalesce((
           select json_agg(json_build_object('emoji', x.emoji, 'userIds', x.users) order by x.first, x.emoji)
           from (
             select emoji, array_agg(user_id::text order by created_at, user_id) as users, min(created_at) as first
             from message_reactions where message_id = m.id group by emoji
           ) x
         ), '[]'::json) as reactions,
         ${ATTACHMENTS_SELECT} as attachments
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
    roomId: text(row.room_id) ?? null,
    dmId: text(row.dm_id) ?? null,
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
    mentions: deleted || !Array.isArray(row.mentions) ? [] : row.mentions.filter((user): user is string => typeof user === "string"),
    mentionsEveryone: !deleted && row.mentions_everyone === true,
    attachments: deleted ? [] : readAttachments(row.attachments),
    emojis: [],
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

const EMOJI_TOKEN = /<:([A-Za-z0-9_]{2,32}):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})>/gi;
const CUSTOM_REACTION = /^custom:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/**
 * ADR 0024: a `<:name:id>` shows the picture only with an emoji still in place and usable where the message is: of
 * the room's server, or in a DM of a server its author belongs to. Anything else reads `:name:`, so another server's
 * emoji never resolves in a room and a removed one turns back to text. A rename shows the current name.
 */
async function resolveEmojis(db: MigrationClient, chat: Chat, views: MessageView[]): Promise<MessageView[]> {
  const ids = new Set<string>();
  for (const view of views) {
    for (const match of `${view.body} ${view.replyTo?.body ?? ""}`.matchAll(EMOJI_TOKEN)) ids.add((match[2] ?? "").toLowerCase());
    for (const reaction of view.reactions) {
      const custom = CUSTOM_REACTION.exec(reaction.emoji)?.[1];
      if (custom) ids.add(custom.toLowerCase());
    }
  }
  if (ids.size === 0) return views;
  const found = await db.query(
    "select id::text as id, server_id::text as server_id, name, animated, deleted_at is not null as removed from server_emojis where id = any($1::uuid[])",
    [[...ids]],
  );
  const emojis = new Map(
    found.rows.map((row) => [
      text(row.id) ?? "",
      { serverId: text(row.server_id) ?? "", name: text(row.name) ?? "", animated: row.animated === true, removed: row.removed === true },
    ]),
  );
  // In a DM the author must belong to the emoji's server.
  const members = new Set<string>();
  if (chat.room === null && emojis.size > 0) {
    const authors = [...new Set(views.flatMap((view) => [view.authorId, view.replyTo?.authorId ?? ""]).filter((id) => id !== ""))];
    const servers = [...new Set([...emojis.values()].map((emoji) => emoji.serverId))];
    const held = await db.query(
      "select server_id::text as server_id, user_id::text as user_id from server_members where removed_at is null and server_id = any($1::uuid[]) and user_id = any($2::uuid[])",
      [servers, authors],
    );
    for (const row of held.rows) members.add(`${text(row.server_id) ?? ""}:${text(row.user_id) ?? ""}`);
  }
  const usable = (id: string, authorId: string | null): boolean => {
    const emoji = emojis.get(id);
    if (!emoji || emoji.removed) return false;
    if (chat.room !== null) return emoji.serverId === chat.room.serverId;
    return authorId === null || members.has(`${emoji.serverId}:${authorId}`);
  };
  const rewrite = (body: string, authorId: string): string =>
    body.replace(EMOJI_TOKEN, (_, name: string, raw: string) => {
      const id = raw.toLowerCase();
      const current = emojis.get(id)?.name ?? name;
      return usable(id, authorId) ? `<:${current}:${id}>` : `:${current}:`;
    });
  return views.map((view) => {
    const refs = new Map<string, EmojiRef>();
    const note = (id: string, removed: boolean): void => {
      const emoji = emojis.get(id);
      if (!emoji) return;
      const held = refs.get(id);
      refs.set(id, { id, name: emoji.name, animated: emoji.animated, removed: removed && (held?.removed ?? true) });
    };
    for (const match of view.body.matchAll(EMOJI_TOKEN)) {
      const id = (match[2] ?? "").toLowerCase();
      if (usable(id, view.authorId)) note(id, false);
    }
    // Who may react with it was checked when the reaction went in; here only removal and the room's server count.
    for (const reaction of view.reactions) {
      const custom = CUSTOM_REACTION.exec(reaction.emoji)?.[1]?.toLowerCase();
      if (custom) note(custom, !usable(custom, null));
    }
    return {
      ...view,
      body: rewrite(view.body, view.authorId),
      replyTo: view.replyTo ? { ...view.replyTo, body: rewrite(view.replyTo.body, view.replyTo.authorId) } : null,
      emojis: [...refs.values()],
    };
  });
}

function readMessages(db: MigrationClient, rows: Record<string, unknown>[], actor: PublicUser, chat: Chat): Promise<MessageView[]> {
  return resolveEmojis(
    db,
    chat,
    rows.map((row) => readMessage(row, actor, chat)),
  );
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
  kind: ChatKind = "room",
): Promise<MessagePage> {
  const before = cursor(query.before);
  const after = cursor(query.after);
  const around = cursor(query.around);
  if ([before, after, around].filter((value) => value !== undefined).length > 1) throw new RoomError("invalid_body");
  const chat = await loadChat(db, actor, id, kind);
  const where = `m.${chat.column} = $1`;
  if (around !== undefined) {
    const older = await db.query(`${SELECT} where ${where} and m.id <= $2::bigint order by m.id desc limit ${AROUND_SIDE + 2}`, [chat.target, around]);
    if (text(older.rows[0]?.id) !== around) throw new RoomError("message_not_found");
    const newer = await db.query(`${SELECT} where ${where} and m.id > $2::bigint order by m.id limit ${AROUND_SIDE + 1}`, [chat.target, around]);
    return {
      messages: await readMessages(db, [...older.rows.slice(0, AROUND_SIDE + 1).reverse(), ...newer.rows.slice(0, AROUND_SIDE)], actor, chat),
      hasMore: older.rows.length > AROUND_SIDE + 1,
      hasNewer: newer.rows.length > AROUND_SIDE,
    };
  }
  if (after !== undefined) {
    const rows = await db.query(`${SELECT} where ${where} and m.id > $2::bigint order by m.id limit ${AFTER_PAGE_SIZE + 1}`, [chat.target, after]);
    const page = await readMessages(db, rows.rows.slice(0, AFTER_PAGE_SIZE), actor, chat);
    return { messages: page, hasMore: rows.rows.length > AFTER_PAGE_SIZE };
  }
  const rows =
    before === undefined
      ? await db.query(`${SELECT} where ${where} order by m.id desc limit ${PAGE_SIZE + 1}`, [chat.target])
      : await db.query(`${SELECT} where ${where} and m.id < $2::bigint order by m.id desc limit ${PAGE_SIZE + 1}`, [chat.target, before]);
  const page = await readMessages(db, rows.rows.slice(0, PAGE_SIZE).reverse(), actor, chat);
  return { messages: page, hasMore: rows.rows.length > PAGE_SIZE };
}

async function readOne(db: MigrationClient, actor: PublicUser, chat: Chat, id: string): Promise<MessageView> {
  const found = await db.query(`${SELECT} where m.id = $1::bigint and m.${chat.column} = $2`, [id, chat.target]);
  const row = found.rows[0];
  if (!row) throw new RoomError("message_not_found");
  const [view] = await readMessages(db, [row], actor, chat);
  if (!view) throw new RoomError("message_not_found");
  return view;
}

interface Mentions {
  users: string[];
  everyone: boolean;
}

/** Who the text names among the room's members, and whether it may call everyone. */
export async function resolveMentions(db: MigrationClient, chat: Chat, body: string): Promise<Mentions> {
  const prose = body.replace(CODE, " ");
  const named = [...new Set([...prose.matchAll(MENTION)].map((match) => (match[1] ?? "").toLowerCase()))].slice(0, MENTIONS_PER_MESSAGE);
  // A DM has no @everyone: its members are already the whole audience.
  const everyone = chat.room !== null && chat.moderator && EVERYONE.test(prose);
  if (named.length === 0) return { users: [], everyone };
  const found =
    chat.room === null
      ? await db.query(
          `select d.user_id::text as id
           from dm_members d join users u on u.id = d.user_id
           where d.dm_id = $1 and d.left_at is null and u.disabled_at is null and d.user_id = any($2::uuid[])`,
          [chat.target, named],
        )
      : await db.query(
          `select m.user_id::text as id
           from server_members m join users u on u.id = m.user_id
           where m.server_id = $1 and m.removed_at is null and u.disabled_at is null and m.user_id = any($2::uuid[])`,
          [chat.room.serverId, named],
        );
  return { users: found.rows.map((row) => text(row.id) ?? "").filter((user) => user !== ""), everyone };
}

async function saveMentions(db: MigrationClient, id: string, mentions: Mentions): Promise<void> {
  await db.query("delete from message_mentions where message_id = $1::bigint", [id]);
  if (mentions.users.length > 0) {
    await db.query("insert into message_mentions (message_id, user_id) select $1::bigint, unnest($2::uuid[]) on conflict do nothing", [id, mentions.users]);
  }
}

export async function sendMessage(
  db: MigrationClient,
  actor: PublicUser,
  id: string,
  input: { body: unknown; replyToId: string | undefined; attachmentIds?: readonly string[] },
  kind: ChatKind = "room",
): Promise<MessageView> {
  const attachmentIds = input.attachmentIds ?? [];
  const body = parseBody(input.body, attachmentIds.length > 0);
  const replyTo = input.replyToId === undefined ? undefined : messageId(input.replyToId);
  const chat = await loadChat(db, actor, id, kind);
  requireOpen(chat);
  if (replyTo !== undefined) {
    const target = await db.query(`select 1 from messages where id = $1::bigint and ${chat.column} = $2`, [replyTo, chat.target]);
    if (!target.rows[0]) throw new RoomError("message_not_found");
  }
  const mentions = await resolveMentions(db, chat, body);
  // The message and its files land together: a file someone else owns or already sent rolls it all back.
  const created = await db.transaction(async (tx) => {
    const inserted = await tx.query(
      `insert into messages (${chat.column}, author_id, body, reply_to_id, mentions_everyone) values ($1, $2, $3, $4::bigint, $5) returning id::text as id`,
      [chat.target, actor.id, body, replyTo ?? null, mentions.everyone],
    );
    const id = text(inserted.rows[0]?.id);
    if (!id) throw new RoomError("conflict");
    await saveMentions(tx, id, mentions);
    await claimAttachments(tx, actor, id, attachmentIds);
    return id;
  });
  return readOne(db, actor, chat, created);
}

// The room or DM a message lives in decides who sees it; a message elsewhere is simply not found.
async function messageChat(db: MigrationClient, actor: PublicUser, id: string): Promise<{ chat: Chat; authorId: string; deleted: boolean }> {
  const found = await db.query("select room_id, dm_id, author_id, deleted_at is not null as deleted from messages where id = $1::bigint", [messageId(id)]);
  const row = found.rows[0];
  const room = text(row?.room_id);
  const dm = text(row?.dm_id);
  if (!row || (!room && !dm)) throw new RoomError("message_not_found");
  let chat: Chat;
  try {
    chat = room ? await textRoom(db, actor, room) : await dmChat(db, actor, dm ?? "");
  } catch (error) {
    if (error instanceof RoomError) throw new RoomError("message_not_found");
    throw error;
  }
  return { chat, authorId: text(row.author_id) ?? "", deleted: row.deleted === true };
}

/** ADR 0024: whoever may read the message may read its files; anything else is not found. */
export async function requireReadableMessage(db: MigrationClient, actor: PublicUser, id: string): Promise<void> {
  const { deleted } = await messageChat(db, actor, id);
  if (deleted) throw new RoomError("message_not_found");
}

export async function editMessage(db: MigrationClient, actor: PublicUser, id: string, input: { body: unknown }): Promise<MessageView> {
  const body = parseBody(input.body);
  const { chat, authorId, deleted } = await messageChat(db, actor, id);
  if (deleted) throw new RoomError("message_not_found");
  if (authorId !== actor.id) throw new RoomError("forbidden");
  requireOpen(chat);
  const mentions = await resolveMentions(db, chat, body);
  await db.transaction(async (tx) => {
    await tx.query("update messages set body = $2, mentions_everyone = $3, edited_at = now() where id = $1::bigint and deleted_at is null", [
      id,
      body,
      mentions.everyone,
    ]);
    await saveMentions(tx, id, mentions);
  });
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
  if (!chat.canPin) throw new RoomError("forbidden");
  if (pinned) {
    await db.query("update messages set pinned_at = coalesce(pinned_at, now()), pinned_by = coalesce(pinned_by, $2) where id = $1::bigint", [id, actor.id]);
  } else {
    await db.query("update messages set pinned_at = null, pinned_by = null where id = $1::bigint", [id]);
  }
  return readOne(db, actor, chat, id);
}

/** One reaction per person and emoji; `on` adds it, otherwise it is taken back. A `custom:<id>` must be usable here. */
export async function reactMessage(db: MigrationClient, actor: PublicUser, id: string, input: { emoji: unknown; on: boolean }): Promise<MessageView> {
  const emoji = parseEmoji(input.emoji);
  const { chat, deleted } = await messageChat(db, actor, id);
  if (deleted) throw new RoomError("message_not_found");
  requireOpen(chat);
  const custom = CUSTOM_REACTION.exec(emoji)?.[1];
  if (input.on && custom) await requireUsableEmoji(db, actor, custom, chat.room?.serverId ?? null);
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

/** A Unicode emoji as typed (up to 16 UTF-16 units, no letters, digits, spaces, controls or markup) or `custom:<id>`. */
export function parseEmoji(value: unknown): string {
  if (typeof value === "string" && CUSTOM_REACTION.test(value)) return value.toLowerCase();
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

export async function listPinned(db: MigrationClient, actor: PublicUser, id: string, kind: ChatKind = "room"): Promise<MessageView[]> {
  const chat = await loadChat(db, actor, id, kind);
  const rows = await db.query(`${SELECT} where m.${chat.column} = $1 and m.pinned_at is not null order by m.pinned_at desc, m.id desc limit ${PAGE_SIZE}`, [
    chat.target,
  ]);
  return readMessages(db, rows.rows, actor, chat);
}

/** Word search with the `simple` dictionary, newest first; `before` pages further back. */
export async function searchMessages(
  db: MigrationClient,
  actor: PublicUser,
  id: string,
  input: { query: unknown; before: string | undefined },
  kind: ChatKind = "room",
): Promise<MessagePage> {
  const query = typeof input.query === "string" ? input.query.trim() : "";
  if (query.length === 0 || [...query].length > SEARCH_MAX_CHARS || hidden(query)) throw new RoomError("invalid_body");
  const before = cursor(input.before);
  const chat = await loadChat(db, actor, id, kind);
  const rows = await db.query(
    `${SELECT}
     where m.${chat.column} = $1 and m.deleted_at is null and ($3::bigint is null or m.id < $3::bigint)
       and to_tsvector('simple', m.body) @@ plainto_tsquery('simple', $2)
     order by m.id desc limit ${SEARCH_PAGE_SIZE + 1}`,
    [chat.target, query, before ?? null],
  );
  return {
    messages: await readMessages(db, rows.rows.slice(0, SEARCH_PAGE_SIZE), actor, chat),
    hasMore: rows.rows.length > SEARCH_PAGE_SIZE,
  };
}
