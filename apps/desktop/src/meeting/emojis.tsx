import { useEffect, useState } from "react";
import {
  EMOJI_MAX_BYTES,
  EMOJI_NAME,
  customReaction,
  customReactionId,
  sniffEmoji,
  type ChatEmojiRef,
  type MeetingModel,
  type ServerEmoji,
  type ServerSummary,
} from "@openmeet/shared";
import { fetchEmoji, isTauri } from "../shell/native";
import type { ChatListener } from "./chat-events";
import { base64 } from "./images";

// ADR 0024: server emojis. Pictures come through the session (Rust in the .exe, cookie on the web) as blob:
// URLs, like icons; an id never changes its bytes, so a hit is kept for the session.

const loaded = new Map<string, Promise<string | null>>();
const RETRY_MS = 30_000;
const SIDE = 128;

function load(origin: string, id: string): Promise<string | null> {
  const key = `${origin} ${id}`;
  const hit = loaded.get(key);
  if (hit) return hit;
  const next = fetchEmoji(origin, id)
    .then((bytes) => {
      const info = sniffEmoji(bytes);
      return info ? URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: info.type })) : null;
    })
    .catch(() => null);
  void next.then((url) => {
    if (url === null) setTimeout(() => loaded.delete(key), RETRY_MS);
  });
  loaded.set(key, next);
  return next;
}

/** The picture, or `:name:` while it loads or when it cannot. */
export function EmojiImage(props: { origin: string | null; id: string; name: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const { origin, id } = props;
  useEffect(() => {
    setUrl(null);
    if (origin === null || !(__WEB__ || isTauri())) return;
    let live = true;
    void load(origin, id).then((found) => {
      if (live) setUrl(found);
    });
    return () => {
      live = false;
    };
  }, [origin, id]);
  const text = `:${props.name}:`;
  return url ? <img className="chat-emoji" src={url} alt={text} title={text} draggable={false} /> : <>{text}</>;
}

/** A reaction as shown: Unicode as typed, a server emoji as its picture, a removed one as `:name:`. */
export function ReactionLabel(props: { origin: string | null; emoji: string; refs: readonly ChatEmojiRef[]; gone: ReadonlySet<string> }) {
  const id = customReactionId(props.emoji);
  if (id === undefined) return <>{props.emoji}</>;
  const ref = props.refs.find((item) => item.id === id);
  if (!ref) return <>?</>;
  return ref.removed || props.gone.has(ref.id) ? <>{`:${ref.name}:`}</> : <EmojiImage origin={props.origin} id={ref.id} name={ref.name} />;
}

export function reactionText(emoji: string, refs: readonly ChatEmojiRef[]): string {
  const id = customReactionId(emoji);
  if (id === undefined) return emoji;
  const ref = refs.find((item) => item.id === id);
  return ref ? `:${ref.name}:` : "emoji";
}

/** The caller's emojis, their servers and the selected one; reloads when any of them changes. */
export function useEmojiSet(model: MeetingModel, subscribe: (listener: ChatListener) => () => void) {
  const [emojis, setEmojis] = useState<ServerEmoji[]>([]);
  // Removed while the room is open: messages already on screen read `:name:` without a reload.
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const [shell, setShell] = useState(() => model.snapshot());
  useEffect(() => model.subscribe(setShell), [model]);
  useEffect(() => {
    let live = true;
    const reload = () => {
      void model.listEmojis().then((found) => {
        if (!live || found === null) return;
        setEmojis((held) => {
          const kept = new Set(found.map((emoji) => emoji.id));
          const lost = held.filter((emoji) => !kept.has(emoji.id));
          if (lost.length > 0) setGone((was) => new Set([...was, ...lost.map((emoji) => emoji.id)]));
          return found;
        });
      });
    };
    reload();
    const stop = subscribe({
      event: (name) => {
        if (name === "emoji.updated") reload();
      },
      reset: reload,
    });
    return () => {
      live = false;
      stop();
    };
  }, [model, subscribe]);
  const serverId = shell.selectedServerId;
  const role = shell.servers.find((server) => server.id === serverId)?.role;
  return {
    emojis,
    gone,
    servers: shell.servers,
    serverId,
    manager: role === "owner" || role === "moderator",
    /** `:name:` of the selected server, the only ones a room of it resolves. */
    find: (name: string) => emojis.find((emoji) => emoji.serverId === serverId && emoji.name.toLowerCase() === name.toLowerCase()),
  };
}

function defaultName(file: File): string {
  const base = file.name
    .replace(/\.[^.]*$/, "")
    .replace(/[^A-Za-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);
  return base.length >= 2 ? base : "emoji";
}

/**
 * Static pictures are fitted into 128×128 with their transparency and sent as PNG (WebP when smaller than the cap
 * would need). An animated GIF or WebP goes as it is: a canvas would keep only its first frame. The API judges again.
 */
export async function prepareEmoji(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const info = sniffEmoji(bytes);
  if (info?.animated === true) return base64(bytes);
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("invalid_emoji");
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  for (const [type, quality] of [
    ["image/png", 1],
    ["image/webp", 0.9],
  ] as const) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
    if (!blob || blob.size > EMOJI_MAX_BYTES) continue;
    const out = new Uint8Array(await blob.arrayBuffer());
    if (sniffEmoji(out)) return base64(out);
  }
  throw new Error("invalid_emoji");
}

function EmojiManager(props: { model: MeetingModel; origin: string | null; serverId: string; emojis: readonly ServerEmoji[] }) {
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);

  async function upload(): Promise<void> {
    if (!file || busy) return;
    if (!EMOJI_NAME.test(name)) {
      setProblem("O nome vai de 2 a 32 letras, números ou _.");
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const image = await prepareEmoji(file);
      if ((await props.model.uploadEmoji(props.serverId, name, image)) !== null) {
        setFile(null);
        setName("");
      }
    } catch {
      setProblem("Use uma imagem PNG, GIF ou WebP de até 256 KB.");
    }
    setBusy(false);
  }

  async function rename(): Promise<void> {
    if (!renaming || !EMOJI_NAME.test(renaming.name)) return;
    if (await props.model.renameEmoji(renaming.id, renaming.name)) setRenaming(null);
  }

  return (
    <div className="emoji-manage">
      <div className="emoji-manage-add">
        <label className="ghost image-pick">
          {file ? file.name : "Escolher imagem"}
          <input
            type="file"
            accept="image/png,image/gif,image/webp,image/jpeg"
            onChange={(event) => {
              const picked = event.currentTarget.files?.[0] ?? null;
              event.currentTarget.value = "";
              setFile(picked);
              if (picked && name === "") setName(defaultName(picked));
            }}
          />
        </label>
        <input aria-label="Nome do emoji" placeholder="nome" value={name} maxLength={32} onChange={(event) => setName(event.currentTarget.value)} />
        <button type="button" disabled={!file || busy} onClick={() => void upload()}>
          Enviar
        </button>
      </div>
      {problem ? <p className="error">{problem}</p> : null}
      <ul className="emoji-manage-list">
        {props.emojis.map((emoji) => (
          <li key={emoji.id}>
            <EmojiImage origin={props.origin} id={emoji.id} name={emoji.name} />
            {renaming?.id === emoji.id ? (
              <>
                <input
                  aria-label={`Novo nome de ${emoji.name}`}
                  value={renaming.name}
                  maxLength={32}
                  onChange={(event) => setRenaming({ id: emoji.id, name: event.currentTarget.value })}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void rename();
                    if (event.key === "Escape") setRenaming(null);
                  }}
                />
                <button type="button" className="ghost" onClick={() => void rename()}>
                  Salvar
                </button>
              </>
            ) : (
              <>
                <span className="emoji-manage-name">:{emoji.name}:</span>
                <button type="button" className="ghost" onClick={() => setRenaming({ id: emoji.id, name: emoji.name })}>
                  Renomear
                </button>
                <button type="button" className="ghost" onClick={() => void props.model.deleteEmoji(emoji.id)}>
                  Remover
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Tabs: the quick Unicode set, then one per server with emojis (the current one first). Only `usable` servers
 * can be picked: in a room, its own server. `onPick` gets Unicode as typed or `custom:<id>`.
 */
export function EmojiPicker(props: {
  origin: string | null;
  model: MeetingModel;
  servers: readonly ServerSummary[];
  emojis: readonly ServerEmoji[];
  currentServerId: string | null;
  manager: boolean;
  usable: (serverId: string) => boolean;
  quick: readonly string[];
  label: string;
  onPick: (value: string, emoji: ServerEmoji | null) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<string>("unicode");
  const [managing, setManaging] = useState(false);
  const withEmojis = props.servers.filter((server) => server.id === props.currentServerId || props.emojis.some((emoji) => emoji.serverId === server.id));
  const ordered = [
    ...withEmojis.filter((server) => server.id === props.currentServerId),
    ...withEmojis.filter((server) => server.id !== props.currentServerId),
  ];
  const shown = props.emojis.filter((emoji) => emoji.serverId === tab);
  const canUse = tab !== "unicode" && props.usable(tab);
  return (
    <div className="emoji-picker emoji-tabs" role="group" aria-label={props.label}>
      <div className="emoji-tab-row" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "unicode"} className="emoji-tab" onClick={() => setTab("unicode")}>
          Padrão
        </button>
        {ordered.map((server) => (
          <button key={server.id} type="button" role="tab" aria-selected={tab === server.id} className="emoji-tab" onClick={() => setTab(server.id)}>
            {server.name}
          </button>
        ))}
        <button type="button" className="ghost" onClick={props.onClose}>
          Fechar
        </button>
      </div>
      {tab === "unicode" ? (
        <div className="emoji-grid">
          {props.quick.map((emoji) => (
            <button key={emoji} type="button" aria-label={`Escolher ${emoji}`} onClick={() => props.onPick(emoji, null)}>
              {emoji}
            </button>
          ))}
        </div>
      ) : (
        <>
          {shown.length === 0 ? <p className="hint">Este servidor ainda não tem emoji próprio.</p> : null}
          {!canUse && shown.length > 0 ? <p className="hint">Só vale nas salas desse servidor e nas DMs de quem é membro dele.</p> : null}
          <div className="emoji-grid">
            {shown.map((emoji) => (
              <button
                key={emoji.id}
                type="button"
                disabled={!canUse}
                aria-label={`Escolher :${emoji.name}:`}
                title={`:${emoji.name}:`}
                onClick={() => props.onPick(customReaction(emoji.id), emoji)}
              >
                <EmojiImage origin={props.origin} id={emoji.id} name={emoji.name} />
              </button>
            ))}
          </div>
          {props.manager && tab === props.currentServerId ? (
            <>
              <button type="button" className="ghost" aria-expanded={managing} onClick={() => setManaging(!managing)}>
                {managing ? "Fechar gerenciamento" : "Gerenciar emojis"}
              </button>
              {managing ? <EmojiManager model={props.model} origin={props.origin} serverId={tab} emojis={shown} /> : null}
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
