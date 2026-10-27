// ADR 0019. Icons and avatars: PNG, JPEG or WebP only, judged by the bytes, never by a declared type.

export const IMAGE_MAX_BYTES = 256 * 1024;
export const IMAGE_MAX_SIDE = 512;
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

export type ImageType = (typeof IMAGE_TYPES)[number];

export interface ImageInfo {
  type: ImageType;
  width: number;
  height: number;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_END = [0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82];

function startsWith(bytes: Uint8Array, prefix: readonly number[], offset = 0): boolean {
  return bytes.length >= offset + prefix.length && prefix.every((value, index) => bytes[offset + index] === value);
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function u16be(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
}

function u16le(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

function u24le(bytes: Uint8Array, offset: number): number {
  return u16le(bytes, offset) | ((bytes[offset + 2] ?? 0) << 16);
}

function u32be(bytes: Uint8Array, offset: number): number {
  return u16be(bytes, offset) * 0x10000 + u16be(bytes, offset + 2);
}

function u32le(bytes: Uint8Array, offset: number): number {
  return u16le(bytes, offset) + u16le(bytes, offset + 2) * 0x10000;
}

function png(bytes: Uint8Array): ImageInfo | undefined {
  // IHDR must come first, and the file must end on IEND: a truncated or padded upload is refused.
  if (bytes.length < 45 || u32be(bytes, 8) !== 13 || ascii(bytes, 12, 4) !== "IHDR") return undefined;
  if (!startsWith(bytes, PNG_END, bytes.length - PNG_END.length)) return undefined;
  return { type: "image/png", width: u32be(bytes, 16), height: u32be(bytes, 20) };
}

function jpeg(bytes: Uint8Array): ImageInfo | undefined {
  if (bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) return undefined;
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return undefined;
    const marker = bytes[offset + 1] ?? 0;
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      offset += 2;
      continue;
    }
    const length = u16be(bytes, offset + 2);
    if (length < 2 || offset + 2 + length > bytes.length) return undefined;
    const frame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (frame) {
      if (length < 7) return undefined;
      return { type: "image/jpeg", width: u16be(bytes, offset + 7), height: u16be(bytes, offset + 5) };
    }
    if (marker === 0xda || marker === 0xd9) return undefined;
    offset += 2 + length;
  }
  return undefined;
}

function webp(bytes: Uint8Array): ImageInfo | undefined {
  if (bytes.length < 25 || ascii(bytes, 8, 4) !== "WEBP" || u32le(bytes, 4) + 8 !== bytes.length) return undefined;
  const chunk = ascii(bytes, 12, 4);
  if (chunk === "VP8 ") {
    if (bytes.length < 30 || !startsWith(bytes, [0x9d, 0x01, 0x2a], 23)) return undefined;
    return { type: "image/webp", width: u16le(bytes, 26) & 0x3fff, height: u16le(bytes, 28) & 0x3fff };
  }
  if (chunk === "VP8L") {
    if (bytes[20] !== 0x2f) return undefined;
    const bits = u32le(bytes, 21);
    return { type: "image/webp", width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8X") {
    // Animation is out of ADR 0019.
    if (bytes.length < 30 || ((bytes[20] ?? 0) & 0x02) !== 0) return undefined;
    return { type: "image/webp", width: u24le(bytes, 24) + 1, height: u24le(bytes, 27) + 1 };
  }
  return undefined;
}

/** The real type and size of an upload, or undefined when it is not an accepted image. */
export function sniffImage(bytes: Uint8Array): ImageInfo | undefined {
  if (bytes.length === 0 || bytes.length > IMAGE_MAX_BYTES) return undefined;
  let info: ImageInfo | undefined;
  if (startsWith(bytes, PNG_SIGNATURE)) info = png(bytes);
  else if (startsWith(bytes, [0xff, 0xd8, 0xff])) info = jpeg(bytes);
  else if (ascii(bytes, 0, 4) === "RIFF") info = webp(bytes);
  if (!info) return undefined;
  if (info.width < 1 || info.height < 1 || info.width > IMAGE_MAX_SIDE || info.height > IMAGE_MAX_SIDE) return undefined;
  return info;
}

// ADR 0024: chat attachments. Same signatures plus GIF, larger pictures, and no size cap here: the API
// applies ATTACHMENT_MAX_BYTES. Anything that does not parse is a plain file and is only ever downloaded.
export const ATTACHMENT_IMAGE_MAX_SIDE = 16384;
export const ATTACHMENT_IMAGE_TYPES = [...IMAGE_TYPES, "image/gif"] as const;

export interface AttachmentImageInfo {
  type: (typeof ATTACHMENT_IMAGE_TYPES)[number];
  width: number;
  height: number;
}

function gif(bytes: Uint8Array): AttachmentImageInfo | undefined {
  if (bytes.length < 14 || bytes[bytes.length - 1] !== 0x3b) return undefined;
  return { type: "image/gif", width: u16le(bytes, 6), height: u16le(bytes, 8) };
}

export function sniffAttachmentImage(bytes: Uint8Array): AttachmentImageInfo | undefined {
  let info: AttachmentImageInfo | undefined;
  if (startsWith(bytes, PNG_SIGNATURE)) info = png(bytes);
  else if (startsWith(bytes, [0xff, 0xd8, 0xff])) info = jpeg(bytes);
  else if (ascii(bytes, 0, 4) === "RIFF") info = webp(bytes);
  else if (ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a") info = gif(bytes);
  if (!info) return undefined;
  if (info.width < 1 || info.height < 1 || info.width > ATTACHMENT_IMAGE_MAX_SIDE || info.height > ATTACHMENT_IMAGE_MAX_SIDE) return undefined;
  return info;
}

// ADR 0024: server emojis. PNG, GIF or WebP judged by the bytes, up to 256 KB. Static pictures are cut to
// 128×128 by the client; an animated one goes as sent, so the side cap leaves it some room.
export const EMOJI_MAX_BYTES = 256 * 1024;
export const EMOJI_MAX_SIDE = 256;
export const EMOJI_TYPES = ["image/png", "image/gif", "image/webp"] as const;

export interface EmojiImageInfo {
  type: (typeof EMOJI_TYPES)[number];
  width: number;
  height: number;
  animated: boolean;
}

// A GIF moves when it holds more than one image descriptor; walking the blocks is the only honest count.
function gifFrames(bytes: Uint8Array): number | undefined {
  let offset = 13;
  if (((bytes[10] ?? 0) & 0x80) !== 0) offset += 3 * (1 << (((bytes[10] ?? 0) & 0x07) + 1));
  let frames = 0;
  while (offset < bytes.length) {
    const block = bytes[offset];
    if (block === 0x3b) return frames;
    if (block === 0x21) {
      offset += 2;
    } else if (block === 0x2c) {
      frames += 1;
      const flags = bytes[offset + 9] ?? 0;
      offset += 10;
      if ((flags & 0x80) !== 0) offset += 3 * (1 << ((flags & 0x07) + 1));
      offset += 1;
    } else {
      return undefined;
    }
    while (offset < bytes.length) {
      const size = bytes[offset] ?? 0;
      offset += 1 + size;
      if (size === 0) break;
    }
  }
  return undefined;
}

function animatedWebp(bytes: Uint8Array): EmojiImageInfo | undefined {
  if (bytes.length < 30 || ascii(bytes, 8, 4) !== "WEBP" || u32le(bytes, 4) + 8 !== bytes.length || ascii(bytes, 12, 4) !== "VP8X") return undefined;
  if (((bytes[20] ?? 0) & 0x02) === 0) return undefined;
  return { type: "image/webp", width: u24le(bytes, 24) + 1, height: u24le(bytes, 27) + 1, animated: true };
}

export function sniffEmoji(bytes: Uint8Array): EmojiImageInfo | undefined {
  if (bytes.length === 0 || bytes.length > EMOJI_MAX_BYTES) return undefined;
  let info: EmojiImageInfo | undefined;
  if (startsWith(bytes, PNG_SIGNATURE)) {
    const still = png(bytes);
    if (still) info = { ...still, type: "image/png", animated: false };
  } else if (ascii(bytes, 0, 4) === "RIFF") {
    const still = webp(bytes);
    info = still ? { ...still, type: "image/webp", animated: false } : animatedWebp(bytes);
  } else if (ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a") {
    const frames = gifFrames(bytes);
    const still = gif(bytes);
    if (still && frames !== undefined && frames > 0) info = { type: "image/gif", width: still.width, height: still.height, animated: frames > 1 };
  }
  if (!info) return undefined;
  if (info.width < 1 || info.height < 1 || info.width > EMOJI_MAX_SIDE || info.height > EMOJI_MAX_SIDE) return undefined;
  return info;
}
