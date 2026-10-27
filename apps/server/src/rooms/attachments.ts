import { createHash } from "node:crypto";
import { ATTACHMENTS_PER_MESSAGE, ATTACHMENT_DEFAULT_MAX_BYTES, sniffAttachmentImage } from "@openmeet/shared";
import { AuthError, type PublicUser } from "../auth/service.js";
import type { MigrationClient } from "../db/migrate.js";
import type { AppEnv } from "../poc-join.js";
import { RoomError, text } from "./service.js";

// ADR 0024: files of text room messages. A file is uploaded first and stays an orphan (message_id null)
// until a message claims it; orphans go after 24 h. The type comes from the bytes only: a picture the
// signatures recognise keeps its image type, everything else is application/octet-stream, and every
// answer is a download with nosniff, so neither SVG nor HTML ever runs in the app or the browser.

/** Hard stop of the table check; ATTACHMENT_MAX_BYTES can lower the limit, never raise it past this. */
export const ATTACHMENT_HARD_MAX_BYTES = 25 * 1024 * 1024;
const ORPHAN_HOURS = 24;
/** Uploaded and not yet sent, per person: enough for a full message being retried, not a storage bin. */
const PENDING_PER_USER = 30;
/** ADR 0024: 20 MB of uploads per minute per person. */
const UPLOAD_BYTES_PER_MINUTE = 20 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FALLBACK_TYPE = "application/octet-stream";

export interface AttachmentView {
  id: string;
  name: string;
  contentType: string;
  size: number;
  width: number | null;
  height: number | null;
}

export function attachmentMaxBytes(env: AppEnv): number {
  const raw = env.ATTACHMENT_MAX_BYTES;
  if (raw === undefined || raw.trim() === "") return ATTACHMENT_DEFAULT_MAX_BYTES;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > ATTACHMENT_HARD_MAX_BYTES) throw new Error("ATTACHMENT_MAX_BYTES must be an integer from 1 to 26214400");
  return value;
}

/** Bytes per person in a sliding minute. A refused upload does not count. */
export function createUploadBudget(limit = UPLOAD_BYTES_PER_MINUTE, windowMs = 60_000): { allow(user: string, bytes: number, now: number): boolean } {
  const spent = new Map<string, { at: number; bytes: number }[]>();
  return {
    allow(user, bytes, now) {
      for (const [key, list] of spent) {
        if (list.every((entry) => now - entry.at >= windowMs)) spent.delete(key);
      }
      const recent = (spent.get(user) ?? []).filter((entry) => now - entry.at < windowMs);
      const total = recent.reduce((sum, entry) => sum + entry.bytes, 0);
      if (total + bytes > limit) {
        spent.set(user, recent);
        return false;
      }
      recent.push({ at: now, bytes });
      spent.set(user, recent);
      return true;
    },
  };
}

/** What the file was called on the sender's disk. Never a path, never hidden characters, never cleaned in silence. */
export function parseAttachmentName(value: unknown): string {
  if (typeof value !== "string") throw new RoomError("invalid_attachment");
  const name = value.normalize("NFC").trim();
  const length = [...name].length;
  if (length === 0 || length > 255 || name === "." || name === ".." || /[\\/]/.test(name)) throw new RoomError("invalid_attachment");
  for (const char of name) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 32 || code === 127 || (code >= 0x80 && code < 0xa0) || (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069)) {
      throw new RoomError("invalid_attachment");
    }
  }
  return name;
}

/** Up to 10 distinct ids; absent means none. */
export function parseAttachmentIds(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > ATTACHMENTS_PER_MESSAGE) throw new RoomError("invalid_attachment");
  const ids = value.map((item: unknown) => {
    if (typeof item !== "string" || !UUID.test(item)) throw new RoomError("invalid_attachment");
    return item.toLowerCase();
  });
  if (new Set(ids).size !== ids.length) throw new RoomError("invalid_attachment");
  return ids;
}

function view(row: Record<string, unknown>): AttachmentView {
  return {
    id: text(row.id) ?? "",
    name: text(row.name) ?? "",
    contentType: text(row.content_type) ?? FALLBACK_TYPE,
    size: Number(row.byte_size),
    width: row.width === null || row.width === undefined ? null : Number(row.width),
    height: row.height === null || row.height === undefined ? null : Number(row.height),
  };
}

/** The attachments column of a message row, in upload order. */
export function readAttachments(value: unknown): AttachmentView[] {
  const list: unknown = typeof value === "string" ? JSON.parse(value) : value;
  if (!Array.isArray(list)) return [];
  return list.flatMap((item: unknown) => (typeof item === "object" && item !== null ? [view(item as Record<string, unknown>)] : []));
}

export const ATTACHMENTS_SELECT = `coalesce((
  select json_agg(json_build_object('id', a.id, 'name', a.name, 'content_type', a.content_type, 'byte_size', a.byte_size, 'width', a.width, 'height', a.height)
                  order by a.created_at, a.id)
  from message_attachments a where a.message_id = m.id
), '[]'::json)`;

/**
 * Stores one file for the caller. The route has already checked a text room or DM the caller may write in;
 * the file is not tied to it, only to the uploader, who is the only one able to send it.
 */
export async function storeAttachment(
  db: MigrationClient,
  actor: PublicUser,
  input: { name: unknown; bytes: Uint8Array; maxBytes: number },
): Promise<AttachmentView> {
  const name = parseAttachmentName(input.name);
  if (input.bytes.length > input.maxBytes) throw new RoomError("attachment_too_large");
  if (input.bytes.length === 0) throw new RoomError("invalid_attachment");
  const pending = await db.query(
    `select count(*)::int as total from message_attachments where uploader_id = $1 and message_id is null and created_at > now() - interval '${ORPHAN_HOURS} hours'`,
    [actor.id],
  );
  if (Number(pending.rows[0]?.total ?? 0) >= PENDING_PER_USER) throw new AuthError("rate_limited");
  const image = sniffAttachmentImage(input.bytes);
  const inserted = await db.query(
    `insert into message_attachments (uploader_id, name, content_type, bytes, byte_size, width, height, sha256)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     returning id, name, content_type, byte_size, width, height`,
    [
      actor.id,
      name,
      image?.type ?? FALLBACK_TYPE,
      input.bytes,
      input.bytes.length,
      image?.width ?? null,
      image?.height ?? null,
      createHash("sha256").update(input.bytes).digest("hex"),
    ],
  );
  const row = inserted.rows[0];
  if (!row) throw new RoomError("conflict");
  return view(row);
}

/** Inside the message's transaction: every id must be the caller's own unsent, unexpired upload. */
export async function claimAttachments(tx: MigrationClient, actor: PublicUser, messageId: string, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  const claimed = await tx.query(
    `update message_attachments set message_id = $1::bigint
     where id = any($2::uuid[]) and uploader_id = $3 and message_id is null and created_at > now() - interval '${ORPHAN_HOURS} hours'
     returning id`,
    [messageId, ids, actor.id],
  );
  if (claimed.rows.length !== ids.length) throw new RoomError("invalid_attachment");
}

/**
 * The bytes of a sent file, for whoever can read its message (`canRead` throws otherwise, room or DM).
 * A removed message, an orphan, a chat the caller left and an id that never existed all look the same.
 */
export async function readAttachment(
  db: MigrationClient,
  id: string,
  canRead: (messageId: string) => Promise<void>,
): Promise<{ view: AttachmentView; bytes: Uint8Array }> {
  if (!UUID.test(id)) throw new RoomError("attachment_not_found");
  const found = await db.query(
    `select a.id, a.name, a.content_type, a.byte_size, a.width, a.height, a.bytes, m.id::text as message_id
     from message_attachments a join messages m on m.id = a.message_id
     where a.id = $1 and m.deleted_at is null`,
    [id],
  );
  const row = found.rows[0];
  const message = text(row?.message_id);
  if (!row || !message) throw new RoomError("attachment_not_found");
  try {
    await canRead(message);
  } catch (error) {
    if (error instanceof RoomError) throw new RoomError("attachment_not_found");
    throw error;
  }
  const bytes = row.bytes instanceof Uint8Array ? row.bytes : new Uint8Array(0);
  return { view: view(row), bytes };
}

/** Uploads never sent within 24 h. Returns how many went. */
export async function purgeOrphanAttachments(db: MigrationClient): Promise<number> {
  const removed = await db.query(
    `delete from message_attachments where message_id is null and created_at <= now() - interval '${ORPHAN_HOURS} hours' returning id`,
  );
  return removed.rows.length;
}

/** `attachment` always, with an ASCII fallback and the real name in RFC 5987 form. */
export function contentDisposition(name: string): string {
  const fallback = name.replace(/[^\x20-\x7e]|["\\%;]/g, "_");
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
