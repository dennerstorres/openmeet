import { createHash, randomBytes } from "node:crypto";
import type { MigrationClient } from "../db/migrate.js";
import type { AppEnv } from "../poc-join.js";
import { hashPassword } from "./password.js";
import { AuthError, startSessionFor, type SessionBody } from "./service.js";
import { hashSecret } from "./tokens.js";

// ADR 0010. The app opens the system browser; Google returns to the API; the app then
// collects the session once with a poll secret that never went through the browser.

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);
const LOGIN_MINUTES = 10;
const SECRET = /^[A-Za-z0-9_-]{43}$/;
const DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/** Exchanges the authorization code at Google's token endpoint. Tests replace it. */
export interface GoogleTokens {
  exchange(input: { code: string; verifier: string; config: GoogleConfig }): Promise<{ idToken: string }>;
}

export type GoogleFailure = "google_denied" | "google_failed" | "account_disabled";

export interface GoogleIdentity {
  subject: string;
  email: string;
  name: string | undefined;
}

/**
 * Both keys must be in the server environment. The callback address comes from configuration,
 * never from the request: GOOGLE_REDIRECT_URI, or the API domain the stack already serves.
 */
export function googleConfig(env: AppEnv): GoogleConfig | undefined {
  const clientId = (env.GOOGLE_CLIENT_ID ?? "").trim();
  const clientSecret = (env.GOOGLE_CLIENT_SECRET ?? "").trim();
  if (clientId.length === 0 || clientSecret.length === 0) return undefined;
  const redirectUri = callbackUri(env);
  if (redirectUri === undefined) return undefined;
  return { clientId, clientSecret, redirectUri };
}

function callbackUri(env: AppEnv): string | undefined {
  const explicit = (env.GOOGLE_REDIRECT_URI ?? "").trim();
  if (explicit.length > 0) {
    try {
      const url = new URL(explicit);
      const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost";
      if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) || url.pathname !== "/api/v1/auth/google/callback") return undefined;
      if (url.search !== "" || url.hash !== "" || url.username !== "" || url.password !== "") return undefined;
      return url.toString();
    } catch {
      return undefined;
    }
  }
  const domain = (env.API_DOMAIN ?? "").trim().toLowerCase();
  return DOMAIN.test(domain) ? `https://${domain}/api/v1/auth/google/callback` : undefined;
}

export const liveGoogleTokens: GoogleTokens = {
  async exchange({ code, verifier, config }) {
    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.redirectUri,
        grant_type: "authorization_code",
        code_verifier: verifier,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`google token endpoint ${response.status}`);
    const body = (await response.json()) as Record<string, unknown>;
    if (typeof body.id_token !== "string") throw new Error("google token response without id_token");
    return { idToken: body.id_token };
  },
};

function secretValue(): string {
  return randomBytes(32).toString("base64url");
}

export async function startGoogleLogin(db: MigrationClient, config: GoogleConfig): Promise<{ authUrl: string; poll: string; expiresIn: number }> {
  const state = secretValue();
  const poll = secretValue();
  const verifier = secretValue();
  const nonce = secretValue();
  await db.query("delete from oauth_logins where expires_at < now() - interval '1 day'");
  await db.query(
    `insert into oauth_logins (state_hash, poll_hash, pkce_verifier, nonce, expires_at)
     values ($1, $2, $3, $4, now() + ($5 * interval '1 minute'))`,
    [hashSecret(state), hashSecret(poll), verifier, nonce, LOGIN_MINUTES],
  );
  const url = new URL(AUTHORIZE_URL);
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    nonce,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  return { authUrl: url.toString(), poll, expiresIn: LOGIN_MINUTES * 60 };
}

/**
 * The id_token comes straight from Google's token endpoint over TLS, which OpenID Connect
 * Core 3.1.3.7 accepts in place of a signature check. The claims are still checked one by one.
 */
export function readIdToken(idToken: string, config: GoogleConfig, nonce: string, nowSeconds: number): GoogleIdentity {
  const parts = idToken.split(".");
  if (parts.length !== 3 || parts[1] === undefined) throw new Error("malformed id_token");
  const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Record<string, unknown>;
  const audience = claims.aud;
  const audienceOk = audience === config.clientId || (Array.isArray(audience) && audience.length === 1 && audience[0] === config.clientId);
  if (typeof claims.iss !== "string" || !ISSUERS.has(claims.iss)) throw new Error("issuer");
  if (!audienceOk) throw new Error("audience");
  if (typeof claims.exp !== "number" || claims.exp <= nowSeconds) throw new Error("expired");
  if (claims.nonce !== nonce) throw new Error("nonce");
  if (claims.email_verified !== true) throw new Error("email not verified");
  if (typeof claims.sub !== "string" || claims.sub.length < 1 || claims.sub.length > 255) throw new Error("subject");
  if (typeof claims.email !== "string" || claims.email.length > 254 || !claims.email.includes("@")) throw new Error("email");
  return { subject: claims.sub, email: claims.email, name: typeof claims.name === "string" ? claims.name : undefined };
}

/** Google never decides whether the page succeeded: every outcome is a plain message with no token. */
export async function finishGoogleLogin(
  db: MigrationClient,
  config: GoogleConfig,
  tokens: GoogleTokens,
  query: { state: string | undefined; code: string | undefined; error: string | undefined },
): Promise<"done" | GoogleFailure | "expired"> {
  if (query.state === undefined || !SECRET.test(query.state)) return "expired";
  const found = await db.query(
    `update oauth_logins set completed_at = now()
     where state_hash = $1 and completed_at is null and expires_at > now()
     returning id, pkce_verifier, nonce`,
    [hashSecret(query.state)],
  );
  const row = found.rows[0];
  const loginId = typeof row?.id === "string" ? row.id : undefined;
  if (!loginId || typeof row?.pkce_verifier !== "string" || typeof row?.nonce !== "string") return "expired";
  const fail = async (failure: GoogleFailure) => {
    await db.query("update oauth_logins set failure = $1 where id = $2", [failure, loginId]);
    return failure;
  };
  if (query.error !== undefined || query.code === undefined || query.code.length === 0 || query.code.length > 2048) return fail("google_denied");
  let identity: GoogleIdentity;
  try {
    const { idToken } = await tokens.exchange({ code: query.code, verifier: row.pkce_verifier, config });
    identity = readIdToken(idToken, config, row.nonce, Math.floor(Date.now() / 1000));
  } catch {
    return fail("google_failed");
  }
  const userId = await accountFor(db, identity);
  if (userId === undefined) return fail("account_disabled");
  await db.query("update oauth_logins set user_id = $1 where id = $2", [userId, loginId]);
  return "done";
}

/** The first Google sign-in makes a participant. Never an admin, never a member of any server. */
async function accountFor(db: MigrationClient, identity: GoogleIdentity): Promise<string | undefined> {
  const known = await db.query(
    `select u.id, u.disabled_at is not null as disabled
     from user_identities i join users u on u.id = i.user_id
     where i.provider = 'google' and i.subject = $1`,
    [identity.subject],
  );
  const existing = known.rows[0];
  if (existing) {
    const disabled = existing.disabled === true || existing.disabled === "t";
    return disabled || typeof existing.id !== "string" ? undefined : existing.id;
  }
  const displayName = cleanName(identity.name) ?? cleanName(identity.email.split("@")[0]) ?? "Participante";
  // A random password nobody knows: the account has no usable password until an admin sets one.
  const passwordHash = await hashPassword(secretValue());
  const base = usernameBase(identity.email);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const username = attempt === 0 ? base : `${base.slice(0, 56)}-${attempt + 1}`;
    try {
      return await db.transaction(async (tx) => {
        const created = await tx.query("insert into users (username, password_hash, display_name, role) values ($1, $2, $3, 'participant') returning id", [
          username,
          passwordHash,
          displayName,
        ]);
        const id = String(created.rows[0]?.id ?? "");
        await tx.query("insert into user_identities (provider, subject, user_id, email) values ('google', $1, $2, $3)", [identity.subject, id, identity.email]);
        await tx.query("insert into audit_events (actor_user_id, action, target_type, target_id) values ($1, 'google_signup', 'user', $1)", [id]);
        return id;
      });
    } catch (error) {
      const state = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
      if (state !== "23505") throw error;
      const raced = await db.query("select user_id from user_identities where provider = 'google' and subject = $1", [identity.subject]);
      if (typeof raced.rows[0]?.user_id === "string") return raced.rows[0].user_id;
    }
  }
  throw new AuthError("invalid_credentials");
}

function usernameBase(email: string): string {
  const local = (email.split("@")[0] ?? "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 60);
  return local.length > 0 ? local : `google-${randomBytes(4).toString("hex")}`;
}

// C0, C1, line and paragraph separators, and bidi controls never reach a display name.
function hiddenCharacter(code: number): boolean {
  return (
    code <= 0x1f ||
    (code >= 0x7f && code <= 0x9f) ||
    code === 0x2028 ||
    code === 0x2029 ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069)
  );
}

function cleanName(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const name = [...value]
    .filter((char) => !hiddenCharacter(char.codePointAt(0) ?? 0))
    .join("")
    .trim();
  return name.length >= 1 && name.length <= 80 ? name : undefined;
}

export type PollResult = { status: "pending" } | { status: "failed"; failure: GoogleFailure } | { status: "done"; session: SessionBody };

/** The app collects the session once. The poll secret is the only key; the state is not enough. */
export async function pollGoogleLogin(db: MigrationClient, secret: string, poll: string): Promise<PollResult> {
  if (!SECRET.test(poll)) throw new AuthError("invalid_session");
  return db.transaction(async (tx) => {
    const found = await tx.query(
      `select id, user_id, failure, completed_at is not null as completed
       from oauth_logins
       where poll_hash = $1 and consumed_at is null and expires_at > now()
       for update`,
      [hashSecret(poll)],
    );
    const row = found.rows[0];
    if (!row || typeof row.id !== "string") throw new AuthError("invalid_session");
    if (typeof row.failure === "string") {
      await tx.query("update oauth_logins set consumed_at = now() where id = $1", [row.id]);
      return { status: "failed", failure: row.failure as GoogleFailure };
    }
    if (typeof row.user_id !== "string") return { status: "pending" };
    await tx.query("update oauth_logins set consumed_at = now() where id = $1", [row.id]);
    return { status: "done", session: await startSessionFor(tx, secret, row.user_id, "google_login") };
  });
}
