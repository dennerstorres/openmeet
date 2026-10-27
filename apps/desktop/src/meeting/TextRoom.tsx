import {
  ATTACHMENTS_PER_MESSAGE,
  ATTACHMENT_DEFAULT_MAX_BYTES,
  MESSAGE_MAX_CHARS,
  attachmentIsImage,
  canDeleteMessage,
  canEditMessage,
  mentionCandidates,
  mentionDisplay,
  mentionQuery,
  mentionWire,
  mentionsUser,
  mergeMessages,
  parseChatMessage,
  plainBody,
  sendableBody,
  type MentionCandidate,
  type ChatAttachment,
  type ChatMessage,
  type MeetingModel,
  type RoomSummary,
} from "@openmeet/shared";
import { useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from "react";
import { isTauri, openChatLink } from "../shell/native";
import type { ChatListener } from "./chat-events";
import { MessageFiles, PictureViewer, fileSize } from "./ChatFiles";
import { IconHash, IconPaperclip, IconPencil, IconPin, IconReply, IconSearch, IconSmile, IconTrash } from "./Icons";
import { Face, base64 } from "./images";
import { Markdown } from "./Markdown";

// ADR 0024: one text room on screen. History comes in pages, live changes through the session feed; the
// text is always rendered as text (markdown arrives in F13-07).

const TYPING_SEND_MS = 3_000;
const TYPING_SHOW_MS = 6_000;
const NEAR_BOTTOM_PX = 80;
/** The quick picker. Any Unicode emoji the API accepts works; these are the ones a click away. */
const QUICK_EMOJIS = ["👍", "👎", "😂", "❤️", "🎉", "😮", "😢", "😡", "🔥", "👏", "🙏", "💯", "✅", "❌", "👀", "🤔", "😍", "😎", "🚀", "⭐"];

function linkHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export interface ChatPerson {
  label: string;
  avatarId: string | null;
}

interface Props {
  model: MeetingModel;
  room: RoomSummary;
  origin: string | null;
  userId: string | null;
  manager: boolean;
  person: (id: string) => ChatPerson;
  /** Who `@` can name: the members of the room's server. */
  members: readonly { id: string; label: string; globalName: string }[];
  subscribe: (listener: ChatListener) => () => void;
  onClose: () => void;
}

const timeFormat = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });
const dayFormat = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });

function stamp(createdAt: string): string {
  const date = new Date(createdAt);
  const today = new Date();
  return date.toDateString() === today.toDateString() ? timeFormat.format(date) : `${dayFormat.format(date)} ${timeFormat.format(date)}`;
}

/** A file on its way up: the API's answer replaces the local guess once it is stored. */
interface PendingFile {
  key: string;
  name: string;
  size: number;
  state: "uploading" | "ready" | "failed";
  attachment: ChatAttachment | null;
  /** Local blob: URL, only once the API has called the bytes a picture. */
  preview: string | null;
}

function typingLine(names: string[]): string {
  if (names.length === 1) return `${names[0]} está digitando…`;
  if (names.length === 2) return `${names[0]} e ${names[1]} estão digitando…`;
  return "Várias pessoas estão digitando…";
}

export function TextRoom({ model, room, origin, userId, manager, person, members, subscribe, onClose }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [editing, setEditing] = useState<{ id: string; body: string; picks: Record<string, string> } | null>(null);
  // The composer shows `@name`; picks says which id each chosen name stands for when it is sent.
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [suggest, setSuggest] = useState<{ start: number; end: number; items: MentionCandidate[]; index: number } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [typing, setTyping] = useState<Record<string, number>>({});
  const [picker, setPicker] = useState<string | null>(null);
  const [pendingLink, setPendingLink] = useState<string | null>(null);
  const [panel, setPanel] = useState<"pins" | "search" | null>(null);
  const [pins, setPins] = useState<ChatMessage[] | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ messages: ChatMessage[]; hasMore: boolean } | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  // After a jump the list is a window in the past: live messages wait until the person returns to the end.
  const [detached, setDetached] = useState(false);
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [viewer, setViewer] = useState<{ attachment: ChatAttachment; url: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<PendingFile[]>([]);
  filesRef.current = files;
  const detachedRef = useRef(false);
  const listRef = useRef<HTMLOListElement | null>(null);
  const stickRef = useRef(true);
  const keepRef = useRef<{ height: number; top: number } | null>(null);
  const typedAt = useRef(0);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  const apply = (incoming: ChatMessage[]) => setMessages((held) => mergeMessages(held, incoming));

  useEffect(() => {
    let live = true;
    setMessages([]);
    setHasMore(false);
    setLoading(true);
    setReplyTo(null);
    setEditing(null);
    setTyping({});
    setPanel(null);
    setHighlight(null);
    setDetached(false);
    detachedRef.current = false;
    stickRef.current = true;
    const load = async () => {
      const page = await model.listMessages(room.id);
      if (!live) return;
      setLoading(false);
      if (page === null) return;
      if (detachedRef.current) return;
      setMessages((held) => mergeMessages(held, page.messages));
      setHasMore(page.hasMore);
    };
    void load();
    const unsubscribe = subscribe({
      event(name, data) {
        if (name === "typing") {
          const signal = data as { roomId?: unknown; userId?: unknown };
          if (signal.roomId === room.id && typeof signal.userId === "string") {
            const who = signal.userId;
            setTyping((held) => ({ ...held, [who]: Date.now() + TYPING_SHOW_MS }));
          }
          return;
        }
        if (name !== "message.created" && name !== "message.updated" && name !== "message.deleted") return;
        const message = parseChatMessage(data);
        if (!message || message.roomId !== room.id) return;
        setMessages((held) => (detachedRef.current && !held.some((item) => item.id === message.id) ? held : mergeMessages(held, [message])));
        setPins((held) => (held === null ? held : message.pinned ? mergeMessages(held, [message]).reverse() : held.filter((item) => item.id !== message.id)));
        if (name === "message.created") {
          setTyping((held) => {
            if (!(message.authorId in held)) return held;
            const rest = { ...held };
            delete rest[message.authorId];
            return rest;
          });
        }
      },
      // The API lost track of this stream: the newest page again, merged into what is on screen.
      reset() {
        void load();
      },
    });
    return () => {
      live = false;
      unsubscribe();
    };
  }, [model, room.id, subscribe]);

  useEffect(() => {
    if (Object.keys(typing).length === 0) return;
    const timer = window.setInterval(() => {
      const now = Date.now();
      setTyping((held) => {
        const kept = Object.fromEntries(Object.entries(held).filter(([, until]) => until > now));
        return Object.keys(kept).length === Object.keys(held).length ? held : kept;
      });
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [typing]);

  // New messages keep the view at the bottom while the person is there; an older page keeps the place;
  // a jump centres the message it went to.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const kept = keepRef.current;
    const target = highlight === null ? null : list.querySelector<HTMLElement>(`[data-message="${highlight}"]`);
    if (kept) {
      list.scrollTop = kept.top + (list.scrollHeight - kept.height);
      keepRef.current = null;
    } else if (target) {
      target.scrollIntoView({ block: "center" });
    } else if (stickRef.current) {
      list.scrollTop = list.scrollHeight;
    }
  }, [messages, highlight]);

  function setWindow(next: boolean): void {
    detachedRef.current = next;
    setDetached(next);
  }

  async function jumpTo(id: string): Promise<void> {
    const held = messages.some((message) => message.id === id);
    if (!held) {
      setLoading(true);
      const page = await model.listMessages(room.id, { around: id });
      setLoading(false);
      if (page === null) return;
      stickRef.current = false;
      setMessages(page.messages);
      setHasMore(page.hasMore);
      setWindow(page.hasNewer);
    }
    setHighlight(null);
    window.requestAnimationFrame(() => setHighlight(id));
    if (window.innerWidth <= 900) setPanel(null);
  }

  async function backToLatest(): Promise<void> {
    setLoading(true);
    const page = await model.listMessages(room.id);
    setLoading(false);
    if (page === null) return;
    stickRef.current = true;
    setHighlight(null);
    setWindow(false);
    setMessages(page.messages);
    setHasMore(page.hasMore);
  }

  async function loadNewer(): Promise<void> {
    const last = messages[messages.length - 1];
    if (!last || loading) return;
    setLoading(true);
    const page = await model.listMessages(room.id, { after: last.id });
    setLoading(false);
    if (page === null) return;
    apply(page.messages);
    if (!page.hasMore) setWindow(false);
  }

  async function react(message: ChatMessage, emoji: string): Promise<void> {
    setPicker(null);
    const mine = message.reactions.some((reaction) => reaction.emoji === emoji && userId !== null && reaction.userIds.includes(userId));
    const changed = await model.reactMessage(message.id, emoji, !mine);
    if (changed !== null) apply([changed]);
  }

  async function togglePin(message: ChatMessage): Promise<void> {
    const changed = await model.pinMessage(message.id, !message.pinned);
    if (changed === null) return;
    apply([changed]);
    setPins((held) =>
      held === null ? held : changed.pinned ? [changed, ...held.filter((item) => item.id !== changed.id)] : held.filter((item) => item.id !== changed.id),
    );
  }

  async function openPanel(next: "pins" | "search"): Promise<void> {
    if (panel === next) {
      setPanel(null);
      return;
    }
    setPanel(next);
    if (next === "pins") setPins(await model.listPins(room.id));
  }

  async function search(more: boolean): Promise<void> {
    const words = query.trim();
    if (words === "") return;
    const before = more ? results?.messages[results.messages.length - 1]?.id : undefined;
    const page = await model.searchMessages(room.id, words, before);
    if (page === null) return;
    setResults({ messages: more ? [...(results?.messages ?? []), ...page.messages] : page.messages, hasMore: page.hasMore });
  }

  async function loadOlder(): Promise<void> {
    const first = messages[0];
    const list = listRef.current;
    if (!first || loading) return;
    setLoading(true);
    const page = await model.listMessages(room.id, { before: first.id });
    setLoading(false);
    if (page === null) return;
    if (list) keepRef.current = { height: list.scrollHeight, top: list.scrollTop };
    apply(page.messages);
    setHasMore(page.hasMore);
  }

  // A file leaves the screen with its local preview.
  useEffect(() => () => filesRef.current.forEach((file) => file.preview && URL.revokeObjectURL(file.preview)), []);

  function dropFile(key: string): void {
    setFiles((list) => {
      const gone = list.find((file) => file.key === key);
      if (gone?.preview) URL.revokeObjectURL(gone.preview);
      return list.filter((file) => file.key !== key);
    });
  }

  function addFiles(picked: readonly File[]): void {
    if (picked.length === 0 || room.ended) return;
    const target = room.id;
    const free = ATTACHMENTS_PER_MESSAGE - filesRef.current.length;
    if (picked.length > free) setNotice(`Até ${ATTACHMENTS_PER_MESSAGE} arquivos por mensagem.`);
    for (const file of picked.slice(0, Math.max(0, free))) {
      if (file.size === 0 || file.size > ATTACHMENT_DEFAULT_MAX_BYTES) {
        setNotice(`${file.name}: cada arquivo vai até ${fileSize(ATTACHMENT_DEFAULT_MAX_BYTES)}.`);
        continue;
      }
      const key = `${Date.now()}-${Math.random()}`;
      setFiles((list) => [...list, { key, name: file.name, size: file.size, state: "uploading", attachment: null, preview: null }]);
      void (async () => {
        let bytes: Uint8Array<ArrayBuffer> | null = null;
        let stored: ChatAttachment | null = null;
        try {
          bytes = new Uint8Array(await file.arrayBuffer());
          stored = await model.uploadAttachment(target, file.name, base64(bytes));
        } catch {
          stored = null;
        }
        const preview = stored && bytes && attachmentIsImage(stored) ? URL.createObjectURL(new Blob([bytes], { type: stored.contentType })) : null;
        setFiles((list) => {
          if (!list.some((item) => item.key === key)) {
            if (preview) URL.revokeObjectURL(preview);
            return list;
          }
          return list.map((item) => (item.key === key ? { ...item, state: stored ? "ready" : "failed", attachment: stored, preview } : item));
        });
      })();
    }
  }

  function onPaste(event: ClipboardEvent<HTMLTextAreaElement>): void {
    const pasted = [...event.clipboardData.files];
    if (pasted.length === 0) return;
    event.preventDefault();
    addFiles(pasted);
  }

  function onDrop(event: DragEvent<HTMLElement>): void {
    setDragging(false);
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    addFiles([...event.dataTransfer.files]);
  }

  function onSaved(name: string | null): void {
    setNotice(name === null ? "Não foi possível baixar o arquivo." : isTauri() ? `Salvo em Downloads: ${name}` : `Baixado: ${name}`);
  }

  async function send(): Promise<void> {
    const ready = files.filter((file) => file.state === "ready" && file.attachment !== null);
    const body = sendableBody(mentionWire(draft, picks), ready.length > 0);
    if (body === undefined || sending || files.some((file) => file.state === "uploading")) return;
    setSending(true);
    const sent = await model.sendMessage(
      room.id,
      body,
      replyTo?.id,
      ready.map((file) => file.attachment?.id ?? ""),
    );
    setSending(false);
    if (sent === null) return;
    stickRef.current = true;
    apply([sent]);
    setDraft("");
    setPicks({});
    setSuggest(null);
    setReplyTo(null);
    files.forEach((file) => file.preview && URL.revokeObjectURL(file.preview));
    setFiles([]);
    setNotice(null);
    composerRef.current?.focus();
  }

  async function saveEdit(): Promise<void> {
    if (!editing) return;
    const body = sendableBody(mentionWire(editing.body, editing.picks));
    if (body === undefined) return;
    const edited = await model.editMessage(editing.id, body);
    if (edited === null) return;
    apply([edited]);
    setEditing(null);
  }

  async function remove(id: string): Promise<void> {
    const removed = await model.deleteMessage(id);
    setRemoving(null);
    if (removed !== null) apply([removed]);
  }

  const label = (id: string) => person(id).label;

  function startEdit(message: ChatMessage): void {
    const shown = mentionDisplay(message.body, label);
    setEditing({ id: message.id, body: shown.text, picks: shown.picks });
  }

  function choose(item: MentionCandidate): void {
    if (!suggest) return;
    const name = `@${item.label}`;
    const next = `${draft.slice(0, suggest.start)}${name} ${draft.slice(suggest.end)}`;
    if (item.id !== "everyone" && item.id !== "here") setPicks((held) => ({ ...held, [name]: item.id }));
    setDraft(next);
    setSuggest(null);
    const caret = suggest.start + name.length + 1;
    requestAnimationFrame(() => composerRef.current?.setSelectionRange(caret, caret));
  }

  function onComposerKey(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (suggest && suggest.items.length > 0) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setSuggest({ ...suggest, index: (suggest.index + step + suggest.items.length) % suggest.items.length });
        return;
      }
      if ((event.key === "Enter" || event.key === "Tab") && !event.shiftKey && !event.nativeEvent.isComposing) {
        event.preventDefault();
        const item = suggest.items[suggest.index];
        if (item) choose(item);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setSuggest(null);
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send();
    } else if (event.key === "Escape" && replyTo) {
      setReplyTo(null);
    } else if (event.key === "ArrowUp" && draft === "") {
      const own = [...messages].reverse().find((message) => canEditMessage(message, userId));
      if (own) {
        event.preventDefault();
        startEdit(own);
      }
    }
  }

  function onDraft(value: string, caret: number): void {
    setDraft(value);
    const typed = mentionQuery(value, caret);
    const items = typed ? mentionCandidates(members, typed.query, manager) : [];
    setSuggest(typed && items.length > 0 ? { start: typed.start, end: caret, items, index: 0 } : null);
    const now = Date.now();
    if (value.trim() !== "" && now - typedAt.current > TYPING_SEND_MS) {
      typedAt.current = now;
      void model.signalTyping(room.id);
    }
  }

  const readOnly = room.ended;
  const typingNames = Object.keys(typing)
    .filter((id) => id !== userId)
    .map((id) => person(id).label);
  const remaining = MESSAGE_MAX_CHARS - [...draft].length;

  return (
    <section
      className={`text-room${dragging ? " dragging" : ""}`}
      aria-labelledby="text-room-title"
      onDragOver={(event) => {
        if (readOnly || !event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setDragging(false);
      }}
      onDrop={onDrop}
    >
      {viewer ? <PictureViewer origin={origin} attachment={viewer.attachment} url={viewer.url} onSaved={onSaved} onClose={() => setViewer(null)} /> : null}
      <header className="text-room-head">
        <IconHash size={20} />
        <h1 id="text-room-title">{room.name}</h1>
        <button
          type="button"
          className="icon-btn"
          aria-label="Mensagens fixadas"
          title="Mensagens fixadas"
          aria-pressed={panel === "pins"}
          onClick={() => void openPanel("pins")}
        >
          <IconPin size={18} />
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label="Buscar nesta sala"
          title="Buscar nesta sala"
          aria-pressed={panel === "search"}
          onClick={() => void openPanel("search")}
        >
          <IconSearch size={18} />
        </button>
        <button type="button" className="ghost" onClick={onClose}>
          Fechar
        </button>
      </header>
      {pendingLink ? (
        <div className="link-confirm" role="alertdialog" aria-label="Abrir link externo">
          <p>
            Abrir <strong>{linkHost(pendingLink)}</strong> no navegador?
          </p>
          <p className="link-full">{pendingLink}</p>
          <div className="row">
            <button
              type="button"
              onClick={() => {
                const url = pendingLink;
                setPendingLink(null);
                void openChatLink(url).catch(() => undefined);
              }}
            >
              Abrir link
            </button>
            <button type="button" className="ghost" onClick={() => setPendingLink(null)}>
              Cancelar
            </button>
          </div>
        </div>
      ) : null}
      <div className={`text-room-body${panel ? " with-panel" : ""}`}>
        <ol
          ref={listRef}
          className="message-list"
          aria-label={`Mensagens de ${room.name}`}
          aria-busy={loading}
          onScroll={(event) => {
            const list = event.currentTarget;
            stickRef.current = list.scrollHeight - list.scrollTop - list.clientHeight < NEAR_BOTTOM_PX;
            if (list.scrollTop < 40 && hasMore && !loading) void loadOlder();
            if (detached && stickRef.current && !loading) void loadNewer();
          }}
        >
          {hasMore ? (
            <li className="message-more">
              <button type="button" className="ghost" disabled={loading} onClick={() => void loadOlder()}>
                Carregar mensagens anteriores
              </button>
            </li>
          ) : !loading ? (
            <li className="message-start">
              <IconHash size={28} />
              <p>Este é o começo de #{room.name}.</p>
            </li>
          ) : null}
          {messages.map((message, index) => {
            const author = person(message.authorId);
            const previous = messages[index - 1];
            const grouped =
              previous !== undefined &&
              !previous.deleted &&
              previous.authorId === message.authorId &&
              message.replyTo === null &&
              Date.parse(message.createdAt) - Date.parse(previous.createdAt) < 5 * 60_000;
            const isEditing = editing?.id === message.id;
            return (
              <li
                key={message.id}
                data-message={message.id}
                className={`message${grouped ? " grouped" : ""}${message.deleted ? " removed" : ""}${highlight === message.id ? " highlight" : ""}${mentionsUser(message, userId) ? " mentioned" : ""}`}
              >
                {message.replyTo ? (
                  <button type="button" className="message-reply" onClick={() => void jumpTo(message.replyTo?.id ?? message.id)}>
                    <IconReply size={14} />
                    <strong>{person(message.replyTo.authorId).label}</strong>
                    <span>{message.replyTo.deleted ? "mensagem removida" : plainBody(message.replyTo.body, label)}</span>
                  </button>
                ) : null}
                {grouped ? null : (
                  <span className="avatar small" aria-hidden="true">
                    <span>
                      <Face origin={origin} imageId={author.avatarId} label={author.label} />
                    </span>
                  </span>
                )}
                <div className="message-main">
                  {grouped ? null : (
                    <p className="message-meta">
                      <strong>{author.label}</strong>
                      <time dateTime={message.createdAt}>{stamp(message.createdAt)}</time>
                      {message.pinned ? <span className="message-pinned">fixada</span> : null}
                    </p>
                  )}
                  {message.deleted ? (
                    <p className="message-body removed">mensagem removida</p>
                  ) : isEditing ? (
                    <form
                      className="message-edit"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void saveEdit();
                      }}
                    >
                      <textarea
                        value={editing.body}
                        autoFocus
                        aria-label="Editar mensagem"
                        onChange={(event) => setEditing({ ...editing, body: event.currentTarget.value })}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") setEditing(null);
                          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                            event.preventDefault();
                            void saveEdit();
                          }
                        }}
                      />
                      <p className="hint">Enter salva · Esc cancela</p>
                    </form>
                  ) : (
                    <div className="message-body">
                      <Markdown
                        source={message.body}
                        onLink={setPendingLink}
                        mentions={{ users: message.mentions, everyone: message.mentionsEveryone, self: userId, label }}
                      />
                      {message.edited ? <span className="message-edited"> (editada)</span> : null}
                    </div>
                  )}
                  {message.deleted ? null : (
                    <MessageFiles
                      origin={origin}
                      attachments={message.attachments}
                      onOpen={(attachment, url) => setViewer({ attachment, url })}
                      onSaved={onSaved}
                    />
                  )}
                  {message.reactions.length > 0 ? (
                    <div className="reactions">
                      {message.reactions.map((reaction) => {
                        const mine = userId !== null && reaction.userIds.includes(userId);
                        const names = reaction.userIds.map((id) => person(id).label).join(", ");
                        return (
                          <button
                            key={reaction.emoji}
                            type="button"
                            className={`reaction${mine ? " mine" : ""}`}
                            aria-pressed={mine}
                            disabled={readOnly}
                            title={names}
                            aria-label={`${reaction.emoji} ${reaction.userIds.length}: ${names}`}
                            onClick={() => void react(message, reaction.emoji)}
                          >
                            <span aria-hidden="true">{reaction.emoji}</span>
                            <span>{reaction.userIds.length}</span>
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                  {picker === message.id ? (
                    <div className="emoji-picker" role="group" aria-label="Escolher reação">
                      {QUICK_EMOJIS.map((emoji) => (
                        <button key={emoji} type="button" aria-label={`Reagir com ${emoji}`} onClick={() => void react(message, emoji)}>
                          {emoji}
                        </button>
                      ))}
                      <button type="button" className="ghost" onClick={() => setPicker(null)}>
                        Fechar
                      </button>
                    </div>
                  ) : null}
                  {removing === message.id ? (
                    <div className="message-confirm" role="alertdialog" aria-label="Remover mensagem">
                      <span>Remover esta mensagem? Não dá para desfazer.</span>
                      <button type="button" className="danger-text" onClick={() => void remove(message.id)}>
                        Remover
                      </button>
                      <button type="button" className="ghost" onClick={() => setRemoving(null)}>
                        Cancelar
                      </button>
                    </div>
                  ) : null}
                </div>
                {!message.deleted && !isEditing && !readOnly ? (
                  <div className="message-actions">
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label="Responder"
                      title="Responder"
                      onClick={() => {
                        setReplyTo(message);
                        composerRef.current?.focus();
                      }}
                    >
                      <IconReply size={16} />
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label="Reagir"
                      title="Reagir"
                      aria-expanded={picker === message.id}
                      onClick={() => setPicker(picker === message.id ? null : message.id)}
                    >
                      <IconSmile size={16} />
                    </button>
                    {manager ? (
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={message.pinned ? "Desafixar" : "Fixar"}
                        title={message.pinned ? "Desafixar" : "Fixar"}
                        aria-pressed={message.pinned}
                        onClick={() => void togglePin(message)}
                      >
                        <IconPin size={16} />
                      </button>
                    ) : null}
                    {canEditMessage(message, userId) ? (
                      <button type="button" className="icon-btn" aria-label="Editar" title="Editar" onClick={() => startEdit(message)}>
                        <IconPencil size={16} />
                      </button>
                    ) : null}
                    {canDeleteMessage(message, userId, manager) ? (
                      <button type="button" className="icon-btn danger-text" aria-label="Remover" title="Remover" onClick={() => setRemoving(message.id)}>
                        <IconTrash size={16} />
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
        {panel === "pins" ? (
          <aside className="chat-panel" aria-label="Mensagens fixadas">
            <h2>Fixadas</h2>
            {pins === null ? (
              <p className="hint">Carregando…</p>
            ) : pins.length === 0 ? (
              <p className="hint">Nenhuma mensagem fixada nesta sala.</p>
            ) : (
              <ul>
                {pins.map((message) => (
                  <li key={message.id}>
                    <button type="button" className="chat-hit" onClick={() => void jumpTo(message.id)}>
                      <strong>{person(message.authorId).label}</strong>
                      <span>{plainBody(message.body, label)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        ) : panel === "search" ? (
          <aside className="chat-panel" aria-label="Buscar mensagens">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void search(false);
              }}
            >
              <input
                type="search"
                value={query}
                maxLength={100}
                autoFocus
                placeholder="Palavras da mensagem"
                aria-label="Buscar nesta sala"
                onChange={(event) => setQuery(event.currentTarget.value)}
              />
            </form>
            {results === null ? null : results.messages.length === 0 ? (
              <p className="hint">Nada encontrado.</p>
            ) : (
              <ul>
                {results.messages.map((message) => (
                  <li key={message.id}>
                    <button type="button" className="chat-hit" onClick={() => void jumpTo(message.id)}>
                      <strong>{person(message.authorId).label}</strong>
                      <time dateTime={message.createdAt}>{stamp(message.createdAt)}</time>
                      <span>{plainBody(message.body, label)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {results?.hasMore ? (
              <button type="button" className="ghost" onClick={() => void search(true)}>
                Mais resultados
              </button>
            ) : null}
          </aside>
        ) : null}
      </div>
      {detached ? (
        <button type="button" className="back-to-latest" onClick={() => void backToLatest()}>
          Ver mensagens mais recentes
        </button>
      ) : null}
      <p className="typing" aria-live="polite">
        {typingNames.length > 0 ? typingLine(typingNames) : ""}
      </p>
      {readOnly ? (
        <p className="hint text-room-closed">Esta sala foi encerrada. As mensagens ficam só para leitura.</p>
      ) : (
        <form
          className="composer"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          {replyTo ? (
            <p className="composer-reply">
              <span>
                Respondendo a <strong>{person(replyTo.authorId).label}</strong>
              </span>
              <button type="button" className="ghost" onClick={() => setReplyTo(null)}>
                Cancelar
              </button>
            </p>
          ) : null}
          {suggest ? (
            <ul className="mention-list" role="listbox" aria-label="Mencionar">
              {suggest.items.map((item, index) => (
                <li key={item.id} role="option" aria-selected={index === suggest.index}>
                  <button
                    type="button"
                    tabIndex={-1}
                    className={index === suggest.index ? "active" : undefined}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      choose(item);
                    }}
                  >
                    <strong>@{item.label}</strong>
                    {item.detail ? <span>{item.detail}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {files.length > 0 ? (
            <ul className="composer-files" aria-label="Arquivos para enviar">
              {files.map((file) => (
                <li key={file.key} className={`composer-file ${file.state}`}>
                  {file.preview ? <img src={file.preview} alt="" /> : null}
                  <span className="chat-file-name" title={file.name}>
                    {file.name}
                  </span>
                  <span className="chat-file-size">
                    {file.state === "uploading" ? "enviando…" : file.state === "failed" ? "falhou" : fileSize(file.attachment?.size ?? file.size)}
                  </span>
                  <button type="button" className="icon-btn" aria-label={`Tirar ${file.name}`} title="Tirar" onClick={() => dropFile(file.key)}>
                    <IconTrash size={16} />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {notice ? (
            <p className="composer-notice" role="status">
              {notice}
              <button type="button" className="ghost" onClick={() => setNotice(null)}>
                Ok
              </button>
            </p>
          ) : null}
          <button
            type="button"
            className="icon-btn composer-attach"
            aria-label="Anexar arquivos"
            title="Anexar arquivos"
            disabled={files.length >= ATTACHMENTS_PER_MESSAGE}
            onClick={() => fileInputRef.current?.click()}
          >
            <IconPaperclip size={18} />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            onChange={(event) => {
              addFiles([...(event.currentTarget.files ?? [])]);
              event.currentTarget.value = "";
            }}
          />
          <textarea
            ref={composerRef}
            onPaste={onPaste}
            value={draft}
            rows={1}
            placeholder={`Conversar em #${room.name}`}
            aria-label={`Mensagem para #${room.name}`}
            onChange={(event) => onDraft(event.currentTarget.value, event.currentTarget.selectionStart)}
            onBlur={() => setSuggest(null)}
            onKeyDown={onComposerKey}
          />
          {remaining < 200 ? <span className={`composer-count${remaining < 0 ? " over" : ""}`}>{remaining}</span> : null}
        </form>
      )}
    </section>
  );
}
