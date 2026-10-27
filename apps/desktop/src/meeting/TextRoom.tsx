import {
  MESSAGE_MAX_CHARS,
  canDeleteMessage,
  canEditMessage,
  mergeMessages,
  parseChatMessage,
  sendableBody,
  type ChatMessage,
  type MeetingModel,
  type RoomSummary,
} from "@openmeet/shared";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import type { ChatListener } from "./chat-events";
import { IconHash, IconPencil, IconReply, IconTrash } from "./Icons";
import { Face } from "./images";

// ADR 0024: one text room on screen. History comes in pages, live changes through the session feed; the
// text is always rendered as text (markdown arrives in F13-07).

const TYPING_SEND_MS = 3_000;
const TYPING_SHOW_MS = 6_000;
const NEAR_BOTTOM_PX = 80;

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

function typingLine(names: string[]): string {
  if (names.length === 1) return `${names[0]} está digitando…`;
  if (names.length === 2) return `${names[0]} e ${names[1]} estão digitando…`;
  return "Várias pessoas estão digitando…";
}

export function TextRoom({ model, room, origin, userId, manager, person, subscribe, onClose }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [typing, setTyping] = useState<Record<string, number>>({});
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
    stickRef.current = true;
    const load = async () => {
      const page = await model.listMessages(room.id);
      if (!live) return;
      setLoading(false);
      if (page === null) return;
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
        setMessages((held) => mergeMessages(held, [message]));
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

  // New messages keep the view at the bottom while the person is there; an older page keeps the place.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const kept = keepRef.current;
    if (kept) {
      list.scrollTop = kept.top + (list.scrollHeight - kept.height);
      keepRef.current = null;
    } else if (stickRef.current) {
      list.scrollTop = list.scrollHeight;
    }
  }, [messages]);

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

  async function send(): Promise<void> {
    const body = sendableBody(draft);
    if (body === undefined || sending) return;
    setSending(true);
    const sent = await model.sendMessage(room.id, body, replyTo?.id);
    setSending(false);
    if (sent === null) return;
    stickRef.current = true;
    apply([sent]);
    setDraft("");
    setReplyTo(null);
    composerRef.current?.focus();
  }

  async function saveEdit(): Promise<void> {
    if (!editing) return;
    const body = sendableBody(editing.body);
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

  function onComposerKey(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send();
    } else if (event.key === "Escape" && replyTo) {
      setReplyTo(null);
    } else if (event.key === "ArrowUp" && draft === "") {
      const own = [...messages].reverse().find((message) => canEditMessage(message, userId));
      if (own) {
        event.preventDefault();
        setEditing({ id: own.id, body: own.body });
      }
    }
  }

  function onDraft(value: string): void {
    setDraft(value);
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
    <section className="text-room" aria-labelledby="text-room-title">
      <header className="text-room-head">
        <IconHash size={20} />
        <h1 id="text-room-title">{room.name}</h1>
        <button type="button" className="ghost" onClick={onClose}>
          Fechar
        </button>
      </header>
      <ol
        ref={listRef}
        className="message-list"
        aria-label={`Mensagens de ${room.name}`}
        aria-busy={loading}
        onScroll={(event) => {
          const list = event.currentTarget;
          stickRef.current = list.scrollHeight - list.scrollTop - list.clientHeight < NEAR_BOTTOM_PX;
          if (list.scrollTop < 40 && hasMore && !loading) void loadOlder();
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
            <li key={message.id} className={`message${grouped ? " grouped" : ""}${message.deleted ? " removed" : ""}`}>
              {message.replyTo ? (
                <p className="message-reply">
                  <IconReply size={14} />
                  <strong>{person(message.replyTo.authorId).label}</strong>
                  <span>{message.replyTo.deleted ? "mensagem removida" : message.replyTo.body}</span>
                </p>
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
                      onChange={(event) => setEditing({ id: message.id, body: event.currentTarget.value })}
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
                  <p className="message-body">
                    {message.body}
                    {message.edited ? <span className="message-edited"> (editada)</span> : null}
                  </p>
                )}
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
                  {canEditMessage(message, userId) ? (
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label="Editar"
                      title="Editar"
                      onClick={() => setEditing({ id: message.id, body: message.body })}
                    >
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
          <textarea
            ref={composerRef}
            value={draft}
            rows={1}
            placeholder={`Conversar em #${room.name}`}
            aria-label={`Mensagem para #${room.name}`}
            onChange={(event) => onDraft(event.currentTarget.value)}
            onKeyDown={onComposerKey}
          />
          {remaining < 200 ? <span className={`composer-count${remaining < 0 ? " over" : ""}`}>{remaining}</span> : null}
        </form>
      )}
    </section>
  );
}
