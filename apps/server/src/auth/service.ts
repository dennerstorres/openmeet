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
  | "rate_limited";

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
  const name = value.trim();
  if (name.length < 1 || name.length > 80) throw new AuthError("invalid_display_name");
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

async function startSession(db: MigrationClient, secret: string, user: StoredUser, replaces: string | undefined, action: string): Promise<SessionBody> {
  const refreshToken = newRefreshToken();
  const inserted = await db.query("insert into refresh_sessions (user_id, token_hash, expires_at) values ($1, $2, now() + interval '30 days') returning id", [
    user.id,
    hashSecret(refreshToken),
  ]);
  const sessionId = text(inserted.rows[0]?.id);
  if (!sessionId) throw new AuthError("unauthorized");
  if (replaces) {
    const revoked = await db.query("update refresh_sessions set revoked_at = now(), replaced_by = $1 where id = $2 and revoked_at is null returning id", [
      sessionId,
      replaces,
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

export async function refreshSession(db: MigrationClient, secret: string, refreshToken: string): Promise<SessionBody> {
  if (refreshToken.length < 32) throw new AuthError("invalid_session");
  return db.transaction(async (tx) => {
    const found = await tx.query(
      `select id, user_id, revoked_at is not null as revoked, expires_at <= now() as expired
       from refresh_sessions where token_hash = $1 for update`,
      [hashSecret(refreshToken)],
    );
    const row = found.rows[0];
    const sessionId = text(row?.id);
    const userId = text(row?.user_id);
    if (!row || !sessionId || !userId || isTrue(row.revoked) || isTrue(row.expired)) throw new AuthError("invalid_session");
    const user = await findUserById(tx, userId);
    if (!user || user.disabled) throw new AuthError("invalid_session");
    return startSession(tx, secret, user, sessionId, "refresh");
  });
}

export async function logout(db: MigrationClient, refreshToken: string): Promise<void> {
  if (refreshToken.length < 32) return;
  await db.transaction(async (tx) => {
    const revoked = await tx.query("update refresh_sessions set revoked_at = now() where token_hash = $1 and revoked_at is null returning user_id", [
      hashSecret(refreshToken),
    ]);
    const actorId = text(revoked.rows[0]?.user_id);
    if (actorId) await audit(tx, actorId, "logout");
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
