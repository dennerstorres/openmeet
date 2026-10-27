import { createHash } from "node:crypto";
import { EMOJIS_PER_KIND, EMOJI_NAME, sniffEmoji } from "@openmeet/shared";
import type { MigrationClient } from "../db/migrate.js";
import type { PublicUser } from "../auth/service.js";
import { RoomError, audit, canManage, loadServerAccess, requireMember, serverId, text } from "./service.js";

// ADR 0024: each server's own emojis. The owner and moderators send, rename and remove them; members use them in
// the server's text rooms, and in DMs when the author belongs to the server. A removed emoji keeps its row with
// deleted_at, so the text that named it can still read `:name:`.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface EmojiView {
  id: string;
  serverId: string;
  name: string;
  animated: boolean;
}

export function emojiId(value: string): string {
  if (!UUID.test(value)) throw new RoomError("emoji_not_found");
  return value.toLowerCase();
}

function emojiName(value: unknown): string {
  if (typeof value !== "string" || !EMOJI_NAME.test(value)) throw new RoomError("invalid_emoji_name");
  return value;
}

function readView(row: Record<string, unknown>): EmojiView | undefined {
  const id = text(row.id);
  const server = text(row.server_id);
  const name = text(row.name);
  if (!id || !server || !name) return undefined;
  return { id, serverId: server, name, animated: row.animated === true };
}

const COLUMNS = "id::text as id, server_id::text as server_id, name, animated";

export async function listServerEmojis(db: MigrationClient, actor: PublicUser, id: string): Promise<{ emojis: EmojiView[]; canManage: boolean }> {
  const access = await loadServerAccess(db, actor, serverId(id));
  requireMember(access);
  const found = await db.query(`select ${COLUMNS} from server_emojis where server_id = $1 and deleted_at is null order by lower(name)`, [access.server.id]);
  return { emojis: found.rows.flatMap((row) => readView(row) ?? []), canManage: canManage(access.membership) };
}

/** Every emoji the caller may use: those of each server they still belong to. The picker groups them by server. */
export async function listMyEmojis(db: MigrationClient, actor: PublicUser): Promise<{ emojis: EmojiView[] }> {
  const found = await db.query(
    `select e.id::text as id, e.server_id::text as server_id, e.name, e.animated
     from server_emojis e
     join servers s on s.id = e.server_id and s.deleted_at is null
     join server_members m on m.server_id = e.server_id and m.user_id = $1 and m.removed_at is null
     where e.deleted_at is null
     order by e.server_id, lower(e.name)`,
    [actor.id],
  );
  return { emojis: found.rows.flatMap((row) => readView(row) ?? []) };
}

export async function uploadEmoji(db: MigrationClient, actor: PublicUser, id: string, input: { name: unknown; bytes: Uint8Array }): Promise<EmojiView> {
  const access = await loadServerAccess(db, actor, serverId(id));
  requireMember(access);
  if (!canManage(access.membership)) throw new RoomError("forbidden");
  const name = emojiName(input.name);
  if (input.bytes.length > 256 * 1024) throw new RoomError("emoji_too_large");
  const info = sniffEmoji(input.bytes);
  if (!info) throw new RoomError("invalid_emoji");
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  return db.transaction(async (tx) => {
    // The server row lock keeps two uploads from both taking the 50th place or the same name.
    await tx.query("select 1 from servers where id = $1 for update", [access.server.id]);
    const held = await tx.query(
      `select count(*) filter (where animated = $2)::int as kind, bool_or(lower(name) = lower($3)) as taken
       from server_emojis where server_id = $1 and deleted_at is null`,
      [access.server.id, info.animated, name],
    );
    if (held.rows[0]?.taken === true) throw new RoomError("emoji_name_taken");
    if (Number(held.rows[0]?.kind ?? 0) >= EMOJIS_PER_KIND) throw new RoomError("emoji_limit");
    const inserted = await tx.query(
      `insert into server_emojis (server_id, name, content_type, animated, bytes, byte_size, sha256, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8) returning ${COLUMNS}`,
      [access.server.id, name, info.type, info.animated, Buffer.from(input.bytes), input.bytes.length, sha256, actor.id],
    );
    const view = inserted.rows[0] ? readView(inserted.rows[0]) : undefined;
    if (!view) throw new RoomError("conflict");
    await audit(tx, actor.id, "emoji_upload", "server", access.server.id);
    return view;
  });
}

// A removed emoji, or one of a server the caller is not in, is simply not found.
async function managedEmoji(db: MigrationClient, actor: PublicUser, id: string): Promise<EmojiView> {
  const found = await db.query(`select ${COLUMNS} from server_emojis where id = $1 and deleted_at is null`, [emojiId(id)]);
  const view = found.rows[0] ? readView(found.rows[0]) : undefined;
  if (!view) throw new RoomError("emoji_not_found");
  let access;
  try {
    access = await loadServerAccess(db, actor, view.serverId);
    requireMember(access);
  } catch (error) {
    if (error instanceof RoomError) throw new RoomError("emoji_not_found");
    throw error;
  }
  if (!canManage(access.membership)) throw new RoomError("forbidden");
  return view;
}

export async function renameEmoji(db: MigrationClient, actor: PublicUser, id: string, name: unknown): Promise<EmojiView> {
  const emoji = await managedEmoji(db, actor, id);
  const next = emojiName(name);
  return db.transaction(async (tx) => {
    await tx.query("select 1 from servers where id = $1 for update", [emoji.serverId]);
    const taken = await tx.query("select 1 from server_emojis where server_id = $1 and deleted_at is null and lower(name) = lower($2) and id <> $3", [
      emoji.serverId,
      next,
      emoji.id,
    ]);
    if (taken.rows[0]) throw new RoomError("emoji_name_taken");
    await tx.query("update server_emojis set name = $2 where id = $1", [emoji.id, next]);
    await audit(tx, actor.id, "emoji_rename", "server", emoji.serverId);
    return { ...emoji, name: next };
  });
}

/** The bytes go with the removal; the name stays so old messages read `:name:`. */
export async function deleteEmoji(db: MigrationClient, actor: PublicUser, id: string): Promise<EmojiView> {
  const emoji = await managedEmoji(db, actor, id);
  await db.transaction(async (tx) => {
    await tx.query("update server_emojis set deleted_at = now() where id = $1 and deleted_at is null", [emoji.id]);
    await audit(tx, actor.id, "emoji_delete", "server", emoji.serverId);
  });
  return emoji;
}

/**
 * ADR 0024: whoever may see a message with the emoji may load it, so members of its server and the people who share
 * a DM with one of them. A removed emoji is gone for everyone.
 */
export async function readEmoji(db: MigrationClient, actor: PublicUser, id: string): Promise<{ bytes: Uint8Array; contentType: string }> {
  const found = await db.query(
    `select e.bytes, e.content_type from server_emojis e
     where e.id = $1 and e.deleted_at is null and (
       exists (select 1 from server_members m where m.server_id = e.server_id and m.user_id = $2 and m.removed_at is null)
       or exists (
         select 1 from dm_members me
         join dm_members other on other.dm_id = me.dm_id
         join server_members m on m.user_id = other.user_id and m.server_id = e.server_id and m.removed_at is null
         where me.user_id = $2 and me.left_at is null
       )
     )`,
    [emojiId(id), actor.id],
  );
  const bytes = found.rows[0]?.bytes;
  const contentType = text(found.rows[0]?.content_type);
  if (!(bytes instanceof Uint8Array) || !contentType) throw new RoomError("emoji_not_found");
  return { bytes, contentType };
}

/** A `custom:<id>` reaction is allowed with an emoji of the room's server, or in a DM with one of a server the caller is in. */
export async function requireUsableEmoji(db: MigrationClient, actor: PublicUser, id: string, roomServerId: string | null): Promise<void> {
  const found = await db.query(
    `select 1 from server_emojis e where e.id = $1 and e.deleted_at is null and (
       e.server_id = $2::uuid
       or ($2::uuid is null and exists (select 1 from server_members m where m.server_id = e.server_id and m.user_id = $3 and m.removed_at is null))
     )`,
    [emojiId(id), roomServerId, actor.id],
  );
  if (!found.rows[0]) throw new RoomError("emoji_not_found");
}
