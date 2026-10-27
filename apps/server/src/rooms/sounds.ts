import { createHash } from "node:crypto";
import { SOUND_NAME_MAX, parseLabel, sniffSound } from "@openmeet/shared";
import type { MigrationClient } from "../db/migrate.js";
import type { PublicUser } from "../auth/service.js";
import { RoomError, audit, canManage, loadServerAccess, requireMember, serverId, text } from "./service.js";

// ADR 0021: server sound libraries. A sound belongs to its uploader; each library lists the sounds it holds.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface LibrarySound {
  id: string;
  name: string;
  durationMs: number;
  mine: boolean;
  canRemove: boolean;
}

export interface OwnSoundRow {
  id: string;
  name: string;
  durationMs: number;
  serverIds: string[];
}

function soundId(value: string): string {
  if (!UUID.test(value)) throw new RoomError("sound_not_found");
  return value.toLowerCase();
}

function soundName(value: unknown): string {
  const name = typeof value === "string" ? parseLabel(value) : undefined;
  if (name === undefined || name.length > SOUND_NAME_MAX) throw new RoomError("invalid_display_name");
  return name;
}

function duration(value: unknown): number {
  return typeof value === "number" ? value : Number(value);
}

export async function listLibrary(db: MigrationClient, actor: PublicUser, id: string): Promise<{ sounds: LibrarySound[] }> {
  const access = await loadServerAccess(db, actor, serverId(id));
  requireMember(access);
  const manager = canManage(access.membership);
  const found = await db.query(
    `select s.id, s.name, s.duration_ms, s.owner_id = $2 as mine from server_sounds ss join sounds s on s.id = ss.sound_id
     where ss.server_id = $1 order by lower(s.name), ss.added_at`,
    [access.server.id, actor.id],
  );
  return {
    sounds: found.rows.flatMap((row) => {
      const soundIdValue = text(row.id);
      const name = text(row.name);
      if (!soundIdValue || !name) return [];
      const mine = row.mine === true;
      return [{ id: soundIdValue, name, durationMs: duration(row.duration_ms), mine, canRemove: mine || manager }];
    }),
  };
}

/** The sound enters only the library of the server it was sent to. */
export async function uploadSound(db: MigrationClient, actor: PublicUser, id: string, input: { name: unknown; bytes: Uint8Array }): Promise<LibrarySound> {
  const access = await loadServerAccess(db, actor, serverId(id));
  requireMember(access);
  const name = soundName(input.name);
  const info = sniffSound(input.bytes);
  if (!info) throw new RoomError("invalid_sound");
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  return db.transaction(async (tx) => {
    const inserted = await tx.query("insert into sounds (owner_id, name, bytes, byte_size, duration_ms, sha256) values ($1, $2, $3, $4, $5, $6) returning id", [
      actor.id,
      name,
      Buffer.from(input.bytes),
      input.bytes.length,
      info.durationMs,
      sha256,
    ]);
    const created = text(inserted.rows[0]?.id);
    if (!created) throw new RoomError("conflict");
    await tx.query("insert into server_sounds (server_id, sound_id, added_by) values ($1, $2, $3)", [access.server.id, created, actor.id]);
    await audit(tx, actor.id, "sound_upload", "server", access.server.id);
    return { id: created, name, durationMs: info.durationMs, mine: true, canRemove: true };
  });
}

// Readable by its owner and by any active member of a server whose library holds it. Anything else is 404.
export async function readSound(db: MigrationClient, actor: PublicUser, id: string): Promise<Uint8Array> {
  const found = await db.query(
    `select s.bytes from sounds s where s.id = $1 and (
       s.owner_id = $2
       or exists (select 1 from server_sounds ss join server_members me on me.server_id = ss.server_id and me.user_id = $2 and me.removed_at is null
                  where ss.sound_id = s.id)
     )`,
    [soundId(id), actor.id],
  );
  const bytes = found.rows[0]?.bytes;
  if (!(bytes instanceof Uint8Array)) throw new RoomError("sound_not_found");
  return bytes;
}

async function ownedSound(db: MigrationClient, actor: PublicUser, id: string): Promise<{ id: string; ownerId: string }> {
  const found = await db.query("select id, owner_id from sounds where id = $1", [soundId(id)]);
  const foundId = text(found.rows[0]?.id);
  const ownerId = text(found.rows[0]?.owner_id);
  if (!foundId || !ownerId) throw new RoomError("sound_not_found");
  if (ownerId !== actor.id) {
    // Someone else's sound the caller can hear is refused; one they cannot see does not exist for them.
    await readSound(db, actor, foundId);
    throw new RoomError("forbidden");
  }
  return { id: foundId, ownerId };
}

/** Only the owner brings a sound to another server, and only to one they belong to. Importing twice is a no-op. */
export async function importSound(db: MigrationClient, actor: PublicUser, id: string, sound: string): Promise<LibrarySound> {
  const access = await loadServerAccess(db, actor, serverId(id));
  requireMember(access);
  const owned = await ownedSound(db, actor, sound);
  await db.transaction(async (tx) => {
    await tx.query("insert into server_sounds (server_id, sound_id, added_by) values ($1, $2, $3) on conflict do nothing", [
      access.server.id,
      owned.id,
      actor.id,
    ]);
    await audit(tx, actor.id, "sound_import", "server", access.server.id);
  });
  const listed = (await listLibrary(db, actor, access.server.id)).sounds.find((item) => item.id === owned.id);
  if (!listed) throw new RoomError("conflict");
  return listed;
}

/** Takes a sound out of one library: its owner, or the server owner and moderators. The sound itself stays. */
export async function removeFromLibrary(db: MigrationClient, actor: PublicUser, id: string, sound: string): Promise<{ removed: true }> {
  const access = await loadServerAccess(db, actor, serverId(id));
  requireMember(access);
  const found = await db.query("select s.owner_id from server_sounds ss join sounds s on s.id = ss.sound_id where ss.server_id = $1 and ss.sound_id = $2", [
    access.server.id,
    soundId(sound),
  ]);
  const ownerId = text(found.rows[0]?.owner_id);
  if (!ownerId) throw new RoomError("sound_not_found");
  if (ownerId !== actor.id && !canManage(access.membership)) throw new RoomError("forbidden");
  await db.transaction(async (tx) => {
    await tx.query("delete from server_sounds where server_id = $1 and sound_id = $2", [access.server.id, soundId(sound)]);
    await audit(tx, actor.id, "sound_remove", "server", access.server.id);
  });
  return { removed: true };
}

/** The caller's own sounds, with the libraries they are in among the servers the caller still belongs to. */
export async function listOwnSounds(db: MigrationClient, actor: PublicUser): Promise<{ sounds: OwnSoundRow[] }> {
  const found = await db.query(
    `select s.id, s.name, s.duration_ms,
       coalesce(array_agg(ss.server_id::text order by ss.server_id) filter (where me.user_id is not null), '{}') as server_ids
     from sounds s
     left join server_sounds ss on ss.sound_id = s.id
     left join server_members me on me.server_id = ss.server_id and me.user_id = $1 and me.removed_at is null
     where s.owner_id = $1
     group by s.id order by lower(s.name), s.created_at`,
    [actor.id],
  );
  return {
    sounds: found.rows.flatMap((row) => {
      const id = text(row.id);
      const name = text(row.name);
      if (!id || !name) return [];
      const servers = Array.isArray(row.server_ids) ? row.server_ids.filter((value): value is string => typeof value === "string") : [];
      return [{ id, name, durationMs: duration(row.duration_ms), serverIds: servers }];
    }),
  };
}

export async function renameSound(db: MigrationClient, actor: PublicUser, id: string, name: unknown): Promise<{ id: string; name: string }> {
  const owned = await ownedSound(db, actor, id);
  const next = soundName(name);
  await db.query("update sounds set name = $2 where id = $1", [owned.id, next]);
  return { id: owned.id, name: next };
}

/** Deletes the sound everywhere: every library loses it at once. */
export async function deleteSound(db: MigrationClient, actor: PublicUser, id: string): Promise<{ deleted: true }> {
  const owned = await ownedSound(db, actor, id);
  await db.transaction(async (tx) => {
    await tx.query("delete from sounds where id = $1", [owned.id]);
    await audit(tx, actor.id, "sound_delete", "sound", owned.id);
  });
  return { deleted: true };
}
