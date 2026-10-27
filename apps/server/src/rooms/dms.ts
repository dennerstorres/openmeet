import { parseLabel } from "@openmeet/shared";
import type { MigrationClient } from "../db/migrate.js";
import type { PublicUser } from "../auth/service.js";
import { RoomError, text } from "./service.js";

// ADR 0024: direct messages. A direct DM is one per pair (direct_key), a group holds up to 10 people. Only the
// active dm_members read it: server owners, moderators and the instance admin never do. A block between the two
// people of a direct DM leaves it read only and keeps the blocked one from opening or adding the other anywhere.

export const DM_GROUP_MAX = 10;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface DmView {
  id: string;
  kind: "direct" | "group";
  name: string | null;
  createdBy: string;
  memberIds: string[];
  /** A direct DM with a block either way: the history stays, nobody writes. */
  readOnly: boolean;
  createdAt: string;
}

export interface DmRecord {
  id: string;
  kind: "direct" | "group";
  createdBy: string;
  readOnly: boolean;
}

function dmId(value: string): string {
  if (!UUID.test(value)) throw new RoomError("dm_not_found");
  return value;
}

function userId(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new RoomError("invalid_body");
  return value;
}

/** A group name is a label up to 80 characters; null or empty clears it. */
function groupName(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new RoomError("invalid_body");
  const name = parseLabel(value);
  if (name === undefined) throw new RoomError("invalid_body");
  return name;
}

export async function blockedBetween(db: MigrationClient, first: string, second: string): Promise<boolean> {
  const found = await db.query("select 1 from user_blocks where (user_id = $1 and blocked_id = $2) or (user_id = $2 and blocked_id = $1) limit 1", [
    first,
    second,
  ]);
  return found.rows[0] !== undefined;
}

// Someone you may open a DM with: an active account in at least one live server you are both active members of.
// Anyone else is "not found", so the API does not tell who exists on the instance.
async function requireReachable(db: MigrationClient, actor: PublicUser, other: string): Promise<void> {
  const found = await db.query(
    `select 1
     from users u
     join server_members theirs on theirs.user_id = u.id and theirs.removed_at is null
     join servers s on s.id = theirs.server_id and s.deleted_at is null
     join server_members mine on mine.server_id = s.id and mine.user_id = $2 and mine.removed_at is null
     where u.id = $1 and u.disabled_at is null
     limit 1`,
    [other, actor.id],
  );
  if (found.rows[0] === undefined) throw new RoomError("user_not_found");
  if (await blockedBetween(db, actor.id, other)) throw new RoomError("blocked");
}

/** The DM as its active member sees it; anyone else, or a member who left, gets "not found". */
export async function loadDm(db: MigrationClient, actor: PublicUser, id: string): Promise<DmRecord> {
  const found = await db.query(
    `select c.id, c.kind, c.created_by,
            c.kind = 'direct' and exists (
              select 1 from dm_members o
              join user_blocks b on (b.user_id = $2 and b.blocked_id = o.user_id) or (b.user_id = o.user_id and b.blocked_id = $2)
              where o.dm_id = c.id and o.user_id <> $2
            ) as read_only
     from dm_channels c
     join dm_members m on m.dm_id = c.id and m.user_id = $2 and m.left_at is null
     where c.id = $1`,
    [dmId(id), actor.id],
  );
  const row = found.rows[0];
  if (!row) throw new RoomError("dm_not_found");
  return { id: text(row.id) ?? id, kind: row.kind === "group" ? "group" : "direct", createdBy: text(row.created_by) ?? "", readOnly: row.read_only === true };
}

const VIEW = `
  select c.id, c.kind, c.name, c.created_by, c.created_at,
         array(select user_id::text from dm_members where dm_id = c.id and left_at is null order by joined_at, user_id) as members,
         c.kind = 'direct' and exists (
           select 1 from dm_members x join dm_members y on y.dm_id = x.dm_id and y.user_id <> x.user_id
           join user_blocks b on b.user_id = x.user_id and b.blocked_id = y.user_id
           where x.dm_id = c.id
         ) as read_only,
         (select max(id) from messages where dm_id = c.id) as last_message
  from dm_channels c`;

function readView(row: Record<string, unknown>): DmView {
  const members: unknown = row.members;
  return {
    id: text(row.id) ?? "",
    kind: row.kind === "group" ? "group" : "direct",
    name: text(row.name) ?? null,
    createdBy: text(row.created_by) ?? "",
    memberIds: Array.isArray(members) ? members.filter((member): member is string => typeof member === "string") : [],
    readOnly: row.read_only === true,
    createdAt: new Date(String(row.created_at)).toISOString(),
  };
}

async function readDm(db: MigrationClient, id: string): Promise<DmView> {
  const found = await db.query(`${VIEW} where c.id = $1`, [id]);
  const row = found.rows[0];
  if (!row) throw new RoomError("dm_not_found");
  return readView(row);
}

export async function getDm(db: MigrationClient, actor: PublicUser, id: string): Promise<DmView> {
  return readDm(db, (await loadDm(db, actor, id)).id);
}

/** The caller's DMs, the most recently active first. */
export async function listDms(db: MigrationClient, actor: PublicUser): Promise<DmView[]> {
  const found = await db.query(
    `${VIEW}
     join dm_members me on me.dm_id = c.id and me.user_id = $1 and me.left_at is null
     order by coalesce((select max(id) from messages where dm_id = c.id), 0) desc, c.created_at desc
     limit 200`,
    [actor.id],
  );
  return found.rows.map(readView);
}

/**
 * One other person opens (or returns) the direct DM with them; two to nine others make a new group. `created` is
 * false when the direct DM already existed, so the API answers 200 instead of 201.
 */
export async function openDm(db: MigrationClient, actor: PublicUser, input: { userIds: unknown; name: unknown }): Promise<{ dm: DmView; created: boolean }> {
  if (!Array.isArray(input.userIds) || input.userIds.length === 0) throw new RoomError("invalid_body");
  const others = [...new Set(input.userIds.map(userId))];
  if (others.includes(actor.id)) throw new RoomError("invalid_body");
  if (others.length > DM_GROUP_MAX - 1) throw new RoomError("dm_full");
  const direct = others.length === 1 && (input.name === undefined || input.name === null);
  const name = direct ? null : groupName(input.name);
  if (direct) {
    const other = others[0] ?? "";
    const key = [actor.id, other].sort().join(":");
    const existing = await db.query("select id from dm_channels where direct_key = $1", [key]);
    const known = text(existing.rows[0]?.id);
    if (known) return { dm: await readDm(db, known), created: false };
    await requireReachable(db, actor, other);
    const id = await db.transaction(async (tx) => {
      const inserted = await tx.query(
        "insert into dm_channels (kind, direct_key, created_by) values ('direct', $1, $2) on conflict (direct_key) do nothing returning id",
        [key, actor.id],
      );
      const fresh = text(inserted.rows[0]?.id);
      if (!fresh) return undefined;
      await tx.query("insert into dm_members (dm_id, user_id) values ($1, $2), ($1, $3)", [fresh, actor.id, other]);
      return fresh;
    });
    if (id) return { dm: await readDm(db, id), created: true };
    // Both opened it at the same moment: the other request won.
    const raced = text((await db.query("select id from dm_channels where direct_key = $1", [key])).rows[0]?.id);
    if (!raced) throw new RoomError("conflict");
    return { dm: await readDm(db, raced), created: false };
  }
  for (const other of others) await requireReachable(db, actor, other);
  const id = await db.transaction(async (tx) => {
    const inserted = await tx.query("insert into dm_channels (kind, name, created_by) values ('group', $1, $2) returning id", [name, actor.id]);
    const fresh = text(inserted.rows[0]?.id);
    if (!fresh) throw new RoomError("conflict");
    for (const member of [actor.id, ...others]) await tx.query("insert into dm_members (dm_id, user_id) values ($1, $2)", [fresh, member]);
    return fresh;
  });
  return { dm: await readDm(db, id), created: true };
}

async function group(db: MigrationClient, actor: PublicUser, id: string): Promise<DmRecord> {
  const dm = await loadDm(db, actor, id);
  if (dm.kind !== "group") throw new RoomError("conflict");
  return dm;
}

/** The creator adds someone they could open a DM with; someone who left comes back. Idempotent. */
export async function addDmMember(db: MigrationClient, actor: PublicUser, id: string, input: { userId: unknown }): Promise<DmView> {
  const other = userId(input.userId);
  const dm = await group(db, actor, id);
  if (dm.createdBy !== actor.id) throw new RoomError("forbidden");
  await requireReachable(db, actor, other);
  await db.transaction(async (tx) => {
    // The lock keeps two additions from both taking the 10th place.
    await tx.query("select 1 from dm_channels where id = $1 for update", [dm.id]);
    const members = await tx.query("select user_id from dm_members where dm_id = $1 and left_at is null", [dm.id]);
    const active = members.rows.map((row) => text(row.user_id));
    if (active.includes(other)) return;
    if (active.length >= DM_GROUP_MAX) throw new RoomError("dm_full");
    await tx.query(
      `insert into dm_members (dm_id, user_id) values ($1, $2)
       on conflict (dm_id, user_id) do update set left_at = null, joined_at = now()`,
      [dm.id, other],
    );
  });
  return readDm(db, dm.id);
}

/** Anyone leaves a group; when the creator leaves, the longest-standing member takes over adding and renaming. */
export async function leaveDm(db: MigrationClient, actor: PublicUser, id: string): Promise<DmView> {
  const dm = await group(db, actor, id);
  await db.transaction(async (tx) => {
    await tx.query("update dm_members set left_at = now() where dm_id = $1 and user_id = $2 and left_at is null", [dm.id, actor.id]);
    await tx.query(
      `update dm_channels set created_by = coalesce(
         (select user_id from dm_members where dm_id = $1 and left_at is null order by joined_at, user_id limit 1), created_by)
       where id = $1 and created_by = $2`,
      [dm.id, actor.id],
    );
  });
  return readDm(db, dm.id);
}

export async function renameDm(db: MigrationClient, actor: PublicUser, id: string, input: { name: unknown }): Promise<DmView> {
  const name = groupName(input.name);
  const dm = await group(db, actor, id);
  if (dm.createdBy !== actor.id) throw new RoomError("forbidden");
  await db.query("update dm_channels set name = $2 where id = $1", [dm.id, name]);
  return readDm(db, dm.id);
}

/** Who the caller blocked. Who blocked the caller is never listed. */
export async function listBlocks(db: MigrationClient, actor: PublicUser): Promise<string[]> {
  const found = await db.query("select blocked_id::text as id from user_blocks where user_id = $1 order by created_at, blocked_id", [actor.id]);
  return found.rows.map((row) => text(row.id)).filter((id): id is string => id !== undefined);
}

/** Blocks or unblocks one account; answers the direct DM with them, if any, so its members can be told. */
export async function setBlock(db: MigrationClient, actor: PublicUser, id: string, blocked: boolean): Promise<DmView | undefined> {
  if (!UUID.test(id)) throw new RoomError("user_not_found");
  if (id === actor.id) throw new RoomError("invalid_body");
  const exists = await db.query("select 1 from users where id = $1", [id]);
  if (exists.rows[0] === undefined) throw new RoomError("user_not_found");
  if (blocked) {
    await db.query("insert into user_blocks (user_id, blocked_id) values ($1, $2) on conflict do nothing", [actor.id, id]);
  } else {
    await db.query("delete from user_blocks where user_id = $1 and blocked_id = $2", [actor.id, id]);
  }
  const direct = await db.query("select id from dm_channels where direct_key = $1", [[actor.id, id].sort().join(":")]);
  const dm = text(direct.rows[0]?.id);
  return dm ? readDm(db, dm) : undefined;
}
