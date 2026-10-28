import { useEffect, useState } from "react";
import { attachmentIsImage, sniffAttachmentImage, type ChatAttachment } from "@openmeet/shared";
import { fetchAttachment, isTauri, saveAttachment } from "../shell/native";
import { Button } from "@fluentui/react-components";
import { ArrowDownloadRegular } from "@fluentui/react-icons";
import { IconAction } from "./fluent";

// ADR 0024: files on a message. A picture the API measured is fetched with the session (Rust in the .exe,
// cookie on the web), checked again here and shown from a blob: URL; anything else is only a download.

const loaded = new Map<string, Promise<string | null>>();
/** Pictures kept in memory for the session; past this the oldest goes. */
const KEPT = 60;

function load(origin: string, attachment: ChatAttachment): Promise<string | null> {
  const key = `${origin} ${attachment.id}`;
  const hit = loaded.get(key);
  if (hit) return hit;
  const next = fetchAttachment(origin, attachment.id)
    .then((bytes) => {
      const info = sniffAttachmentImage(bytes);
      return info && info.type === attachment.contentType ? URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: info.type })) : null;
    })
    .catch(() => null);
  void next.then((url) => {
    if (url === null) loaded.delete(key);
  });
  loaded.set(key, next);
  if (loaded.size > KEPT) {
    const [oldest] = loaded.keys();
    if (oldest !== undefined) {
      void loaded.get(oldest)?.then((url) => url && URL.revokeObjectURL(url));
      loaded.delete(oldest);
    }
  }
  return next;
}

function usePicture(origin: string | null, attachment: ChatAttachment): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    setUrl(null);
    if (origin === null || !(__WEB__ || isTauri())) return;
    let live = true;
    void load(origin, attachment).then((found) => {
      if (live) setUrl(found);
    });
    return () => {
      live = false;
    };
    // The message object changes with every reaction; the picture behind one id never does.
  }, [origin, attachment.id]);
  return url;
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

export async function download(origin: string | null, attachment: ChatAttachment): Promise<string | null> {
  if (origin === null) return null;
  try {
    return await saveAttachment(origin, attachment.id, attachment.name);
  } catch {
    return null;
  }
}

/** Room for the picture before it loads, so the list does not jump; on a narrow screen it shrinks keeping the shape. */
function box(attachment: ChatAttachment): { width: number; height: number } {
  const width = attachment.width ?? 1;
  const height = attachment.height ?? 1;
  const scale = Math.min(1, 320 / width, 240 / height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function Picture(props: { origin: string | null; attachment: ChatAttachment; onOpen: (attachment: ChatAttachment, url: string) => void }) {
  const url = usePicture(props.origin, props.attachment);
  const size = box(props.attachment);
  return (
    <button
      type="button"
      className="chat-picture"
      style={{ width: size.width, aspectRatio: `${size.width} / ${size.height}` }}
      aria-label={`Abrir imagem ${props.attachment.name}`}
      disabled={url === null}
      onClick={() => url && props.onOpen(props.attachment, url)}
    >
      {url ? <img src={url} alt={props.attachment.name} draggable={false} /> : null}
    </button>
  );
}

export function MessageFiles(props: {
  origin: string | null;
  attachments: ChatAttachment[];
  onOpen: (attachment: ChatAttachment, url: string) => void;
  onSaved: (name: string | null) => void;
}) {
  if (props.attachments.length === 0) return null;
  return (
    <div className="chat-files">
      {props.attachments.map((attachment) =>
        attachmentIsImage(attachment) ? (
          <Picture key={attachment.id} origin={props.origin} attachment={attachment} onOpen={props.onOpen} />
        ) : (
          <div key={attachment.id} className="chat-file">
            <span className="chat-file-name" title={attachment.name}>
              {attachment.name}
            </span>
            <span className="chat-file-size">{fileSize(attachment.size)}</span>
            <IconAction
              label={`Baixar ${attachment.name}`}
              icon={<ArrowDownloadRegular />}
              onClick={() => void download(props.origin, attachment).then(props.onSaved)}
            />
          </div>
        ),
      )}
    </div>
  );
}

export function PictureViewer(props: {
  origin: string | null;
  attachment: ChatAttachment;
  url: string;
  onSaved: (name: string | null) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props]);
  return (
    <div className="picture-viewer" role="dialog" aria-modal="true" aria-label={props.attachment.name} onClick={props.onClose}>
      <img src={props.url} alt={props.attachment.name} onClick={(event) => event.stopPropagation()} />
      <div className="row" onClick={(event) => event.stopPropagation()}>
        <span className="chat-file-name">{props.attachment.name}</span>
        <Button appearance="primary" onClick={() => void download(props.origin, props.attachment).then(props.onSaved)}>
          Baixar
        </Button>
        <Button appearance="subtle" autoFocus onClick={props.onClose}>
          Fechar
        </Button>
      </div>
    </div>
  );
}
