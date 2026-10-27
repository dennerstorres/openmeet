import { mentionsUser, type ChatKind, type ChatMessage, type ChatRef } from "./chat.js";

// ADR 0024 (F13-13): unread and mention counts, notification levels and the badge. Pure functions, so the
// desktop, the web page and the tests agree on when a message notifies.

export type NotifyLevel = "all" | "mentions" | "none";
export const NOTIFY_LEVELS: readonly NotifyLevel[] = ["all", "mentions", "none"];

export interface UnreadChat {
  kind: ChatKind;
  id: string;
  /** The server of a text room; null in a DM. */
  serverId: string | null;
  lastReadId: string | null;
  unread: number;
  mentions: number;
  /** What the chat set for itself; null follows the server (rooms) or the default. */
  level: NotifyLevel | null;
}

export interface UnreadState {
  chats: UnreadChat[];
  /** Server levels that were set; a server missing here is "mentions". */
  servers: Readonly<Record<string, NotifyLevel>>;
}

export const EMPTY_UNREAD: UnreadState = { chats: [], servers: {} };

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function parseLevel(value: unknown): NotifyLevel | null | undefined {
  if (value === null) return null;
  return typeof value === "string" && (NOTIFY_LEVELS as readonly string[]).includes(value) ? (value as NotifyLevel) : undefined;
}

function counter(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

export function parseUnreadChat(value: unknown): UnreadChat | undefined {
  const item = record(value);
  if (!item || (item.kind !== "room" && item.kind !== "dm") || typeof item.id !== "string") return undefined;
  const serverId = item.serverId === null || typeof item.serverId === "string" ? item.serverId : undefined;
  const lastReadId = item.lastReadId === null || typeof item.lastReadId === "string" ? item.lastReadId : undefined;
  const unread = counter(item.unread);
  const mentions = counter(item.mentions);
  const level = parseLevel(item.level);
  if (serverId === undefined || lastReadId === undefined || unread === undefined || mentions === undefined || level === undefined) return undefined;
  return { kind: item.kind, id: item.id, serverId, lastReadId, unread, mentions, level };
}

export function parseUnreadState(value: unknown): UnreadState | undefined {
  const body = record(value);
  if (!body || !Array.isArray(body.chats) || !Array.isArray(body.servers)) return undefined;
  const chats: UnreadChat[] = [];
  for (const raw of body.chats) {
    const chat = parseUnreadChat(raw);
    if (!chat) return undefined;
    chats.push(chat);
  }
  const servers: Record<string, NotifyLevel> = {};
  for (const raw of body.servers) {
    const item = record(raw);
    const level = parseLevel(item?.level);
    if (typeof item?.serverId !== "string" || !level) return undefined;
    servers[item.serverId] = level;
  }
  return { chats, servers };
}

export function findUnread(state: UnreadState, chat: ChatRef): UnreadChat | undefined {
  return state.chats.find((item) => item.kind === chat.kind && item.id === chat.id);
}

/** The level in force: the chat's own, else its server's, else "mentions" for a room and "all" for a DM. */
export function effectiveLevel(state: UnreadState, chat: UnreadChat): NotifyLevel {
  if (chat.level !== null) return chat.level;
  if (chat.kind === "dm") return "all";
  return (chat.serverId !== null ? state.servers[chat.serverId] : undefined) ?? "mentions";
}

function messageChat(message: ChatMessage): ChatRef | undefined {
  if (message.dmId) return { kind: "dm", id: message.dmId };
  if (message.roomId) return { kind: "room", id: message.roomId };
  return undefined;
}

function same(a: ChatRef | null, b: ChatRef): boolean {
  return a !== null && a.kind === b.kind && a.id === b.id;
}

/**
 * Counts a new message. `viewing` is the chat on screen while the window has focus: that one is read at once
 * by the caller, so it does not count. Own messages never count.
 */
export function countMessage(state: UnreadState, message: ChatMessage, selfId: string | null, viewing: ChatRef | null): UnreadState {
  const where = messageChat(message);
  if (!where || message.deleted || selfId === null || message.authorId === selfId || same(viewing, where)) return state;
  const found = findUnread(state, where);
  const mention = mentionsUser(message, selfId);
  const next: UnreadChat = found
    ? { ...found, unread: found.unread + 1, mentions: found.mentions + (mention ? 1 : 0) }
    : { kind: where.kind, id: where.id, serverId: null, lastReadId: null, unread: 1, mentions: mention ? 1 : 0, level: null };
  return { ...state, chats: found ? state.chats.map((item) => (item === found ? next : item)) : [...state.chats, next] };
}

/** True when this message should raise a system notification: never for the chat in view, never at "none". */
export function shouldNotify(state: UnreadState, message: ChatMessage, selfId: string | null, viewing: ChatRef | null): boolean {
  const where = messageChat(message);
  if (!where || message.deleted || selfId === null || message.authorId === selfId || same(viewing, where)) return false;
  const chat = findUnread(state, where) ?? { kind: where.kind, id: where.id, serverId: null, lastReadId: null, unread: 0, mentions: 0, level: null };
  const level = effectiveLevel(state, chat);
  if (level === "none") return false;
  if (level === "all") return true;
  return mentionsUser(message, selfId);
}

/** A read from this or another client of the same account replaces the chat's counts. */
export function applyRead(state: UnreadState, read: UnreadChat): UnreadState {
  const found = findUnread(state, read);
  const next = found ? { ...read, serverId: read.serverId ?? found.serverId } : read;
  return { ...state, chats: found ? state.chats.map((item) => (item === found ? next : item)) : [...state.chats, next] };
}

/** Clears a chat at once, before the server answers, so the open chat never shows a stale count. */
export function clearChat(state: UnreadState, chat: ChatRef): UnreadState {
  const found = findUnread(state, chat);
  if (!found || (found.unread === 0 && found.mentions === 0)) return state;
  return { ...state, chats: state.chats.map((item) => (item === found ? { ...item, unread: 0, mentions: 0 } : item)) };
}

/** What a chat shows in a list: the mention count, and whether anything is unread. Silenced chats show nothing. */
export function chatBadge(state: UnreadState, chat: ChatRef): { mentions: number; unread: boolean } {
  const found = findUnread(state, chat);
  if (!found || effectiveLevel(state, found) === "none") return { mentions: 0, unread: false };
  return { mentions: found.mentions, unread: found.unread > 0 };
}

/** The same for a server icon: its rooms added up. */
export function serverBadge(state: UnreadState, serverId: string): { mentions: number; unread: boolean } {
  let mentions = 0;
  let unread = false;
  for (const chat of state.chats) {
    if (chat.kind !== "room" || chat.serverId !== serverId || effectiveLevel(state, chat) === "none") continue;
    mentions += chat.mentions;
    unread ||= chat.unread > 0;
  }
  return { mentions, unread };
}

/** The number on the tray icon and in the tab title: mentions in rooms plus unread DM messages. */
export function badgeCount(state: UnreadState): number {
  let total = 0;
  for (const chat of state.chats) if (effectiveLevel(state, chat) !== "none") total += chat.kind === "dm" ? chat.unread : chat.mentions;
  return total;
}

/** `(3) OpenMeet`, or the bare title at zero. */
export function titleWithCount(title: string, count: number): string {
  return count > 0 ? `(${count > 99 ? "99+" : count}) ${title}` : title;
}
