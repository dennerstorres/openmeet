import { createHash, randomBytes } from "node:crypto";
import { hasControlCharacter, parseLabel, parseSignalUrl, sniffImage } from "@openmeet/shared";
import { AccessToken } from "livekit-server-sdk";
import type { AppEnv } from "../poc-join.js";
import type { MigrationClient } from "../db/migrate.js";
import { AuthError, type PublicUser } from "../auth/service.js";
import { hashPassword } from "../auth/password.js";
import { hashSecret } from "../auth/tokens.js";
import { heldRooms, releaseHold, revokeAfter } from "../auth/media-hold.js";
import { roomGrant } from "./grant.js";
import type { RoomMedia } from "./media.js";
import { PlatformPresence, type ActivityState } from "./platform-presence.js";

export type RoomErrorCode =
  | "invalid_body"
  | "invalid_username"
  | "invalid_display_name"
  | "weak_password"
  | "forbidden"
  | "room_not_found"
  | "server_not_found"
  | "invalid_invite"
  | "room_ended"
  | "conflict"
  | "room_unconfigured"
  | "media_disconnect_failed"
  | "presence_unavailable"
  | "user_not_found"
  | "invalid_image"
  | "image_not_found"
  | "invalid_sound"
  | "sound_not_found";

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
const DEFAULT_SERVER_NAME = "Geral";
const INVITE_CODE = /^[A-Za-z0-9_-]{43}$/;

interface RoomRecord {
  id: string;
  serverId: string;
  name: string;
  slug: string;
  kind: string;
  ended: boolean;
}

interface ServerRecord {
  id: string;
  name: string;
}

interface ServerListing extends ServerRecord {
  role: string;
  iconId: string | null;
}

interface ServerMembership {
  role: string;
  removed: boolean;
}

interface ServerAccess {
  server: ServerRecord;
  membership: ServerMembership | undefined;
}

export interface ServerMember {
  id: string;
  displayName: string;
  role: string;
  avatarId: string | null;
}

export interface ServerPresenceMember extends ServerMember {
  status: "online" | "away" | "offline" | "invisible";
  activity?: ActivityState;
  self: boolean;
  globalName: string;
}

export interface ServerPresenceView {
  policy: { allowInvisible: boolean; managersSeeInvisible: boolean };
  selfMode: "visible" | "invisible";
  members: ServerPresenceMember[];
  selfProfile: { nickname: string | null; avatarId: string | null; globalAvatarId: string | null };
}

// ADR 0019: the server nickname and avatar win over the account ones.
const EFFECTIVE_NAME = "coalesce(m.nickname, u.display_name)";
const EFFECTIVE_AVATAR = "coalesce(m.avatar_image_id, u.avatar_image_id)";

function isTrue(value: unknown): boolean {
  return value === true || value === "t" || value === "true" || value === 1;
}

export function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function sqlState(error: unknown): string {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : "";
}

export function roomId(value: string): string {
  if (!UUID.test(value)) throw new RoomError("room_not_found");
  return value;
}

export function serverId(value: string): string {
  if (!UUID.test(value)) throw new RoomError("server_not_found");
  return value;
}

function parseName(value: string): string {
  const name = parseLabel(value);
  if (name === undefined) throw new RoomError("invalid_body");
  return name;
}

export async function audit(db: MigrationClient, actorId: string, action: string, targetType: string, targetId: string): Promise<void> {
  await db.query("insert into audit_events (actor_user_id, action, target_type, target_id) values ($1, $2, $3, $4)", [actorId, action, targetType, targetId]);
}

export async function createAccount(
  db: MigrationClient,
  actor: PublicUser,
  input: { username: string; password: string; displayName: string; role: string },
): Promise<PublicUser> {
  if (actor.role !== "admin") throw new RoomError("forbidden");
  if (!USERNAME.test(input.username)) throw new RoomError("invalid_username");
  const displayName = parseLabel(input.displayName);
  if (displayName === undefined) throw new RoomError("invalid_display_name");
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
    await audit(db, actor.id, "user_create", "user", id);
    return { id, username, displayName: name, role };
  } catch (error) {
    if (error instanceof RoomError) throw error;
    if (sqlState(error) === "23505") throw new RoomError("conflict");
    throw error;
  }
}

// Accounts (S-02). Only the instance admin. The admin account itself is never a target here:
// it is the only admin, and its password changes through its own session or the host recovery command.

export interface AccountRow {
  id: string;
  username: string;
  displayName: string;
  role: string;
  disabled: boolean;
}

export async function listAccounts(db: MigrationClient, actor: PublicUser): Promise<AccountRow[]> {
  if (actor.role !== "admin") throw new RoomError("forbidden");
  const listed = await db.query("select id, username, display_name, role, disabled_at is not null as disabled from users order by username, id");
  return listed.rows.flatMap((row) => {
    const id = text(row.id);
    const username = text(row.username);
    const displayName = text(row.display_name);
    const role = text(row.role);
    return id && username && displayName && role ? [{ id, username, displayName, role, disabled: isTrue(row.disabled) }] : [];
  });
}

async function lockAccount(tx: MigrationClient, actor: PublicUser, id: string): Promise<{ disabled: boolean; hold: boolean }> {
  if (actor.role !== "admin") throw new RoomError("forbidden");
  if (!UUID.test(id)) throw new RoomError("user_not_found");
  if (id === actor.id) throw new RoomError("forbidden");
  const found = await tx.query("select role, disabled_at is not null as disabled, livekit_hold from users where id = $1 for update", [id]);
  const row = found.rows[0];
  if (!row) throw new RoomError("user_not_found");
  if (row.role === "admin") throw new RoomError("forbidden");
  return { disabled: isTrue(row.disabled), hold: isTrue(row.livekit_hold) };
}

export async function resetAccountPassword(db: MigrationClient, actor: PublicUser, id: string, password: string): Promise<void> {
  if (password.length < 12 || password.length > 128) throw new RoomError("weak_password");
  const passwordHash = await hashPassword(password);
  await db.transaction(async (tx) => {
    await lockAccount(tx, actor, id);
    await tx.query("update users set password_hash = $2, updated_at = now() where id = $1", [id, passwordHash]);
    await tx.query("update refresh_sessions set revoked_at = now() where user_id = $1 and revoked_at is null", [id]);
    await audit(tx, actor.id, "user_password_reset", "user", id);
  });
}

// S-02 and S-18: disabled_at stays even when the SFU fails. A repeat calls the SFU again while the hold is on.
export async function disableAccount(db: MigrationClient, actor: PublicUser, id: string, media: RoomMedia | undefined): Promise<void> {
  const pending = await db.transaction(async (tx) => {
    const account = await lockAccount(tx, actor, id);
    if (!account.disabled) {
      await tx.query("update users set disabled_at = now(), updated_at = now() where id = $1", [id]);
      await audit(tx, actor.id, "user_disable", "user", id);
    } else if (!account.hold) {
      return undefined;
    }
    await tx.query("update refresh_sessions set revoked_at = now() where user_id = $1 and revoked_at is null", [id]);
    const rooms = await heldRooms(tx, id);
    await tx.query("update users set livekit_hold = $2 where id = $1", [id, rooms.length > 0]);
    return rooms.length > 0 ? rooms : undefined;
  });
  if (pending && !(await releaseHold(db, id, media, pending))) throw new RoomError("media_disconnect_failed");
}

// While the cut is pending the account stays disabled. No session is created.
export async function enableAccount(db: MigrationClient, actor: PublicUser, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const account = await lockAccount(tx, actor, id);
    if (account.hold) throw new RoomError("media_disconnect_failed");
    if (!account.disabled) return;
    await tx.query("update users set disabled_at = null, updated_at = now() where id = $1", [id]);
    await audit(tx, actor.id, "user_enable", "user", id);
  });
}

// Servers

export async function createServer(db: MigrationClient, actor: PublicUser, input: { name: string }): Promise<ServerRecord & { role: string }> {
  if (actor.role !== "admin") throw new RoomError("forbidden");
  const name = parseName(input.name);
  return db.transaction((tx) => insertServer(tx, actor, name));
}

async function insertServer(tx: MigrationClient, actor: PublicUser, name: string): Promise<ServerRecord & { role: string }> {
  const inserted = await tx.query("insert into servers (name, created_by) values ($1, $2) returning id", [name, actor.id]);
  const id = text(inserted.rows[0]?.id);
  if (!id) throw new RoomError("conflict");
  await tx.query("insert into server_members (server_id, user_id, role) values ($1, $2, 'owner')", [id, actor.id]);
  await audit(tx, actor.id, "server_create", "server", id);
  return { id, name, role: "owner" };
}

export async function listServers(db: MigrationClient, actor: PublicUser): Promise<ServerListing[]> {
  const listed = await db.query(
    `select s.id, s.name, m.role, s.icon_image_id
     from servers s
     join server_members m on m.server_id = s.id and m.user_id = $1 and m.removed_at is null
     where s.deleted_at is null
     order by s.created_at, s.id`,
    [actor.id],
  );
  return listed.rows.flatMap((row) => {
    const id = text(row.id);
    const name = text(row.name);
    const role = text(row.role);
    return id && name && role ? [{ id, name, role, iconId: text(row.icon_image_id) ?? null }] : [];
  });
}

export async function getServer(
  db: MigrationClient,
  actor: PublicUser,
  id: string,
): Promise<{ server: ServerRecord & { role: string }; members: ServerMember[] }> {
  const access = await loadServerAccess(db, actor, serverId(id));
  const role = activeRole(access.membership);
  if (!role) throw new RoomError("server_not_found");
  return { server: { ...access.server, role }, members: await serverMembers(db, access.server.id) };
}

export async function heartbeatServerPresence(db: MigrationClient, actor: PublicUser, id: string, state: string, presence: PlatformPresence): Promise<void> {
  if (state !== "online" && state !== "away" && state !== "offline") throw new RoomError("invalid_body");
  const access = await loadServerAccess(db, actor, serverId(id));
  requireMember(access);
  if (state === "offline") presence.drop(access.server.id, actor.id);
  else presence.touch(access.server.id, actor.id, state);
}

export async function listServerPresence(db: MigrationClient, actor: PublicUser, id: string, presence: PlatformPresence): Promise<ServerPresenceView> {
  const access = await loadServerAccess(db, actor, serverId(id));
  requireMember(access);
  const policyRow = await db.query("select allow_invisible, managers_see_invisible from servers where id = $1", [access.server.id]);
  const allowInvisible = isTrue(policyRow.rows[0]?.allow_invisible);
  const managersSeeInvisible = isTrue(policyRow.rows[0]?.managers_see_invisible);
  const manager = canManage(access.membership);
  const listed = await db.query(
    `select u.id, ${EFFECTIVE_NAME} as display_name, u.display_name as global_name, m.role, m.presence_mode,
            ${EFFECTIVE_AVATAR} as avatar_id, m.nickname, m.avatar_image_id as server_avatar_id, u.avatar_image_id as global_avatar_id
     from server_members m
     join users u on u.id = m.user_id
     where m.server_id = $1 and m.removed_at is null and u.disabled_at is null
     order by ${EFFECTIVE_NAME}, u.id`,
    [access.server.id],
  );
  let selfMode: "visible" | "invisible" = "visible";
  let selfProfile: ServerPresenceView["selfProfile"] = { nickname: null, avatarId: null, globalAvatarId: null };
  const members = listed.rows.flatMap((row): ServerPresenceMember[] => {
    const userId = text(row.id);
    const displayName = text(row.display_name);
    const role = text(row.role);
    if (!userId || !displayName || !role) return [];
    const invisible = allowInvisible && row.presence_mode === "invisible";
    const activity = presence.read(access.server.id, userId);
    const self = userId === actor.id;
    const person = { id: userId, displayName, role, avatarId: text(row.avatar_id) ?? null, globalName: text(row.global_name) ?? displayName, self };
    if (self) {
      selfMode = invisible ? "invisible" : "visible";
      selfProfile = { nickname: text(row.nickname) ?? null, avatarId: text(row.server_avatar_id) ?? null, globalAvatarId: text(row.global_avatar_id) ?? null };
    }
    if (!invisible) return [{ ...person, status: activity }];
    if (self || (manager && managersSeeInvisible)) {
      return [activity === "offline" ? { ...person, status: "invisible" } : { ...person, status: "invisible", activity }];
    }
    return [{ ...person, status: "offline" }];
  });
  return { policy: { allowInvisible, managersSeeInvisible }, selfMode, members, selfProfile };
}

export async function setServerPresenceMode(db: MigrationClient, actor: PublicUser, id: string, mode: string): Promise<void> {
  if (mode !== "visible" && mode !== "invisible") throw new RoomError("invalid_body");
  const access = await loadServerAccess(db, actor, serverId(id));
  requireMember(access);
  if (mode === "invisible") {
    const policy = await db.query("select allow_invisible from servers where id = $1", [access.server.id]);
    if (!isTrue(policy.rows[0]?.allow_invisible)) throw new RoomError("forbidden");
  }
  await db.query("update server_members set presence_mode = $3 where server_id = $1 and user_id = $2 and removed_at is null", [
    access.server.id,
    actor.id,
    mode,
  ]);
}

export async function setServerPresencePolicy(
  db: MigrationClient,
  actor: PublicUser,
  id: string,
  policy: { allowInvisible: boolean; managersSeeInvisible: boolean },
): Promise<void> {
  const access = await loadServerAccess(db, actor, serverId(id));
  requireMember(access);
  if (activeRole(access.membership) !== "owner") throw new RoomError("forbidden");
  await db.transaction(async (tx) => {
    await tx.query("update servers set allow_invisible = $2, managers_see_invisible = $3, updated_at = now() where id = $1", [
      access.server.id,
      policy.allowInvisible,
      policy.allowInvisible && policy.managersSeeInvisible,
    ]);
    if (!policy.allowInvisible) await tx.query("update server_members set presence_mode = 'visible' where server_id = $1", [access.server.id]);
    await audit(tx, actor.id, "server_presence_policy", "server", access.server.id);
  });
}

export async function listServerRooms(db: MigrationClient, actor: PublicUser, id: string): Promise<RoomRecord[]> {
  const access = await loadServerAccess(db, actor, serverId(id));
  if (!activeRole(access.membership)) throw new RoomError("server_not_found");
  const listed = await db.query(
    "select id, server_id, name, slug, kind, ended_at is not null as ended from rooms where server_id = $1 and deleted_at is null order by created_at, id",
    [access.server.id],
  );
  return listed.rows.map(readRoom).filter((room): room is RoomRecord => room !== undefined);
}

async function serverMembers(db: MigrationClient, id: string): Promise<ServerMember[]> {
  const members = await db.query(
    `select u.id, ${EFFECTIVE_NAME} as display_name, m.role, ${EFFECTIVE_AVATAR} as avatar_id
     from server_members m
     join users u on u.id = m.user_id
     where m.server_id = $1 and m.removed_at is null
     order by ${EFFECTIVE_NAME}, u.id`,
    [id],
  );
  return members.rows.flatMap((row) => {
    const memberId = text(row.id);
    const displayName = text(row.display_name);
    const role = text(row.role);
    return memberId && displayName && role ? [{ id: memberId, displayName, role, avatarId: text(row.avatar_id) ?? null }] : [];
  });
}

export async function createServerInvite(
  db: MigrationClient,
  actor: PublicUser,
  id: string,
  input: { expiresInMinutes: number; maxUses: number },
): Promise<{ id: string; code: string; maxUses: number }> {
  const access = await loadServerAccess(db, actor, serverId(id));
  requireMember(access);
  if (!canManage(access.membership)) throw new RoomError("forbidden");
  if (!Number.isInteger(input.expiresInMinutes) || input.expiresInMinutes < 1 || input.expiresInMinutes > 10080) throw new RoomError("invalid_body");
  if (!Number.isInteger(input.maxUses) || input.maxUses < 1 || input.maxUses > 20) throw new RoomError("invalid_body");
  const code = randomBytes(32).toString("base64url");
  const inserted = await db.query(
    `insert into server_invites (server_id, code_hash, created_by, expires_at, max_uses)
     values ($1, $2, $3, now() + ($4 * interval '1 minute'), $5)
     returning id`,
    [access.server.id, hashSecret(code), actor.id, input.expiresInMinutes, input.maxUses],
  );
  const inviteId = text(inserted.rows[0]?.id);
  if (!inviteId) throw new RoomError("room_unconfigured");
  await audit(db, actor.id, "invite_create", "server", access.server.id);
  return { id: inviteId, code, maxUses: input.maxUses };
}

export async function revokeServerInvite(db: MigrationClient, actor: PublicUser, id: string, inviteId: string): Promise<void> {
  const access = await loadServerAccess(db, actor, serverId(id));
  requireMember(access);
  if (!canManage(access.membership)) throw new RoomError("forbidden");
  if (!UUID.test(inviteId)) throw new RoomError("server_not_found");
  const updated = await db.query("update server_invites set revoked_at = now() where id = $1 and server_id = $2 and revoked_at is null returning id", [
    inviteId,
    access.server.id,
  ]);
  if (updated.rows.length !== 1) throw new RoomError("server_not_found");
  await audit(db, actor.id, "invite_revoke", "server", access.server.id);
}

export async function acceptServerInvite(db: MigrationClient, actor: PublicUser, id: string, code: string): Promise<ServerRecord & { role: string }> {
  const access = await loadServerAccess(db, actor, serverId(id));
  const role = activeRole(access.membership);
  if (role) return { ...access.server, role };
  await db.transaction(async (tx) => {
    await redeemInvite(tx, access.server.id, actor.id, code);
    await audit(tx, actor.id, "server_join", "server", access.server.id);
  });
  return { ...access.server, role: "participant" };
}

// ADR 0012: the link carries only the code. The server comes from the invite itself.
export async function acceptInviteCode(db: MigrationClient, actor: PublicUser, code: string): Promise<ServerRecord & { role: string }> {
  if (!INVITE_CODE.test(code)) throw new RoomError("invalid_invite");
  const found = await db.query("select server_id from server_invites where code_hash = $1 and revoked_at is null and expires_at > now()", [hashSecret(code)]);
  const id = text(found.rows[0]?.server_id);
  if (!id) throw new RoomError("invalid_invite");
  return acceptServerInvite(db, actor, id, code);
}

export async function removeServerMember(db: MigrationClient, actor: PublicUser, id: string, memberId: string, media: RoomMedia | undefined): Promise<void> {
  if (!media) throw new RoomError("room_unconfigured");
  const access = await loadServerAccess(db, actor, serverId(id));
  requireMember(access);
  await removeFromServer(db, actor, access, memberId, media);
}

// S-04: the removal commits first and stays. The member is cut from the SFU after the commit;
// until the SFU confirms, the same member gets no token and no invite brings them back.
async function removeFromServer(db: MigrationClient, actor: PublicUser, access: ServerAccess, memberId: string, media: RoomMedia): Promise<void> {
  if (!canManage(access.membership)) throw new RoomError("forbidden");
  if (!UUID.test(memberId) || memberId === actor.id) throw new RoomError("forbidden");
  const pending = await db.transaction(async (tx) => {
    const target = await tx.query(
      `select role, removed_at is not null as removed, media_cut_at is not null as cut, last_join_nbf, avatar_image_id
       from server_members where server_id = $1 and user_id = $2 for update`,
      [access.server.id, memberId],
    );
    const row = target.rows[0];
    const targetRole = text(row?.role);
    if (!row || !targetRole) throw new RoomError("server_not_found");
    if (targetRole === "owner") throw new RoomError("forbidden");
    if (targetRole === "moderator" && access.membership?.role !== "owner") throw new RoomError("forbidden");
    if (!isTrue(row.removed)) {
      // ADR 0019: leaving the server takes the nickname and avatar used there with it.
      await tx.query(
        "update server_members set removed_at = now(), media_cut_at = null, nickname = null, avatar_image_id = null where server_id = $1 and user_id = $2",
        [access.server.id, memberId],
      );
      await dropImage(tx, text(row.avatar_image_id));
      await audit(tx, actor.id, "member_remove", "user", memberId);
    } else if (isTrue(row.cut)) {
      return undefined;
    }
    const openRooms = await tx.query("select id from rooms where server_id = $1 and ended_at is null order by created_at, id", [access.server.id]);
    return { revokeAt: revokeAfter(row.last_join_nbf), rooms: openRooms.rows.flatMap((room) => (text(room.id) ? [String(room.id)] : [])) };
  });
  if (!pending) return;
  for (const room of pending.rooms) await disconnectMedia(() => media.disconnect(room, memberId, pending.revokeAt));
  await db.query("update server_members set media_cut_at = now() where server_id = $1 and user_id = $2 and removed_at is not null and media_cut_at is null", [
    access.server.id,
    memberId,
  ]);
}

export interface RoomOccupant {
  id: string;
  displayName: string;
}

// ADR 0011. Read from the SFU on each request, never stored. Names come from the database, not from the token.
export async function serverPresence(
  db: MigrationClient,
  actor: PublicUser,
  id: string,
  media: RoomMedia | undefined,
): Promise<Record<string, RoomOccupant[]>> {
  const access = await loadServerAccess(db, actor, serverId(id));
  requireMember(access);
  const occupants = media?.occupants?.bind(media);
  if (!occupants) throw new RoomError("presence_unavailable");
  const open = await db.query("select id from rooms where server_id = $1 and ended_at is null order by created_at, id", [access.server.id]);
  const roomIds = open.rows.flatMap((row) => {
    const room = text(row.id);
    return room ? [room] : [];
  });
  let lists: string[][];
  try {
    lists = await Promise.all(roomIds.map((room) => occupants(room)));
  } catch {
    throw new RoomError("presence_unavailable");
  }
  const identities = [...new Set(lists.flat().filter((identity) => UUID.test(identity)))];
  const names = new Map<string, string>();
  if (identities.length > 0) {
    const found = await db.query(
      `select u.id, ${EFFECTIVE_NAME} as display_name
       from users u left join server_members m on m.user_id = u.id and m.server_id = $2 and m.removed_at is null
       where u.id = any($1::uuid[])`,
      [identities, access.server.id],
    );
    for (const row of found.rows) {
      const userId = text(row.id);
      const displayName = text(row.display_name);
      if (userId && displayName) names.set(userId, displayName);
    }
  }
  const presence: Record<string, RoomOccupant[]> = {};
  roomIds.forEach((room, index) => {
    const seen = new Set<string>();
    presence[room] = (lists[index] ?? []).flatMap((identity) => {
      if (seen.has(identity)) return [];
      seen.add(identity);
      return [{ id: identity, displayName: names.get(identity) ?? "Participante" }];
    });
  });
  return presence;
}

// Rooms

export async function createRoom(
  db: MigrationClient,
  actor: PublicUser,
  input: { serverId: string | undefined; name: string; slug: string; kind: string },
): Promise<RoomRecord> {
  const name = parseName(input.name);
  if (!SLUG.test(input.slug)) throw new RoomError("invalid_body");
  if (input.kind !== "persistent" && input.kind !== "temporary") throw new RoomError("invalid_body");
  try {
    return await db.transaction(async (tx) => {
      const target = input.serverId === undefined ? await defaultServer(tx, actor) : serverId(input.serverId);
      const access = await loadServerAccess(tx, actor, target);
      requireMember(access);
      if (!canManage(access.membership)) throw new RoomError("forbidden");
      const inserted = await tx.query("insert into rooms (server_id, name, slug, kind, created_by) values ($1, $2, $3, $4, $5) returning id", [
        access.server.id,
        name,
        input.slug,
        input.kind,
        actor.id,
      ]);
      const id = text(inserted.rows[0]?.id);
      if (!id) throw new RoomError("conflict");
      await audit(tx, actor.id, "room_create", "room", id);
      return { id, serverId: access.server.id, name, slug: input.slug, kind: input.kind, ended: false };
    });
  } catch (error) {
    if (error instanceof RoomError) throw error;
    if (sqlState(error) === "23505") throw new RoomError("conflict");
    throw error;
  }
}

// A client that predates servers creates rooms without naming one. It lands in the oldest server the caller manages.
// The instance admin with no server gets "Geral", so a fresh install still works from the current desktop app.
async function defaultServer(tx: MigrationClient, actor: PublicUser): Promise<string> {
  const managed = await tx.query(
    `select s.id
     from servers s
     join server_members m on m.server_id = s.id and m.user_id = $1 and m.removed_at is null and m.role in ('owner', 'moderator')
     where s.deleted_at is null
     order by s.created_at, s.id
     limit 1`,
    [actor.id],
  );
  const found = text(managed.rows[0]?.id);
  if (found) return found;
  if (actor.role !== "admin") throw new RoomError("forbidden");
  return (await insertServer(tx, actor, DEFAULT_SERVER_NAME)).id;
}

export async function listRooms(db: MigrationClient, actor: PublicUser): Promise<RoomRecord[]> {
  const listed = await db.query(
    `select r.id, r.server_id, r.name, r.slug, r.kind, r.ended_at is not null as ended
     from rooms r
     join servers s on s.id = r.server_id and s.deleted_at is null
     join server_members m on m.server_id = r.server_id and m.user_id = $1 and m.removed_at is null
     where r.deleted_at is null
     order by r.created_at, r.id`,
    [actor.id],
  );
  return listed.rows.map(readRoom).filter((room): room is RoomRecord => room !== undefined);
}

// S-10: a room member sees names and roles, never the login.
export async function getRoom(db: MigrationClient, actor: PublicUser, id: string): Promise<{ room: RoomRecord; members: ServerMember[] }> {
  const { room, access } = await loadRoomAccess(db, actor, roomId(id));
  if (!activeRole(access.membership)) throw new RoomError("room_not_found");
  return { room, members: await serverMembers(db, room.serverId) };
}

export async function endRoom(db: MigrationClient, actor: PublicUser, id: string, media: RoomMedia | undefined): Promise<void> {
  if (!media) throw new RoomError("room_unconfigured");
  const { room, access } = await loadRoomAccess(db, actor, roomId(id));
  if (!activeRole(access.membership)) throw new RoomError("room_not_found");
  if (!canManage(access.membership)) throw new RoomError("forbidden");
  // S-04: the end commits first and stays. A retry reads the newest nbf again before calling the SFU.
  const revokeAt = await db.transaction(async (tx) => {
    const locked = await tx.query(
      "select ended_at is not null as ended, media_closed_at is not null as closed, last_join_nbf from rooms where id = $1 for update",
      [room.id],
    );
    const row = locked.rows[0];
    if (!row) throw new RoomError("room_not_found");
    if (!isTrue(row.ended)) {
      await tx.query("update rooms set ended_at = now(), updated_at = now() where id = $1", [room.id]);
      await audit(tx, actor.id, "room_end", "room", room.id);
    } else if (isTrue(row.closed)) {
      return undefined;
    }
    return revokeAfter(row.last_join_nbf);
  });
  if (revokeAt === undefined) return;
  await disconnectMedia(() => media.closeRoom(room.id, revokeAt));
  await db.query("update rooms set media_closed_at = now() where id = $1 and media_closed_at is null", [room.id]);
}

// ADR 0023: removal ends the call and hides the room; the row stays for audit and invites.
// S-04: the mark commits first and stays. A retry on a removed room only closes the media still open.
export async function deleteRoom(db: MigrationClient, actor: PublicUser, id: string, media: RoomMedia | undefined): Promise<void> {
  if (!media) throw new RoomError("room_unconfigured");
  const target = roomId(id);
  const found = await db.query("select server_id from rooms where id = $1", [target]);
  const server = text(found.rows[0]?.server_id);
  if (!server) throw new RoomError("room_not_found");
  const access = await loadServerAccess(db, actor, server);
  if (!activeRole(access.membership)) throw new RoomError("room_not_found");
  if (!canManage(access.membership)) throw new RoomError("forbidden");
  const revokeAt = await db.transaction(async (tx) => {
    const locked = await tx.query(
      "select deleted_at is not null as deleted, media_closed_at is not null as closed, last_join_nbf from rooms where id = $1 for update",
      [target],
    );
    const row = locked.rows[0];
    if (!row) throw new RoomError("room_not_found");
    if (!isTrue(row.deleted)) {
      await tx.query("update rooms set deleted_at = now(), ended_at = coalesce(ended_at, now()), updated_at = now() where id = $1", [target]);
      await tx.query("update invites set revoked_at = now() where room_id = $1 and revoked_at is null", [target]);
      await audit(tx, actor.id, "room_delete", "room", target);
    } else if (isTrue(row.closed)) {
      return undefined;
    }
    return revokeAfter(row.last_join_nbf);
  });
  if (revokeAt === undefined) return;
  await disconnectMedia(() => media.closeRoom(target, revokeAt));
  await db.query("update rooms set media_closed_at = now() where id = $1 and media_closed_at is null", [target]);
}

// ADR 0023: only the owner removes a server. Every room in it ends and every invite stops working.
export async function deleteServer(db: MigrationClient, actor: PublicUser, id: string, media: RoomMedia | undefined): Promise<void> {
  if (!media) throw new RoomError("room_unconfigured");
  const target = serverId(id);
  const member = await db.query("select role, removed_at is not null as removed from server_members where server_id = $1 and user_id = $2", [target, actor.id]);
  const role = text(member.rows[0]?.role);
  if (!role || isTrue(member.rows[0]?.removed)) throw new RoomError("server_not_found");
  if (role !== "owner") throw new RoomError("forbidden");
  const pending = await db.transaction(async (tx) => {
    const locked = await tx.query("select deleted_at is not null as deleted from servers where id = $1 for update", [target]);
    const row = locked.rows[0];
    if (!row) throw new RoomError("server_not_found");
    if (!isTrue(row.deleted)) {
      await tx.query("update servers set deleted_at = now(), updated_at = now() where id = $1", [target]);
      await tx.query("update server_invites set revoked_at = now() where server_id = $1 and revoked_at is null", [target]);
      await audit(tx, actor.id, "server_delete", "server", target);
    }
    const open = await tx.query(
      `update rooms set deleted_at = coalesce(deleted_at, now()), ended_at = coalesce(ended_at, now()), updated_at = now()
       where id in (select id from rooms where server_id = $1 and media_closed_at is null order by created_at, id for update)
       returning id, last_join_nbf`,
      [target],
    );
    await tx.query("update invites set revoked_at = now() where room_id in (select id from rooms where server_id = $1) and revoked_at is null", [target]);
    return open.rows.flatMap((room) => (text(room.id) ? [{ id: String(room.id), revokeAt: revokeAfter(room.last_join_nbf) }] : []));
  });
  for (const room of pending) {
    await disconnectMedia(() => media.closeRoom(room.id, room.revokeAt));
    await db.query("update rooms set media_closed_at = now() where id = $1 and media_closed_at is null", [room.id]);
  }
}

// The room routes below predate servers. They act on the server that owns the room.

export async function removeMember(db: MigrationClient, actor: PublicUser, id: string, memberId: string, media: RoomMedia | undefined): Promise<void> {
  if (!media) throw new RoomError("room_unconfigured");
  const { access } = await loadRoomAccess(db, actor, roomId(id));
  if (!activeRole(access.membership)) throw new RoomError("room_not_found");
  await removeFromServer(db, actor, access, memberId, media);
}

/** Disconnect this call only. Membership remains valid for a deliberate rejoin. */
export async function kickParticipant(db: MigrationClient, actor: PublicUser, id: string, memberId: string, media: RoomMedia | undefined): Promise<void> {
  if (!media) throw new RoomError("room_unconfigured");
  const { room, access } = await loadRoomAccess(db, actor, roomId(id));
  if (!activeRole(access.membership)) throw new RoomError("room_not_found");
  if (actor.role !== "admin" && !canManage(access.membership)) throw new RoomError("forbidden");
  if (!UUID.test(memberId) || memberId === actor.id) throw new RoomError("forbidden");
  await db.transaction(async (tx) => {
    await tx.query("select id from rooms where id = $1 for update", [room.id]);
    const target = await tx.query("select role, last_join_nbf from server_members where server_id = $1 and user_id = $2 and removed_at is null for update", [
      room.serverId,
      memberId,
    ]);
    const row = target.rows[0];
    const role = text(row?.role);
    if (!row || role === "owner" || (role === "moderator" && actor.role !== "admin" && access.membership?.role !== "owner")) {
      throw new RoomError("forbidden");
    }
    await disconnectMedia(() => media.disconnect(room.id, memberId, revokeAfter(row.last_join_nbf)));
    await audit(tx, actor.id, "room_kick", "user", memberId);
  });
}

export async function createInvite(
  db: MigrationClient,
  actor: PublicUser,
  id: string,
  input: { expiresInMinutes: number; maxUses: number },
): Promise<{ id: string; code: string; maxUses: number }> {
  const { room, access } = await loadRoomAccess(db, actor, roomId(id));
  if (!activeRole(access.membership)) throw new RoomError("room_not_found");
  return createServerInvite(db, actor, room.serverId, input);
}

export async function revokeInvite(db: MigrationClient, actor: PublicUser, id: string, inviteId: string): Promise<void> {
  const { room, access } = await loadRoomAccess(db, actor, roomId(id));
  if (!activeRole(access.membership)) throw new RoomError("room_not_found");
  await revokeServerInvite(db, actor, room.serverId, inviteId);
}

async function disconnectMedia(run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (error) {
    if (error instanceof RoomError) throw error;
    throw new RoomError("media_disconnect_failed");
  }
}

// S-04: invite, membership and signature under one lock, in the order user, session, room, membership.
// Logout, deactivation, removal and ending take the same rows in the same order.
export async function joinRoom(
  db: MigrationClient,
  env: AppEnv,
  actor: PublicUser,
  id: string,
  code: string | undefined,
  sessionId: string | undefined = undefined,
): Promise<{ url: string; token: string; expiresIn: number }> {
  const target = roomId(id);
  return db.transaction(async (tx) => {
    const user = await tx.query("select display_name, disabled_at is not null as disabled, livekit_hold from users where id = $1 for update", [actor.id]);
    const userRow = user.rows[0];
    if (!userRow || isTrue(userRow.disabled)) throw new AuthError("unauthorized");
    if (sessionId !== undefined) {
      const session = await tx.query(
        "select revoked_at is not null or expires_at <= now() as dead from refresh_sessions where id = $1 and user_id = $2 for update",
        [sessionId, actor.id],
      );
      if (!session.rows[0] || isTrue(session.rows[0].dead)) throw new AuthError("unauthorized");
    }
    if (isTrue(userRow.livekit_hold)) throw new RoomError("forbidden");
    const found = await tx.query(
      "select id, server_id, name, slug, kind, ended_at is not null as ended from rooms where id = $1 and deleted_at is null for update",
      [target],
    );
    const room = readRoom(found.rows[0]);
    if (!room) throw new RoomError("room_not_found");
    const membership = await tx.query(
      "select removed_at is not null as removed, media_cut_at is null as cut_pending from server_members where server_id = $1 and user_id = $2 for update",
      [room.serverId, actor.id],
    );
    const memberRow = membership.rows[0];
    const member = memberRow !== undefined && !isTrue(memberRow.removed);
    // S-01: without a membership or a code the state of the room stays hidden.
    if (!member && !code) throw new RoomError("forbidden");
    if (memberRow !== undefined && isTrue(memberRow.removed) && isTrue(memberRow.cut_pending)) throw new RoomError("forbidden");
    if (room.ended) throw new RoomError("room_ended");
    if (!member && code) {
      await redeemInvite(tx, room.serverId, actor.id, code);
      await audit(tx, actor.id, "server_join", "server", room.serverId);
    }
    const own = await tx.query("select nickname from server_members where server_id = $1 and user_id = $2 and removed_at is null", [room.serverId, actor.id]);
    const signed = await issueRoomToken(env, room.id, actor.id, text(own.rows[0]?.nickname) ?? text(userRow.display_name) ?? "");
    const nbf = tokenNotBefore(signed.token);
    await tx.query("update server_members set last_join_nbf = greatest(coalesce(last_join_nbf, 0), $3) where server_id = $1 and user_id = $2", [
      room.serverId,
      actor.id,
      nbf,
    ]);
    await tx.query("update rooms set last_join_nbf = greatest(coalesce(last_join_nbf, 0), $2) where id = $1", [room.id, nbf]);
    await audit(tx, actor.id, "room_join", "room", room.id);
    return signed;
  });
}

// The `nbf` LiveKit compares with revokeTokenTs, read from the token just signed. The token is never logged.
function tokenNotBefore(token: string): string {
  const payload: unknown = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"));
  const nbf = typeof payload === "object" && payload !== null && "nbf" in payload ? payload.nbf : undefined;
  if (typeof nbf !== "number" || !Number.isInteger(nbf) || nbf < 1) throw new RoomError("room_unconfigured");
  return String(nbf);
}

// Runs inside the transaction of the caller. A removed member whose SFU cut is still pending cannot come back.
async function redeemInvite(tx: MigrationClient, id: string, userId: string, code: string): Promise<void> {
  const current = await tx.query(
    "select removed_at is not null and media_cut_at is null as cut_pending from server_members where server_id = $1 and user_id = $2 for update",
    [id, userId],
  );
  if (isTrue(current.rows[0]?.cut_pending)) throw new RoomError("forbidden");
  const updated = await tx.query(
    `update server_invites
     set use_count = use_count + 1
     where server_id = $1 and code_hash = $2 and revoked_at is null and expires_at > now() and use_count < max_uses
     returning id`,
    [id, hashSecret(code)],
  );
  const inviteId = text(updated.rows[0]?.id);
  if (updated.rows.length !== 1 || !inviteId) throw new RoomError("invalid_invite");
  // A removed member comes back only with an invite created after the removal.
  const joined = await tx.query(
    `insert into server_members (server_id, user_id, role) values ($1, $2, 'participant')
     on conflict (server_id, user_id) do update set removed_at = null, role = 'participant'
     where server_members.removed_at is not null
       and exists (
         select 1 from server_invites
         where server_invites.id = $3 and server_invites.created_at > server_members.removed_at
       )
     returning user_id`,
    [id, userId, inviteId],
  );
  if (joined.rows.length !== 1) throw new RoomError("forbidden");
}

// The LiveKit room is the room id. Slugs repeat across servers; ids do not.
async function issueRoomToken(env: AppEnv, room: string, userId: string, displayName: string): Promise<{ url: string; token: string; expiresIn: number }> {
  const apiKey = env.LIVEKIT_API_KEY;
  const apiSecret = env.LIVEKIT_API_SECRET;
  const signalUrl = env.LIVEKIT_URL;
  if (!apiKey || !apiSecret || !signalUrl) throw new RoomError("room_unconfigured");
  // A name stored before 0004 is never signed into the call label.
  if (parseLabel(displayName) !== displayName) throw new RoomError("invalid_display_name");
  let url: URL;
  try {
    url = parseSignalUrl(signalUrl);
  } catch {
    throw new RoomError("room_unconfigured");
  }
  const tokenBuilder = new AccessToken(apiKey, apiSecret, { identity: userId, name: displayName, ttl: "10m" });
  tokenBuilder.addGrant(roomGrant(room));
  return { url: url.toString(), token: await tokenBuilder.toJwt(), expiresIn: 600 };
}

export async function loadServerAccess(db: MigrationClient, actor: PublicUser, id: string): Promise<ServerAccess> {
  const found = await db.query("select id, name from servers where id = $1 and deleted_at is null", [id]);
  const foundId = text(found.rows[0]?.id);
  const name = text(found.rows[0]?.name);
  if (!foundId || !name) throw new RoomError("server_not_found");
  const member = await db.query("select role, removed_at is not null as removed from server_members where server_id = $1 and user_id = $2", [id, actor.id]);
  const role = text(member.rows[0]?.role);
  return { server: { id: foundId, name }, membership: role ? { role, removed: isTrue(member.rows[0]?.removed) } : undefined };
}

// A missing room and a room in a server the caller is not part of look the same to the caller.
async function loadRoomAccess(db: MigrationClient, actor: PublicUser, id: string): Promise<{ room: RoomRecord; access: ServerAccess }> {
  const found = await db.query("select id, server_id, name, slug, kind, ended_at is not null as ended from rooms where id = $1 and deleted_at is null", [id]);
  const room = readRoom(found.rows[0]);
  if (!room) throw new RoomError("room_not_found");
  return { room, access: await loadServerAccess(db, actor, room.serverId) };
}

export function requireMember(access: ServerAccess): void {
  if (!activeRole(access.membership)) throw new RoomError("server_not_found");
}

function activeRole(membership: ServerMembership | undefined): string | undefined {
  return membership !== undefined && !membership.removed ? membership.role : undefined;
}

export function canManage(membership: ServerMembership | undefined): boolean {
  const role = activeRole(membership);
  return role === "owner" || role === "moderator";
}

function readRoom(row: Record<string, unknown> | undefined): RoomRecord | undefined {
  if (!row) return undefined;
  const id = text(row.id);
  const server = text(row.server_id);
  const name = text(row.name);
  const slug = text(row.slug);
  const kind = text(row.kind);
  if (!id || !server || !name || !slug || !kind) return undefined;
  return { id, serverId: server, name, slug, kind, ended: isTrue(row.ended) };
}

// Profiles (ADR 0019)

export interface StoredImage {
  contentType: string;
  bytes: Uint8Array;
}

async function storeImage(tx: MigrationClient, actorId: string, bytes: Uint8Array): Promise<string> {
  const info = sniffImage(bytes);
  if (!info) throw new RoomError("invalid_image");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const inserted = await tx.query(
    "insert into images (content_type, bytes, byte_size, width, height, sha256, created_by) values ($1, $2, $3, $4, $5, $6, $7) returning id",
    [info.type, Buffer.from(bytes), bytes.length, info.width, info.height, sha256, actorId],
  );
  const id = text(inserted.rows[0]?.id);
  if (!id) throw new RoomError("conflict");
  return id;
}

// Each image fills one slot, so the previous one goes once the slot points elsewhere.
async function dropImage(tx: MigrationClient, id: string | undefined): Promise<void> {
  if (id) await tx.query("delete from images where id = $1", [id]);
}

async function replaceImage(
  tx: MigrationClient,
  actorId: string,
  image: Uint8Array | null,
  swap: (next: string | null) => Promise<string | undefined>,
): Promise<string | null> {
  const next = image === null ? null : await storeImage(tx, actorId, image);
  await dropImage(tx, await swap(next));
  return next;
}

export async function setAccountAvatar(db: MigrationClient, actor: PublicUser, image: Uint8Array | null): Promise<{ avatarId: string | null }> {
  return db.transaction(async (tx) => {
    const current = await tx.query("select avatar_image_id from users where id = $1 for update", [actor.id]);
    if (!current.rows[0]) throw new AuthError("unauthorized");
    const avatarId = await replaceImage(tx, actor.id, image, async (next) => {
      await tx.query("update users set avatar_image_id = $2, updated_at = now() where id = $1", [actor.id, next]);
      return text(current.rows[0]?.avatar_image_id);
    });
    return { avatarId };
  });
}

export async function setServerIcon(db: MigrationClient, actor: PublicUser, id: string, image: Uint8Array | null): Promise<{ iconId: string | null }> {
  const access = await loadServerAccess(db, actor, serverId(id));
  requireMember(access);
  if (activeRole(access.membership) !== "owner") throw new RoomError("forbidden");
  return db.transaction(async (tx) => {
    const current = await tx.query("select icon_image_id from servers where id = $1 for update", [access.server.id]);
    const iconId = await replaceImage(tx, actor.id, image, async (next) => {
      await tx.query("update servers set icon_image_id = $2, updated_at = now() where id = $1", [access.server.id, next]);
      return text(current.rows[0]?.icon_image_id);
    });
    await audit(tx, actor.id, "server_icon", "server", access.server.id);
    return { iconId };
  });
}

/** `undefined` keeps the field, `null` clears it. A member only ever edits their own row. */
export async function setServerProfile(
  db: MigrationClient,
  actor: PublicUser,
  id: string,
  input: { nickname: string | null | undefined; avatar: Uint8Array | null | undefined },
): Promise<{ nickname: string | null; avatarId: string | null }> {
  const access = await loadServerAccess(db, actor, serverId(id));
  requireMember(access);
  let nickname: string | null | undefined = input.nickname;
  if (typeof nickname === "string") {
    nickname = nickname.trim() === "" && !hasControlCharacter(nickname) ? null : parseLabel(nickname);
    if (nickname === undefined) throw new RoomError("invalid_display_name");
  }
  return db.transaction(async (tx) => {
    const current = await tx.query(
      "select nickname, avatar_image_id from server_members where server_id = $1 and user_id = $2 and removed_at is null for update",
      [access.server.id, actor.id],
    );
    const row = current.rows[0];
    if (!row) throw new RoomError("server_not_found");
    if (nickname !== undefined) {
      await tx.query("update server_members set nickname = $3 where server_id = $1 and user_id = $2", [access.server.id, actor.id, nickname]);
    }
    let avatarId = text(row.avatar_image_id) ?? null;
    if (input.avatar !== undefined) {
      avatarId = await replaceImage(tx, actor.id, input.avatar, async (next) => {
        await tx.query("update server_members set avatar_image_id = $3 where server_id = $1 and user_id = $2", [access.server.id, actor.id, next]);
        return text(row.avatar_image_id);
      });
    }
    return { nickname: nickname === undefined ? (text(row.nickname) ?? null) : nickname, avatarId };
  });
}

// Readable by its uploader and by anyone who shares an active server with the slot it fills. Anything else is 404.
export async function readImage(db: MigrationClient, actor: PublicUser, id: string): Promise<StoredImage> {
  if (!UUID.test(id)) throw new RoomError("image_not_found");
  const found = await db.query(
    `select i.content_type, i.bytes from images i
     where i.id = $1 and (
       i.created_by = $2
       or exists (select 1 from servers s join server_members me on me.server_id = s.id and me.user_id = $2 and me.removed_at is null where s.icon_image_id = i.id and s.deleted_at is null)
       or exists (select 1 from server_members t join server_members me on me.server_id = t.server_id and me.user_id = $2 and me.removed_at is null
                  where t.avatar_image_id = i.id and t.removed_at is null)
       or exists (select 1 from users u join server_members t on t.user_id = u.id and t.removed_at is null
                  join server_members me on me.server_id = t.server_id and me.user_id = $2 and me.removed_at is null where u.avatar_image_id = i.id)
     )`,
    [id, actor.id],
  );
  const row = found.rows[0];
  const contentType = text(row?.content_type);
  const bytes = row?.bytes;
  if (!contentType || !(bytes instanceof Uint8Array)) throw new RoomError("image_not_found");
  return { contentType, bytes };
}
