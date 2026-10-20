import { randomUUID } from "node:crypto";
import { parseLabel } from "@openmeet/shared";
import type { RoomMedia } from "../rooms/media.js";
import { heldRooms, releaseHold } from "./media-hold.js";
import type { MigrationClient } from "../db/migrate.js";
import { hashPassword, verifyPassword } from "./password.js";
import { ACCESS_TOKEN_TTL_SECONDS, hashSecret, newRefreshToken, readAccessToken, secretsMatch, signAccessToken } from "./tokens.js";

export type AuthErrorCode =
  | "auth_unconfigured"
  | "invalid_body"
  | "invalid_username"
  | "invalid_display_name"
  | "weak_password"
  | "bootstrap_rejected"
  | "bootstrap_closed"
  | "invalid_credentials"
  | "invalid_session"
  | "unauthorized"
  | "rate_limited"
  | "media_disconnect_failed"
  | "proxy_rejected"
  | "origin_rejected";

export class AuthError extends Error {
  readonly code: AuthErrorCode;

  constructor(code: AuthErrorCode) {
    super(code);
    this.name = "AuthError";
    this.code = code;
  }
}

export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  role: string;
}

export interface SessionBody {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: PublicUser;
}

const USERNAME = /^[A-Za-z0-9_-]{1,64}$/;
const ROLES = new Set(["admin", "moderator", "participant"]);

interface StoredUser extends PublicUser {
  passwordHash: string;
  disabled: boolean;
}

function isTrue(value: unknown): boolean {
  return value === true || value === "t" || value === "true" || value === 1;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function parseUsername(value: string): string {
  if (!USERNAME.test(value)) throw new AuthError("invalid_username");
  return value;
}

function parseDisplayName(value: string): string {
  const name = parseLabel(value);
  if (name === undefined) throw new AuthError("invalid_display_name");
  return name;
}

function parsePassword(value: string): string {
  if (value.length < 12 || value.length > 128) throw new AuthError("weak_password");
  return value;
}

function publicUser(user: StoredUser): PublicUser {
  return { id: user.id, username: user.username, displayName: user.displayName, role: user.role };
}

function readUser(row: Record<string, unknown> | undefined): StoredUser | undefined {
  if (!row) return undefined;
  const id = text(row.id);
  const username = text(row.username);
  const displayName = text(row.display_name);
  const role = text(row.role);
  const passwordHash = text(row.password_hash);
  if (!id || !username || !displayName || !role || !passwordHash || !ROLES.has(role)) return undefined;
  return { id, username, displayName, role, passwordHash, disabled: isTrue(row.disabled) };
}

async function findUser(db: MigrationClient, username: string): Promise<StoredUser | undefined> {
  const found = await db.query(
    `select id, username, display_name, role, password_hash, disabled_at is not null as disabled
     from users where username = $1`,
    [username],
  );
  return readUser(found.rows[0]);
}

async function findUserById(db: MigrationClient, id: string): Promise<StoredUser | undefined> {
  const found = await db.query(
    `select id, username, display_name, role, password_hash, disabled_at is not null as disabled
     from users where id = $1`,
    [id],
  );
  return readUser(found.rows[0]);
}

let dummyHash: Promise<string> | undefined;

function dummyPasswordHash(): Promise<string> {
  dummyHash ??= hashPassword("openmeet-dummy-password");
  return dummyHash;
}

async function audit(db: MigrationClient, actorId: string, action: string): Promise<void> {
  await db.query("insert into audit_events (actor_user_id, action, target_type, target_id) values ($1, $2, 'user', $1)", [actorId, action]);
}

// A login starts a family named by its own id. A refresh stays in the family of the session it replaces (S-03).
async function startSession(
  db: MigrationClient,
  secret: string,
  user: StoredUser,
  replaces: { id: string; familyId: string } | undefined,
  action: string,
): Promise<SessionBody> {
  const refreshToken = newRefreshToken();
  const id = randomUUID();
  const inserted = await db.query(
    "insert into refresh_sessions (id, user_id, token_hash, expires_at, family_id) values ($1, $2, $3, now() + interval '30 days', $4) returning id",
    [id, user.id, hashSecret(refreshToken), replaces?.familyId ?? id],
  );
  const sessionId = text(inserted.rows[0]?.id);
  if (!sessionId) throw new AuthError("unauthorized");
  if (replaces) {
    const revoked = await db.query("update refresh_sessions set revoked_at = now(), replaced_by = $1 where id = $2 and revoked_at is null returning id", [
      sessionId,
      replaces.id,
    ]);
    if (revoked.rows.length !== 1) throw new AuthError("invalid_session");
  }
  await audit(db, user.id, action);
  return {
    accessToken: signAccessToken(secret, user.id, sessionId),
    refreshToken,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    user: publicUser(user),
  };
}

/** Starts a session for an account found some other way (ADR 0010). Run it inside the caller transaction. */
export async function startSessionFor(db: MigrationClient, secret: string, userId: string, action: string): Promise<SessionBody> {
  const user = await findUserById(db, userId);
  if (!user || user.disabled) throw new AuthError("invalid_credentials");
  return startSession(db, secret, user, undefined, action);
}

/** S-12: once closed, the bootstrap never looks at a token again, so its answer confirms nothing. */
export async function bootstrapClosed(db: MigrationClient): Promise<boolean> {
  const settings = await db.query("select bootstrap_completed from instance_settings where id = 1");
  return isTrue(settings.rows[0]?.bootstrap_completed);
}

export async function bootstrapAdmin(
  db: MigrationClient,
  secret: string,
  expectedToken: string,
  input: { token: string; username: string; password: string; displayName: string },
  allow: (() => boolean) | undefined = undefined,
): Promise<SessionBody> {
  const username = parseUsername(input.username);
  const displayName = parseDisplayName(input.displayName);
  const password = parsePassword(input.password);
  if (allow && !allow()) throw new AuthError("rate_limited");
  if (!secretsMatch(input.token, expectedToken)) throw new AuthError("bootstrap_rejected");
  const passwordHash = await hashPassword(password);
  try {
    return await db.transaction(async (tx) => {
      const settings = await tx.query("select bootstrap_completed from instance_settings where id = 1 for update");
      if (isTrue(settings.rows[0]?.bootstrap_completed)) throw new AuthError("bootstrap_closed");
      const inserted = await tx.query("insert into users (username, password_hash, display_name, role) values ($1, $2, $3, 'admin') returning id", [
        username,
        passwordHash,
        displayName,
      ]);
      const id = text(inserted.rows[0]?.id);
      if (!id) throw new AuthError("bootstrap_closed");
      await tx.query("insert into bootstrap_tokens (token_hash, expires_at, used_at) values ($1, now(), now())", [hashSecret(input.token)]);
      await tx.query("update instance_settings set bootstrap_completed = true, updated_at = now() where id = 1");
      const user = await findUserById(tx, id);
      if (!user) throw new AuthError("bootstrap_closed");
      return startSession(tx, secret, user, undefined, "bootstrap");
    });
  } catch (error) {
    if (error instanceof AuthError) throw error;
    if (sqlState(error) === "23505") throw new AuthError("bootstrap_closed");
    throw error;
  }
}

function sqlState(error: unknown): string {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : "";
}

export async function login(
  db: MigrationClient,
  secret: string,
  usernameInput: string,
  password: string,
  allow: (() => boolean) | undefined = undefined,
): Promise<SessionBody> {
  const username = parseUsername(usernameInput);
  if (password.length === 0 || password.length > 128) throw new AuthError("invalid_credentials");
  if (allow && !allow()) throw new AuthError("rate_limited");
  const existing = await findUser(db, username);
  const encoded = existing?.passwordHash ?? (await dummyPasswordHash());
  const matches = await verifyPassword(encoded, password);
  if (!existing || existing.disabled || !matches) throw new AuthError("invalid_credentials");
  return db.transaction(async (tx) => {
    const user = await findUserById(tx, existing.id);
    if (!user || user.disabled) throw new AuthError("invalid_credentials");
    return startSession(tx, secret, user, undefined, "login");
  });
}

export async function refreshSession(
  db: MigrationClient,
  secret: string,
  refreshToken: string,
  allow: ((tokenKey: string) => boolean) | undefined = undefined,
): Promise<SessionBody> {
  if (refreshToken.length < 32) throw new AuthError("invalid_session");
  if (allow && !allow(hashSecret(refreshToken))) throw new AuthError("rate_limited");
  // The family revocation must commit, so reuse is reported after the transaction instead of thrown inside it.
  const result = await db.transaction(async (tx): Promise<SessionBody | "reused" | "invalid"> => {
    const found = await tx.query("select family_id from refresh_sessions where token_hash = $1", [hashSecret(refreshToken)]);
    const familyId = text(found.rows[0]?.family_id);
    if (!familyId) return "invalid";
    // Every row of the family is locked in a fixed order, so two refreshes of one family run one after the other.
    await tx.query("select id from refresh_sessions where family_id = $1 order by id for update", [familyId]);
    const locked = await tx.query(
      `select id, user_id, replaced_by, revoked_at is not null as revoked, expires_at <= now() as expired
       from refresh_sessions where token_hash = $1`,
      [hashSecret(refreshToken)],
    );
    const row = locked.rows[0];
    const sessionId = text(row?.id);
    const userId = text(row?.user_id);
    if (!row || !sessionId || !userId) return "invalid";
    if (text(row.replaced_by)) {
      await tx.query("update refresh_sessions set revoked_at = now() where family_id = $1 and revoked_at is null", [familyId]);
      await audit(tx, userId, "refresh_reuse");
      return "reused";
    }
    // Logout and expiry are not reuse: nothing else is touched.
    if (isTrue(row.revoked) || isTrue(row.expired)) return "invalid";
    const user = await findUserById(tx, userId);
    if (!user || user.disabled) return "invalid";
    return startSession(tx, secret, user, { id: sessionId, familyId }, "refresh");
  });
  if (result === "reused" || result === "invalid") throw new AuthError("invalid_session");
  return result;
}

// S-18: logout revokes only the presented family, then cuts the account from every open room.
// livekit_hold stops new room tokens until the SFU confirms. With no open room it is lowered in the same commit.
// An already revoked refresh repeats the cut only while the hold is still on.
export async function logout(db: MigrationClient, refreshToken: string, media: RoomMedia | undefined = undefined): Promise<void> {
  if (refreshToken.length < 32) return;
  const tokenHash = hashSecret(refreshToken);
  const pending = await db.transaction(async (tx) => {
    const found = await tx.query("select user_id from refresh_sessions where token_hash = $1", [tokenHash]);
    const userId = text(found.rows[0]?.user_id);
    if (!userId) return undefined;
    const user = await tx.query("select livekit_hold from users where id = $1 for update", [userId]);
    const revoked = await tx.query("update refresh_sessions set revoked_at = now() where token_hash = $1 and revoked_at is null returning id", [tokenHash]);
    if (revoked.rows.length === 1) await audit(tx, userId, "logout");
    else if (!isTrue(user.rows[0]?.livekit_hold)) return undefined;
    const rooms = await heldRooms(tx, userId);
    await tx.query("update users set livekit_hold = $2 where id = $1", [userId, rooms.length > 0]);
    return rooms.length > 0 ? { userId, rooms } : undefined;
  });
  if (pending && !(await releaseHold(db, pending.userId, media, pending.rooms))) throw new AuthError("media_disconnect_failed");
}

// S-02: the current password is required, every family of the account is revoked, and only the caller gets a new session.
export async function changePassword(
  db: MigrationClient,
  secret: string,
  accessToken: string,
  input: { currentPassword: string; newPassword: string },
  allow: (() => boolean) | undefined = undefined,
): Promise<SessionBody> {
  const actor = await currentUser(db, secret, accessToken);
  const password = parsePassword(input.newPassword);
  if (input.currentPassword.length === 0 || input.currentPassword.length > 128) throw new AuthError("invalid_credentials");
  if (allow && !allow()) throw new AuthError("rate_limited");
  const stored = await findUserById(db, actor.id);
  if (!stored || stored.disabled || !(await verifyPassword(stored.passwordHash, input.currentPassword))) throw new AuthError("invalid_credentials");
  const passwordHash = await hashPassword(password);
  return db.transaction(async (tx) => {
    await tx.query("select id from users where id = $1 for update", [actor.id]);
    await tx.query("update users set password_hash = $2, updated_at = now() where id = $1", [actor.id, passwordHash]);
    await tx.query("update refresh_sessions set revoked_at = now() where user_id = $1 and revoked_at is null", [actor.id]);
    const user = await findUserById(tx, actor.id);
    if (!user || user.disabled) throw new AuthError("invalid_credentials");
    return startSession(tx, secret, user, undefined, "password_change");
  });
}

export async function currentUser(db: MigrationClient, secret: string, accessToken: string): Promise<PublicUser> {
  const claims = readAccessToken(secret, accessToken);
  if (!claims) throw new AuthError("unauthorized");
  const found = await db.query(
    `select revoked_at is not null as revoked, expires_at <= now() as expired
     from refresh_sessions where id = $1 and user_id = $2`,
    [claims.sessionId, claims.userId],
  );
  const row = found.rows[0];
  if (!row || isTrue(row.revoked) || isTrue(row.expired)) throw new AuthError("unauthorized");
  const user = await findUserById(db, claims.userId);
  if (!user || user.disabled) throw new AuthError("unauthorized");
  return publicUser(user);
}
