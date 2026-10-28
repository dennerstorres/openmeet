import { useCallback, useEffect, useRef, useState } from "react";
import {
  EMPTY_UNREAD,
  applyRead,
  badgeCount,
  clearChat,
  countMessage,
  findUnread,
  parseChatMessage,
  parseUnreadChat,
  shouldNotify,
  type ChatMessage,
  type ChatRef,
  type MeetingModel,
  type NotifyLevel,
  type UnreadState,
} from "@openmeet/shared";
import { Select } from "@fluentui/react-components";
import { notifyChat, setUnreadBadge } from "../shell/native";
import type { ChatListener } from "./chat-events";

// ADR 0024 (F13-13): unread counts that live on the server, the badge on the tray or the tab, and the
// notification for a message that arrives while its chat is not in front of the person.

type Subscribe = (listener: ChatListener) => () => void;

/** True while the window has focus and is on screen; a window hidden in the tray is not. */
export function useWindowFocus(): boolean {
  const read = () => document.visibilityState === "visible" && document.hasFocus();
  const [focused, setFocused] = useState(read);
  useEffect(() => {
    const update = () => setFocused(read());
    window.addEventListener("focus", update);
    window.addEventListener("blur", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.removeEventListener("focus", update);
      window.removeEventListener("blur", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  return focused;
}

export function useUnread(props: {
  model: MeetingModel;
  subscribe: Subscribe;
  selfId: string | null;
  origin: string | null;
  /** The chat on screen, focused or not. */
  open: ChatRef | null;
  focused: boolean;
  /** Title and text of the notification; the text never reaches a log. */
  describe: (message: ChatMessage) => { title: string; body: string };
}) {
  const { model, subscribe, selfId, origin, open, focused } = props;
  const [state, setState] = useState<UnreadState>(EMPTY_UNREAD);
  const stateRef = useRef(state);
  stateRef.current = state;
  const viewing = focused ? open : null;
  const viewingRef = useRef(viewing);
  viewingRef.current = viewing;
  const describeRef = useRef(props.describe);
  describeRef.current = props.describe;

  const read = useCallback(
    (chat: ChatRef) => {
      setState((held) => clearChat(held, chat));
      void model.markRead(chat).then((done) => {
        if (done) setState((held) => applyRead(held, done));
      });
    },
    [model],
  );

  useEffect(() => {
    setState(EMPTY_UNREAD);
    if (selfId === null || origin === null) return;
    let live = true;
    const load = async () => {
      const found = await model.listUnread();
      if (live && found) setState(found);
    };
    void load();
    const unsubscribe = subscribe({
      event(name, data) {
        if (name === "read") {
          const done = parseUnreadChat(data);
          if (done) setState((held) => applyRead(held, done));
          return;
        }
        if (name !== "message.created") return;
        const message = parseChatMessage(data);
        if (!message) return;
        const inView = viewingRef.current;
        if (shouldNotify(stateRef.current, message, selfId, inView)) {
          const { title, body } = describeRef.current(message);
          const chat: ChatRef = message.dmId ? { kind: "dm", id: message.dmId } : { kind: "room", id: message.roomId ?? "" };
          void notifyChat(title, body, chat).catch(() => undefined);
        }
        if (inView !== null && (inView.kind === "dm" ? message.dmId : message.roomId) === inView.id && message.authorId !== selfId) {
          void model.markRead(inView, message.id).then((done) => {
            if (done) setState((held) => applyRead(held, done));
          });
          return;
        }
        setState((held) => countMessage(held, message, selfId, inView));
      },
      reset() {
        void load();
      },
    });
    return () => {
      live = false;
      unsubscribe();
    };
  }, [model, subscribe, selfId, origin]);

  // Opening a chat, or coming back to the window with one open, reads it.
  const viewingKey = viewing === null ? null : `${viewing.kind}:${viewing.id}`;
  const pending = viewing !== null && (findUnread(state, viewing)?.unread ?? 0) > 0;
  useEffect(() => {
    if (viewing !== null && pending) read(viewing);
    // viewing is rebuilt each render; its key is what changes.
  }, [viewingKey, pending, read]);

  const count = badgeCount(state);
  useEffect(() => {
    void setUnreadBadge(count).catch(() => undefined);
  }, [count]);
  useEffect(() => () => void setUnreadBadge(0).catch(() => undefined), []);

  const setLevel = useCallback(
    async (scope: "server" | ChatRef["kind"], id: string, level: NotifyLevel | null) => {
      const next = await model.setNotifyLevel(scope, id, level);
      if (next) setState(next);
    },
    [model],
  );

  return { state, setLevel };
}

const LEVEL_LABEL: Record<NotifyLevel, string> = { all: "Todas as mensagens", mentions: "Só menções", none: "Nada" };

/** The level of a server, room or DM. `inherited` is what "Padrão" means there; null hides that choice. */
export function NotifyLevelPicker(props: {
  label: string;
  value: NotifyLevel | null;
  inherited: NotifyLevel | null;
  onChange: (level: NotifyLevel | null) => void;
}) {
  return (
    <Select
      className="notify-level"
      size="small"
      aria-label={props.label}
      title={props.label}
      value={props.value ?? ""}
      onChange={(_, data) => props.onChange(data.value === "" ? null : (data.value as NotifyLevel))}
    >
      {props.inherited !== null ? <option value="">Padrão ({LEVEL_LABEL[props.inherited].toLowerCase()})</option> : null}
      {(Object.keys(LEVEL_LABEL) as NotifyLevel[]).map((level) => (
        <option key={level} value={level}>
          {LEVEL_LABEL[level]}
        </option>
      ))}
    </Select>
  );
}
