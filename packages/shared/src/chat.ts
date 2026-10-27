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
  reactions: ChatReaction[];
  /** Members the server resolved from `<@id>` in the body. */
  mentions: string[];
  /** `@everyone`/`@here` from an owner or moderator. */
  mentionsEveryone: boolean;
}

export interface ChatReaction {
  emoji: string;
  userIds: string[];
}

export interface ChatPage {
  messages: ChatMessage[];
  hasMore: boolean;
  /** Only after a jump: newer messages exist past this page. */
  hasNewer: boolean;
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

function parseReactions(value: unknown): ChatReaction[] | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 20) return undefined;
  const reactions: ChatReaction[] = [];
  for (const item of value) {
    const reaction = record(item);
    if (!reaction || typeof reaction.emoji !== "string" || reaction.emoji.length > 64 || !Array.isArray(reaction.userIds)) return undefined;
    const userIds = reaction.userIds.filter((id): id is string => typeof id === "string" && UUID.test(id));
    if (userIds.length !== reaction.userIds.length || userIds.length === 0) return undefined;
    reactions.push({ emoji: reaction.emoji, userIds });
  }
  return reactions;
}

function parseMentions(value: unknown): string[] | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 20) return undefined;
  const ids = value.filter((id): id is string => typeof id === "string" && UUID.test(id));
  return ids.length === value.length ? ids : undefined;
}

/** Undefined for anything that is not a message as the API writes it. */
export function parseChatMessage(value: unknown): ChatMessage | undefined {
  const item = record(value);
  if (!item) return undefined;
  const { id, roomId, authorId, body, pinned, edited, deleted, createdAt } = item;
  const replyTo = parseReply(item.replyTo ?? null);
  const reactions = parseReactions(item.reactions);
  const mentions = parseMentions(item.mentions);
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
    replyTo === undefined ||
    reactions === undefined ||
    mentions === undefined
  ) {
    return undefined;
  }
  return {
    id,
    roomId,
    authorId,
    body: deleted ? "" : body,
    replyTo,
    pinned,
    edited,
    deleted,
    createdAt,
    reactions: deleted ? [] : reactions,
    mentions: deleted ? [] : mentions,
    mentionsEveryone: !deleted && item.mentionsEveryone === true,
  };
}

export function parseChatPage(value: unknown): ChatPage | undefined {
  const page = record(value);
  if (!page || !Array.isArray(page.messages) || typeof page.hasMore !== "boolean") return undefined;
  const messages = page.messages.map(parseChatMessage);
  if (messages.some((message) => message === undefined)) return undefined;
  return { messages: messages as ChatMessage[], hasMore: page.hasMore, hasNewer: page.hasNewer === true };
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

// Mentions travel as `<@user id>`; the composer and every preview show `@name` instead.
const MENTION_TOKEN = /<@([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})>/gi;

export function mentionToken(userId: string): string {
  return `<@${userId}>`;
}

/** The message calls this person: by name, or by `@everyone`/`@here` from someone allowed to. */
export function mentionsUser(message: ChatMessage, userId: string | null): boolean {
  if (message.deleted || userId === null || message.authorId === userId) return false;
  return message.mentionsEveryone || message.mentions.includes(userId);
}

/** One line of text for previews: every `<@id>` as `@name`. */
export function plainBody(body: string, label: (userId: string) => string): string {
  return body.replace(MENTION_TOKEN, (_, id: string) => `@${label(id.toLowerCase())}`);
}

/** What the person edits: `@name` in place of each token, and which name stands for which id. */
export function mentionDisplay(body: string, label: (userId: string) => string): { text: string; picks: Record<string, string> } {
  const picks: Record<string, string> = {};
  const text = body.replace(MENTION_TOKEN, (_, raw: string) => {
    const id = raw.toLowerCase();
    const name = `@${label(id)}`;
    if (picks[name] === undefined) picks[name] = id;
    return picks[name] === id ? name : mentionToken(id);
  });
  return { text, picks };
}

/** Back to the wire: each picked `@name` that starts a word becomes its token, longest names first. */
export function mentionWire(text: string, picks: Record<string, string>): string {
  const names = Object.keys(picks).sort((a, b) => b.length - a.length);
  let out = "";
  let index = 0;
  while (index < text.length) {
    const edge = index === 0 || /\s|[([{"'*_~|>]/.test(text[index - 1] ?? "");
    const name = edge && text[index] === "@" ? names.find((candidate) => text.startsWith(candidate, index)) : undefined;
    const id = name === undefined ? undefined : picks[name];
    if (name !== undefined && id !== undefined && !/[\p{L}\p{N}_]/u.test(text[index + name.length] ?? "")) {
      out += mentionToken(id);
      index += name.length;
    } else {
      out += text[index];
      index += 1;
    }
  }
  return out;
}

/** The `@word` being typed right before the caret, if any. */
export function mentionQuery(text: string, caret: number): { start: number; query: string } | undefined {
  const match = /(^|\s)@([^\s@<>]{0,32})$/.exec(text.slice(0, caret));
  if (!match) return undefined;
  const query = match[2] ?? "";
  return { start: caret - query.length - 1, query };
}

export interface MentionCandidate {
  /** A member id, or `everyone`/`here`. */
  id: string;
  label: string;
  detail: string;
}

/** Members whose name or account name starts a word with the query; `@everyone`/`@here` only for managers. */
export function mentionCandidates(
  members: readonly { id: string; label: string; globalName: string }[],
  query: string,
  manager: boolean,
  limit = 8,
): MentionCandidate[] {
  const needle = query.toLocaleLowerCase("pt-BR");
  const starts = (value: string) =>
    value
      .toLocaleLowerCase("pt-BR")
      .split(/\s+/)
      .some((word) => word.startsWith(needle)) || value.toLocaleLowerCase("pt-BR").startsWith(needle);
  const people = members
    .filter((member) => starts(member.label) || starts(member.globalName))
    .map((member) => ({ id: member.id, label: member.label, detail: member.globalName === member.label ? "" : member.globalName }));
  const loud = manager
    ? [
        { id: "everyone", label: "everyone", detail: "todos do servidor" },
        { id: "here", label: "here", detail: "quem está online" },
      ].filter((item) => item.label.startsWith(needle))
    : [];
  return [...people, ...loud].slice(0, limit);
}
