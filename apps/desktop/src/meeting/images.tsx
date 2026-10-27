import { useEffect, useState } from "react";
import { cardInitial } from "@openmeet/media";
import { IMAGE_MAX_BYTES, IMAGE_TYPES, sniffImage } from "@openmeet/shared";
import { fetchImage, isTauri } from "../shell/native";

// ADR 0019: icons and avatars are fetched with the session (Rust in the .exe, cookie on the web) and shown
// as blob: URLs, so neither CSP changes. An id never changes its bytes, so a hit is kept for the session.
const loaded = new Map<string, Promise<string | null>>();
const RETRY_MS = 30_000;
const SIDE = 256;

function canFetch(): boolean {
  return __WEB__ || isTauri();
}

function load(origin: string, id: string): Promise<string | null> {
  const key = `${origin} ${id}`;
  const hit = loaded.get(key);
  if (hit) return hit;
  const next = fetchImage(origin, id)
    .then((bytes) => {
      const info = sniffImage(bytes);
      return info ? URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: info.type })) : null;
    })
    .catch(() => null);
  void next.then((url) => {
    if (url === null) setTimeout(() => loaded.delete(key), RETRY_MS);
  });
  loaded.set(key, next);
  return next;
}

export function useImage(origin: string | null, id: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    setUrl(null);
    if (origin === null || id === null || !canFetch()) return;
    let live = true;
    void load(origin, id).then((found) => {
      if (live) setUrl(found);
    });
    return () => {
      live = false;
    };
  }, [origin, id]);
  return url;
}

/** The picture when there is one, the initial otherwise. Sits inside the round wrapper of each place. */
export function Face(props: { origin: string | null; imageId: string | null; label: string }) {
  const url = useImage(props.origin, props.imageId);
  return url ? <img className="face" src={url} alt="" draggable={false} /> : <>{cardInitial(props.label)}</>;
}

async function encode(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

export function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

/**
 * Center-crops to a square, scales to 256 px and exports WebP (PNG when the browser has no WebP encoder).
 * Redrawing drops EXIF and GPS. The API judges the bytes again; this only keeps the upload small.
 */
export async function prepareImage(file: File): Promise<string> {
  if (!(IMAGE_TYPES as readonly string[]).includes(file.type)) throw new Error("invalid_image");
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = SIDE;
  canvas.height = SIDE;
  const context = canvas.getContext("2d");
  if (!context || side === 0) throw new Error("invalid_image");
  context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, SIDE, SIDE);
  bitmap.close();
  for (const [type, quality] of [
    ["image/webp", 0.86],
    ["image/webp", 0.6],
    ["image/png", 1],
  ] as const) {
    const blob = await encode(canvas, type, quality);
    if (!blob || blob.size > IMAGE_MAX_BYTES) continue;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (sniffImage(bytes)) return base64(bytes);
  }
  throw new Error("invalid_image");
}

/** A button that opens the file picker and hands back the prepared base64, or the reason it failed. */
export function ImagePicker(props: { label: string; disabled: boolean; onPick: (image: string) => void; onError: (message: string) => void }) {
  return (
    <label className={`ghost image-pick${props.disabled ? " disabled" : ""}`}>
      {props.label}
      <input
        type="file"
        accept={IMAGE_TYPES.join(",")}
        disabled={props.disabled}
        onChange={(event) => {
          const input = event.currentTarget;
          const file = input.files?.[0];
          input.value = "";
          if (!file) return;
          prepareImage(file).then(props.onPick, () => props.onError("Use uma imagem PNG, JPEG ou WebP."));
        }}
      />
    </label>
  );
}
