// ADR 0024: text room messages as the client keeps them. Ids are decimal strings of a bigint: they order the
// list and are the cursor. The API sends canEdit/canDelete only on direct answers; events leave them to the
// client, so both are computed here from the author and the caller's role.

export const MESSAGE_MAX_CHARS = 4000;

export interface ChatMessage {
  id: string;
  roomId: string;
  authorId: string;
  body: string;
  replyTo: { id: string; authorId: string; body: string; deleted: boolean } | null;
  pinned: boolean;
  edited: boolean;
  deleted: boolean;
  createdAt: string;
}

export interface ChatPage {
  messages: ChatMessage[];
  hasMore: boolean;
}

const MESSAGE_ID = /^[1-9][0-9]{0,17}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function parseReply(value: unknown): ChatMessage["replyTo"] | undefined {
  if (value === null) return null;
  const reply = record(value);
  if (!reply) return undefined;
  const { id, authorId, body, deleted } = reply;
  if (typeof id !== "string" || !MESSAGE_ID.test(id) || typeof authorId !== "string" || typeof body !== "string" || typeof deleted !== "boolean")
    return undefined;
  return { id, authorId, body, deleted };
}

/** Undefined for anything that is not a message as the API writes it. */
export function parseChatMessage(value: unknown): ChatMessage | undefined {
  const item = record(value);
  if (!item) return undefined;
  const { id, roomId, authorId, body, pinned, edited, deleted, createdAt } = item;
  const replyTo = parseReply(item.replyTo ?? null);
  if (
    typeof id !== "string" ||
    !MESSAGE_ID.test(id) ||
    typeof roomId !== "string" ||
    !UUID.test(roomId) ||
    typeof authorId !== "string" ||
    !UUID.test(authorId) ||
    typeof body !== "string" ||
    body.length > MESSAGE_MAX_CHARS * 2 ||
    typeof pinned !== "boolean" ||
    typeof edited !== "boolean" ||
    typeof deleted !== "boolean" ||
    typeof createdAt !== "string" ||
    Number.isNaN(Date.parse(createdAt)) ||
    replyTo === undefined
  ) {
    return undefined;
  }
  return { id, roomId, authorId, body: deleted ? "" : body, replyTo, pinned, edited, deleted, createdAt };
}

export function parseChatPage(value: unknown): ChatPage | undefined {
  const page = record(value);
  if (!page || !Array.isArray(page.messages) || typeof page.hasMore !== "boolean") return undefined;
  const messages = page.messages.map(parseChatMessage);
  if (messages.some((message) => message === undefined)) return undefined;
  return { messages: messages as ChatMessage[], hasMore: page.hasMore };
}

export function compareMessageIds(a: string, b: string): number {
  const left = BigInt(a);
  const right = BigInt(b);
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Oldest first, one entry per id; an incoming copy replaces the one already held. */
export function mergeMessages(held: readonly ChatMessage[], incoming: readonly ChatMessage[]): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();
  for (const message of held) byId.set(message.id, message);
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) => compareMessageIds(a.id, b.id));
}

export function canEditMessage(message: ChatMessage, userId: string | null): boolean {
  return !message.deleted && userId !== null && message.authorId === userId;
}

export function canDeleteMessage(message: ChatMessage, userId: string | null, manager: boolean): boolean {
  return !message.deleted && (manager || (userId !== null && message.authorId === userId));
}

/** What the composer may send: CRLF as LF, not blank, within the API's limit counted in code points. */
export function sendableBody(value: string): string | undefined {
  const body = value.replace(/\r\n?/g, "\n");
  if (body.trim().length === 0 || [...body].length > MESSAGE_MAX_CHARS) return undefined;
  return body;
}
