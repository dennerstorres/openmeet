// ADR 0021. The sound library takes one format only: WAV PCM 16-bit, mono, 24 kHz, at most 20 s.
// The client converts any file the browser decodes; the API judges the bytes, never a declared type.

export const SOUND_SAMPLE_RATE = 24000;
export const SOUND_MAX_MS = 20_000;
export const SOUND_HEADER_BYTES = 44;
export const SOUND_MAX_BYTES = SOUND_HEADER_BYTES + (SOUND_SAMPLE_RATE * 2 * SOUND_MAX_MS) / 1000;
export const SOUND_NAME_MAX = 32;

export interface SoundInfo {
  samples: number;
  durationMs: number;
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function u16le(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

function u32le(bytes: Uint8Array, offset: number): number {
  return u16le(bytes, offset) + u16le(bytes, offset + 2) * 0x10000;
}

/** The canonical layout or nothing: RIFF, one 16-byte `fmt ` chunk, then `data` up to the last byte. */
export function sniffSound(bytes: Uint8Array): SoundInfo | undefined {
  if (bytes.length < SOUND_HEADER_BYTES + 2 || bytes.length > SOUND_MAX_BYTES) return undefined;
  if (ascii(bytes, 0, 4) !== "RIFF" || u32le(bytes, 4) !== bytes.length - 8 || ascii(bytes, 8, 4) !== "WAVE") return undefined;
  if (ascii(bytes, 12, 4) !== "fmt " || u32le(bytes, 16) !== 16) return undefined;
  const format = u16le(bytes, 20);
  const channels = u16le(bytes, 22);
  const rate = u32le(bytes, 24);
  const byteRate = u32le(bytes, 28);
  const blockAlign = u16le(bytes, 32);
  const bits = u16le(bytes, 34);
  if (format !== 1 || channels !== 1 || rate !== SOUND_SAMPLE_RATE || byteRate !== SOUND_SAMPLE_RATE * 2 || blockAlign !== 2 || bits !== 16) return undefined;
  const dataSize = u32le(bytes, 40);
  if (ascii(bytes, 36, 4) !== "data" || dataSize !== bytes.length - SOUND_HEADER_BYTES || dataSize % 2 !== 0) return undefined;
  const samples = dataSize / 2;
  return { samples, durationMs: Math.ceil((samples * 1000) / SOUND_SAMPLE_RATE) };
}

/** Mono samples at 24 kHz in [-1, 1] into the canonical WAV. Longer than 20 s is refused, never cut silently. */
export function encodeSound(samples: Float32Array): Uint8Array {
  if (samples.length === 0 || samples.length > (SOUND_SAMPLE_RATE * SOUND_MAX_MS) / 1000) throw new RangeError("sound_too_long");
  const bytes = new Uint8Array(SOUND_HEADER_BYTES + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const write = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index++) bytes[offset + index] = value.charCodeAt(index);
  };
  write(0, "RIFF");
  view.setUint32(4, bytes.length - 8, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, SOUND_SAMPLE_RATE, true);
  view.setUint32(28, SOUND_SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let index = 0; index < samples.length; index++) {
    const value = Math.max(-1, Math.min(1, Number.isFinite(samples[index]) ? samples[index]! : 0));
    view.setInt16(SOUND_HEADER_BYTES + index * 2, Math.round(value * 0x7fff), true);
  }
  return bytes;
}

/** One entry of a server library, as the API lists it. */
export interface SoundSummary {
  id: string;
  name: string;
  durationMs: number;
  /** The caller uploaded it: rename, delete and import are theirs. */
  mine: boolean;
  /** The caller may take it out of this server (owner of the sound, server owner or moderator). */
  canRemove: boolean;
}

/** One of the caller's own sounds, with the servers whose library has it. */
export interface OwnSound {
  id: string;
  name: string;
  durationMs: number;
  serverIds: string[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function soundBase(value: unknown): { id: string; name: string; durationMs: number; row: Record<string, unknown> } | undefined {
  const row = record(value);
  if (!row) return undefined;
  const { id, name, durationMs } = row;
  if (typeof id !== "string" || !UUID.test(id)) return undefined;
  if (typeof name !== "string" || name.length === 0 || name.length > SOUND_NAME_MAX) return undefined;
  if (typeof durationMs !== "number" || !Number.isInteger(durationMs) || durationMs < 1 || durationMs > SOUND_MAX_MS) return undefined;
  return { id: id.toLowerCase(), name, durationMs, row };
}

/** Bad entries are dropped instead of failing the whole panel. */
export function parseSoundLibrary(value: unknown): SoundSummary[] {
  const list = record(value)?.sounds;
  if (!Array.isArray(list)) return [];
  return list.flatMap((item) => {
    const base = soundBase(item);
    if (!base) return [];
    return [{ id: base.id, name: base.name, durationMs: base.durationMs, mine: base.row.mine === true, canRemove: base.row.canRemove === true }];
  });
}

export function parseOwnSounds(value: unknown): OwnSound[] {
  const list = record(value)?.sounds;
  if (!Array.isArray(list)) return [];
  return list.flatMap((item) => {
    const base = soundBase(item);
    if (!base) return [];
    const servers = Array.isArray(base.row.serverIds) ? base.row.serverIds : [];
    const serverIds = servers.filter((id): id is string => typeof id === "string" && UUID.test(id)).map((id) => id.toLowerCase());
    return [{ id: base.id, name: base.name, durationMs: base.durationMs, serverIds }];
  });
}
