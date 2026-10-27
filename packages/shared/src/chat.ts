// ADR 0024: text room messages as the client keeps them. Ids are decimal strings of a bigint: they order the
// list and are the cursor. The API sends canEdit/canDelete only on direct answers; events leave them to the
// client, so both are computed here from the author and the caller's role.

export const MESSAGE_MAX_CHARS = 4000;
export const ATTACHMENTS_PER_MESSAGE = 10;
/** The API's default for ATTACHMENT_MAX_BYTES; the composer warns early, the API has the last word. */
export const ATTACHMENT_DEFAULT_MAX_BYTES = 10 * 1024 * 1024;

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
  attachments: ChatAttachment[];
  /** Server emojis the body or the reactions name, as the API resolved them for this chat. */
  emojis: ChatEmojiRef[];
}

/** `removed` once the emoji is gone: the body already reads `:name:`, a reaction shows the name. */
export interface ChatEmojiRef {
  id: string;
  name: string;
  animated: boolean;
  removed: boolean;
}

/** One emoji of a server's set, as the picker lists it. */
export interface ServerEmoji {
  id: string;
  serverId: string;
  name: string;
  animated: boolean;
}

/** Width and height only for a picture the API recognised by its bytes; anything else is a download. */
export interface ChatAttachment {
  id: string;
  name: string;
  contentType: string;
  size: number;
  width: number | null;
  height: number | null;
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

function parseEmojiRefs(value: unknown): ChatEmojiRef[] | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 200) return undefined;
  const refs: ChatEmojiRef[] = [];
  for (const item of value) {
    const ref = record(item);
    if (!ref || typeof ref.id !== "string" || !UUID.test(ref.id) || typeof ref.name !== "string" || !EMOJI_NAME.test(ref.name)) return undefined;
    refs.push({ id: ref.id.toLowerCase(), name: ref.name, animated: ref.animated === true, removed: ref.removed === true });
  }
  return refs;
}

const PREVIEW_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

export function attachmentIsImage(attachment: ChatAttachment): boolean {
  return PREVIEW_TYPES.has(attachment.contentType) && attachment.width !== null && attachment.height !== null;
}

function dimension(value: unknown): number | null | undefined {
  if (value === null) return null;
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 16384 ? value : undefined;
}

export function parseChatAttachment(value: unknown): ChatAttachment | undefined {
  const attachment = record(value);
  if (!attachment) return undefined;
  const { id, name, contentType, size } = attachment;
  const width = dimension(attachment.width ?? null);
  const height = dimension(attachment.height ?? null);
  if (
    typeof id !== "string" ||
    !UUID.test(id) ||
    typeof name !== "string" ||
    name.length === 0 ||
    name.length > 510 ||
    typeof contentType !== "string" ||
    contentType.length > 127 ||
    typeof size !== "number" ||
    !Number.isInteger(size) ||
    size < 1 ||
    width === undefined ||
    height === undefined ||
    (width === null) !== (height === null)
  ) {
    return undefined;
  }
  return { id, name, contentType, size, width, height };
}

function parseAttachments(value: unknown): ChatAttachment[] | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > ATTACHMENTS_PER_MESSAGE) return undefined;
  const attachments = value.map(parseChatAttachment);
  return attachments.some((attachment) => attachment === undefined) ? undefined : (attachments as ChatAttachment[]);
}

/** Undefined for anything that is not a message as the API writes it. */
export function parseChatMessage(value: unknown): ChatMessage | undefined {
  const item = record(value);
  if (!item) return undefined;
  const { id, roomId, authorId, body, pinned, edited, deleted, createdAt } = item;
  const replyTo = parseReply(item.replyTo ?? null);
  const reactions = parseReactions(item.reactions);
  const mentions = parseMentions(item.mentions);
  const attachments = parseAttachments(item.attachments);
  const emojis = parseEmojiRefs(item.emojis);
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
    mentions === undefined ||
    attachments === undefined ||
    emojis === undefined
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
    attachments: deleted ? [] : attachments,
    emojis: deleted ? [] : emojis,
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

/** What the composer may send: CRLF as LF, not blank unless files go with it, within the API's limit counted in code points. */
export function sendableBody(value: string, withAttachments = false): string | undefined {
  const body = value.replace(/\r\n?/g, "\n");
  if ((body.trim().length === 0 && !withAttachments) || [...body].length > MESSAGE_MAX_CHARS) return undefined;
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

/** One line of text for previews: every `<@id>` as `@name`, every `<:name:id>` as `:name:`. */
export function plainBody(body: string, label: (userId: string) => string): string {
  return body.replace(MENTION_TOKEN, (_, id: string) => `@${label(id.toLowerCase())}`).replace(EMOJI_TOKEN, (_, name: string) => `:${name}:`);
}

// ADR 0024: a server emoji is `<:name:id>` in the text and `custom:<id>` in a reaction.
export const EMOJI_NAME = /^[A-Za-z0-9_]{2,32}$/;
export const EMOJI_TOKEN = /<:([A-Za-z0-9_]{2,32}):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})>/gi;
const CUSTOM_REACTION = /^custom:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
export const EMOJIS_PER_KIND = 50;

export function emojiToken(emoji: { id: string; name: string }): string {
  return `<:${emoji.name}:${emoji.id}>`;
}

export function customReaction(id: string): string {
  return `custom:${id}`;
}

/** The emoji id behind a `custom:<id>` reaction, or undefined for a Unicode one. */
export function customReactionId(emoji: string): string | undefined {
  return CUSTOM_REACTION.exec(emoji)?.[1]?.toLowerCase();
}

/** What the person edits: `:name:` in place of each `<:name:id>`. */
export function emojiDisplay(body: string): string {
  return body.replace(EMOJI_TOKEN, (_, name: string) => `:${name}:`);
}

const CODE_SPAN = /```[\s\S]*?```|`[^`\n]*`/g;
const EMOJI_SHORTCODE = /:([A-Za-z0-9_]{2,32}):/g;

/** Back to the wire: each `:name:` that names a usable emoji becomes its token. Code stays as typed. */
export function emojiWire(text: string, find: (name: string) => ServerEmoji | undefined): string {
  let out = "";
  let index = 0;
  for (const code of text.matchAll(CODE_SPAN)) {
    out += text.slice(index, code.index).replace(EMOJI_SHORTCODE, (whole, name: string) => {
      const emoji = find(name);
      return emoji ? emojiToken(emoji) : whole;
    });
    out += code[0];
    index = code.index + code[0].length;
  }
  return (
    out +
    text.slice(index).replace(EMOJI_SHORTCODE, (whole, name: string) => {
      const emoji = find(name);
      return emoji ? emojiToken(emoji) : whole;
    })
  );
}

export function parseServerEmoji(value: unknown): ServerEmoji | undefined {
  const item = record(value);
  if (!item) return undefined;
  const { id, serverId, name, animated } = item;
  if (typeof id !== "string" || !UUID.test(id) || typeof serverId !== "string" || !UUID.test(serverId) || typeof name !== "string" || !EMOJI_NAME.test(name)) {
    return undefined;
  }
  return { id: id.toLowerCase(), serverId: serverId.toLowerCase(), name, animated: animated === true };
}

export function parseServerEmojis(value: unknown): ServerEmoji[] | undefined {
  const list = record(value)?.emojis;
  if (!Array.isArray(list)) return undefined;
  const emojis = list.map(parseServerEmoji);
  return emojis.every((emoji): emoji is ServerEmoji => emoji !== undefined) ? emojis : undefined;
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
