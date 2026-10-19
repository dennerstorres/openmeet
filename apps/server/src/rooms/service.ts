import { randomBytes } from "node:crypto";
import { parseSignalUrl } from "@openmeet/shared";
import { AccessToken } from "livekit-server-sdk";
import type { AppEnv } from "../poc-join.js";
import type { MigrationClient } from "../db/migrate.js";
import type { PublicUser } from "../auth/service.js";
import { hashPassword } from "../auth/password.js";
import { hashSecret } from "../auth/tokens.js";
import type { RoomMedia } from "./media.js";

export type RoomErrorCode =
  | "invalid_body"
  | "invalid_username"
  | "invalid_display_name"
  | "weak_password"
  | "forbidden"
  | "room_not_found"
  | "invalid_invite"
  | "room_ended"
  | "conflict"
  | "room_unconfigured"
  | "media_disconnect_failed";

export class RoomError extends Error {
  readonly code: RoomErrorCode;

  constructor(code: RoomErrorCode) {
    super(code);
    this.name = "RoomError";
    this.code = code;
  }
}

const USERNAME = /^[A-Za-z0-9_-]{1,64}$/;
const SLUG = /^[A-Za-z0-9_-]{1,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RoomRecord {
  id: string;
  name: string;
  slug: string;
  kind: string;
  ended: boolean;
}

interface Membership {
  role: string;
  removed: boolean;
}

function isTrue(value: unknown): boolean {
  return value === true || value === "t" || value === "true" || value === 1;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function sqlState(error: unknown): string {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : "";
}

export function roomId(value: string): string {
  if (!UUID.test(value)) throw new RoomError("room_not_found");
  return value;
}

export async function createAccount(
  db: MigrationClient,
  actor: PublicUser,
  input: { username: string; password: string; displayName: string; role: string },
): Promise<PublicUser> {
  if (actor.role !== "admin") throw new RoomError("forbidden");
  if (!USERNAME.test(input.username)) throw new RoomError("invalid_username");
  const displayName = input.displayName.trim();
  if (displayName.length < 1 || displayName.length > 80) throw new RoomError("invalid_display_name");
  if (input.password.length < 12 || input.password.length > 128) throw new RoomError("weak_password");
  if (input.role !== "moderator" && input.role !== "participant") throw new RoomError("invalid_body");
  const passwordHash = await hashPassword(input.password);
  try {
    const inserted = await db.query(
      "insert into users (username, password_hash, display_name, role) values ($1, $2, $3, $4) returning id, username, display_name, role",
      [input.username, passwordHash, displayName, input.role],
    );
    const row = inserted.rows[0];
    const id = text(row?.id);
    const username = text(row?.username);
    const name = text(row?.display_name);
    const role = text(row?.role);
    if (!id || !username || !name || !role) throw new RoomError("conflict");
    await db.query("insert into audit_events (actor_user_id, action, target_type, target_id) values ($1, 'user_create', 'user', $2)", [actor.id, id]);
    return { id, username, displayName: name, role };
  } catch (error) {
    if (error instanceof RoomError) throw error;
    if (sqlState(error) === "23505") throw new RoomError("conflict");
    throw error;
  }
}

export async function createRoom(db: MigrationClient, actor: PublicUser, input: { name: string; slug: string; kind: string }): Promise<RoomRecord> {
  if (actor.role !== "admin" && actor.role !== "moderator") throw new RoomError("forbidden");
  const name = input.name.trim();
  if (name.length < 1 || name.length > 80) throw new RoomError("invalid_body");
  if (!SLUG.test(input.slug)) throw new RoomError("invalid_body");
  if (input.kind !== "persistent" && input.kind !== "temporary") throw new RoomError("invalid_body");
  try {
    return await db.transaction(async (tx) => {
      const inserted = await tx.query("insert into rooms (name, slug, kind, created_by) values ($1, $2, $3, $4) returning id", [
        name,
        input.slug,
        input.kind,
        actor.id,
      ]);
      const id = text(inserted.rows[0]?.id);
      if (!id) throw new RoomError("conflict");
      await tx.query("insert into memberships (room_id, user_id, role) values ($1, $2, 'moderator')", [id, actor.id]);
      await tx.query("insert into audit_events (actor_user_id, action, target_type, target_id) values ($1, 'room_create', 'room', $2)", [actor.id, id]);
      return { id, name, slug: input.slug, kind: input.kind, ended: false };
    });
  } catch (error) {
    if (error instanceof RoomError) throw error;
    if (sqlState(error) === "23505") throw new RoomError("conflict");
    throw error;
  }
}

export async function listRooms(db: MigrationClient, actor: PublicUser): Promise<RoomRecord[]> {
  const listed =
    actor.role === "admin"
      ? await db.query("select id, name, slug, kind, ended_at is not null as ended from rooms order by created_at")
      : await db.query(
          `select r.id, r.name, r.slug, r.kind, r.ended_at is not null as ended
           from rooms r
           join memberships m on m.room_id = r.id and m.user_id = $1 and m.removed_at is null
           order by r.created_at`,
          [actor.id],
        );
  return listed.rows.map(readRoom).filter((room): room is RoomRecord => room !== undefined);
}

export async function getRoom(db: MigrationClient, actor: PublicUser, id: string): Promise<{ room: RoomRecord; members: PublicUser[] }> {
  const access = await loadAccess(db, actor, roomId(id));
  const members = await db.query(
    `select u.id, u.username, u.display_name, m.role
     from memberships m
     join users u on u.id = m.user_id
     where m.room_id = $1 and m.removed_at is null
     order by u.username`,
    [access.room.id],
  );
  return {
    room: access.room,
    members: members.rows.flatMap((row) => {
      const memberId = text(row.id);
      const username = text(row.username);
      const displayName = text(row.display_name);
      const role = text(row.role);
      return memberId && username && displayName && role ? [{ id: memberId, username, displayName, role }] : [];
    }),
  };
}

export async function endRoom(db: MigrationClient, actor: PublicUser, id: string, media: RoomMedia | undefined): Promise<void> {
  if (!media) throw new RoomError("room_unconfigured");
  const access = await loadAccess(db, actor, roomId(id));
  if (!canManage(actor, access.membership)) throw new RoomError("forbidden");
  const updated = await db.query("update rooms set ended_at = now(), updated_at = now() where id = $1 and ended_at is null returning id", [access.room.id]);
  if (updated.rows.length === 1) {
    await db.query("insert into audit_events (actor_user_id, action, target_type, target_id) values ($1, 'room_end', 'room', $2)", [actor.id, access.room.id]);
  }
  await disconnectMedia(() => media.closeRoom(access.room.slug));
}

export async function removeMember(db: MigrationClient, actor: PublicUser, id: string, memberId: string, media: RoomMedia | undefined): Promise<void> {
  if (!media) throw new RoomError("room_unconfigured");
  const access = await loadAccess(db, actor, roomId(id));
  if (!canManage(actor, access.membership)) throw new RoomError("forbidden");
  if (!UUID.test(memberId) || memberId === actor.id) throw new RoomError("forbidden");
  const updated = await db.query("update memberships set removed_at = now() where room_id = $1 and user_id = $2 and removed_at is null returning user_id", [
    access.room.id,
    memberId,
  ]);
  if (updated.rows.length === 1) {
    await db.query("insert into audit_events (actor_user_id, action, target_type, target_id) values ($1, 'member_remove', 'user', $2)", [actor.id, memberId]);
  } else {
    const existing = await db.query("select user_id from memberships where room_id = $1 and user_id = $2 and removed_at is not null", [
      access.room.id,
      memberId,
    ]);
    if (existing.rows.length !== 1) throw new RoomError("room_not_found");
  }
  await disconnectMedia(() => media.disconnect(access.room.slug, memberId));
}

async function disconnectMedia(run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (error) {
    if (error instanceof RoomError) throw error;
    throw new RoomError("media_disconnect_failed");
  }
}

export async function createInvite(
  db: MigrationClient,
  actor: PublicUser,
  id: string,
  input: { expiresInMinutes: number; maxUses: number },
): Promise<{ id: string; code: string; maxUses: number }> {
  const access = await loadAccess(db, actor, roomId(id));
  if (!canManage(actor, access.membership)) throw new RoomError("forbidden");
  if (!Number.isInteger(input.expiresInMinutes) || input.expiresInMinutes < 1 || input.expiresInMinutes > 10080) throw new RoomError("invalid_body");
  if (!Number.isInteger(input.maxUses) || input.maxUses < 1 || input.maxUses > 20) throw new RoomError("invalid_body");
  const code = randomBytes(32).toString("base64url");
  const inserted = await db.query(
    `insert into invites (room_id, code_hash, created_by, expires_at, max_uses)
     values ($1, $2, $3, now() + ($4 * interval '1 minute'), $5)
     returning id`,
    [access.room.id, hashSecret(code), actor.id, input.expiresInMinutes, input.maxUses],
  );
  const inviteId = text(inserted.rows[0]?.id);
  if (!inviteId) throw new RoomError("room_unconfigured");
  await db.query("insert into audit_events (actor_user_id, action, target_type, target_id) values ($1, 'invite_create', 'room', $2)", [
    actor.id,
    access.room.id,
  ]);
  return { id: inviteId, code, maxUses: input.maxUses };
}

export async function revokeInvite(db: MigrationClient, actor: PublicUser, id: string, inviteId: string): Promise<void> {
  const access = await loadAccess(db, actor, roomId(id));
  if (!canManage(actor, access.membership)) throw new RoomError("forbidden");
  if (!UUID.test(inviteId)) throw new RoomError("room_not_found");
  const updated = await db.query("update invites set revoked_at = now() where id = $1 and room_id = $2 and revoked_at is null returning id", [
    inviteId,
    access.room.id,
  ]);
  if (updated.rows.length !== 1) throw new RoomError("room_not_found");
  await db.query("insert into audit_events (actor_user_id, action, target_type, target_id) values ($1, 'invite_revoke', 'room', $2)", [
    actor.id,
    access.room.id,
  ]);
}

export async function joinRoom(
  db: MigrationClient,
  env: AppEnv,
  actor: PublicUser,
  id: string,
  code: string | undefined,
): Promise<{ url: string; token: string; expiresIn: number }> {
  const access = await loadAccess(db, actor, roomId(id), true);
  if (access.room.ended) throw new RoomError("room_ended");
  const active = access.membership !== undefined && !access.membership.removed;
  if (!active && actor.role !== "admin") {
    if (!code) throw new RoomError("forbidden");
    await redeemInvite(db, access.room.id, actor.id, code);
  }
  const token = await issueRoomToken(env, access.room.slug, actor.id, actor.displayName);
  await db.query("insert into audit_events (actor_user_id, action, target_type, target_id) values ($1, 'room_join', 'room', $2)", [actor.id, access.room.id]);
  return token;
}

async function redeemInvite(db: MigrationClient, id: string, userId: string, code: string): Promise<void> {
  await db.transaction(async (tx) => {
    const updated = await tx.query(
      `update invites
       set use_count = use_count + 1
       where room_id = $1 and code_hash = $2 and revoked_at is null and expires_at > now() and use_count < max_uses
       returning id`,
      [id, hashSecret(code)],
    );
    const inviteId = text(updated.rows[0]?.id);
    if (updated.rows.length !== 1 || !inviteId) throw new RoomError("invalid_invite");
    const joined = await tx.query(
      `insert into memberships (room_id, user_id, role) values ($1, $2, 'participant')
       on conflict (room_id, user_id) do update set removed_at = null, role = 'participant'
       where memberships.removed_at is not null
         and exists (
           select 1 from invites
           where invites.id = $3 and invites.created_at > memberships.removed_at
         )
       returning user_id`,
      [id, userId, inviteId],
    );
    if (joined.rows.length !== 1) throw new RoomError("forbidden");
  });
}

async function issueRoomToken(env: AppEnv, slug: string, userId: string, displayName: string): Promise<{ url: string; token: string; expiresIn: number }> {
  const apiKey = env.LIVEKIT_API_KEY;
  const apiSecret = env.LIVEKIT_API_SECRET;
  const signalUrl = env.LIVEKIT_URL;
  if (!apiKey || !apiSecret || !signalUrl) throw new RoomError("room_unconfigured");
  let url: URL;
  try {
    url = parseSignalUrl(signalUrl);
  } catch {
    throw new RoomError("room_unconfigured");
  }
  const tokenBuilder = new AccessToken(apiKey, apiSecret, { identity: userId, name: displayName, ttl: "10m" });
  tokenBuilder.addGrant({ roomJoin: true, room: slug, canPublish: true, canSubscribe: true, canPublishData: false });
  return { url: url.toString(), token: await tokenBuilder.toJwt(), expiresIn: 600 };
}

async function loadAccess(
  db: MigrationClient,
  actor: PublicUser,
  id: string,
  allowMissing = false,
): Promise<{ room: RoomRecord; membership: Membership | undefined }> {
  const found = await db.query("select id, name, slug, kind, ended_at is not null as ended from rooms where id = $1", [id]);
  const room = readRoom(found.rows[0]);
  if (!room) throw new RoomError("room_not_found");
  const member = await db.query("select role, removed_at is not null as removed from memberships where room_id = $1 and user_id = $2", [id, actor.id]);
  const role = text(member.rows[0]?.role);
  const membership = role ? { role, removed: isTrue(member.rows[0]?.removed) } : undefined;
  if (actor.role !== "admin" && (membership === undefined || membership.removed) && !allowMissing) throw new RoomError("room_not_found");
  return { room, membership };
}

function canManage(actor: PublicUser, membership: Membership | undefined): boolean {
  return actor.role === "admin" || (membership !== undefined && !membership.removed && membership.role === "moderator");
}

function readRoom(row: Record<string, unknown> | undefined): RoomRecord | undefined {
  if (!row) return undefined;
  const id = text(row.id);
  const name = text(row.name);
  const slug = text(row.slug);
  const kind = text(row.kind);
  if (!id || !name || !slug || !kind) return undefined;
  return { id, name, slug, kind, ended: isTrue(row.ended) };
}
