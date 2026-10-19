import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { buildApp } from "../src/app.js";
import { googleConfig, readIdToken, type GoogleTokens } from "../src/auth/google.js";
import { applyMigrations, type MigrationClient } from "../src/db/migrate.js";
import { redactInviteUrl } from "../src/invite-page.js";

const authSecret = "unit-test-auth-secret-do-not-leak";
const clientId = "client-123.apps.googleusercontent.com";
const clientSecret = "google-client-secret-do-not-leak";
const env = {
  AUTH_SECRET: authSecret,
  BOOTSTRAP_TOKEN: "unit-test-bootstrap-token",
  GOOGLE_CLIENT_ID: clientId,
  GOOGLE_CLIENT_SECRET: clientSecret,
  API_DOMAIN: "api.example.com",
};

function pgliteClient(db: PGlite): MigrationClient {
  const client: MigrationClient = {
    exec: async (statement) => {
      await db.exec(statement);
    },
    query: async (statement, params) => {
      const result = await db.query<Record<string, unknown>>(statement, params === undefined ? [] : [...params]);
      return { rows: result.rows.map((row) => ({ ...row })) };
    },
    transaction: async (run) => {
      await db.exec("begin");
      try {
        const value = await run(client);
        await db.exec("commit");
        return value;
      } catch (error) {
        await db.exec("rollback");
        throw error;
      }
    },
  };
  return client;
}

function idToken(claims: Record<string, unknown>): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "RS256" })}.${part(claims)}.signature`;
}

function claimsFor(nonce: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: "https://accounts.google.com",
    aud: clientId,
    exp: Math.floor(Date.now() / 1000) + 600,
    nonce,
    sub: "google-sub-1",
    email: "ana.silva@example.com",
    email_verified: true,
    name: "Ana Silva",
    ...extra,
  };
}

test("without both keys the instance says no and the routes are closed", async () => {
  const app = await buildApp({ logger: false, env: { AUTH_SECRET: authSecret, GOOGLE_CLIENT_ID: clientId, API_DOMAIN: "api.example.com" } });
  try {
    const card = await app.inject({ method: "GET", url: "/api/v1/instance" });
    assert.equal(card.json().googleLogin, false);
    const start = await app.inject({ method: "POST", url: "/api/v1/auth/google/start" });
    assert.equal(start.statusCode, 404);
  } finally {
    await app.close();
  }
  assert.equal(googleConfig({ ...env, GOOGLE_REDIRECT_URI: "http://api.example.com/api/v1/auth/google/callback" }), undefined);
  assert.equal(googleConfig({ ...env, GOOGLE_REDIRECT_URI: "https://api.example.com/outra" }), undefined);
  assert.equal(googleConfig({ ...env, API_DOMAIN: "api.example.com/evil" }), undefined);
  assert.equal(googleConfig(env)?.redirectUri, "https://api.example.com/api/v1/auth/google/callback");
  assert.equal(
    googleConfig({ ...env, GOOGLE_REDIRECT_URI: "http://127.0.0.1:3000/api/v1/auth/google/callback" })?.redirectUri,
    "http://127.0.0.1:3000/api/v1/auth/google/callback",
  );
});

test("the browser round trip makes a participant, shows no token, and the app collects the session once", async () => {
  const pg = new PGlite();
  const db = pgliteClient(pg);
  await applyMigrations(db);
  let nextClaims: (nonce: string) => Record<string, unknown> = (nonce) => claimsFor(nonce);
  const exchanged: { code: string; verifier: string }[] = [];
  let currentNonce = "";
  const googleTokens: GoogleTokens = {
    async exchange({ code, verifier }) {
      exchanged.push({ code, verifier });
      return { idToken: idToken(nextClaims(currentNonce)) };
    },
  };
  const app = await buildApp({ logger: false, env, db, googleTokens });
  async function begin(): Promise<{ state: string; poll: string; url: URL }> {
    const started = await app.inject({ method: "POST", url: "/api/v1/auth/google/start" });
    assert.equal(started.statusCode, 201);
    assert.equal(started.body.includes(clientSecret), false);
    const body = started.json() as { authUrl: string; poll: string };
    const url = new URL(body.authUrl);
    currentNonce = url.searchParams.get("nonce") ?? "";
    return { state: url.searchParams.get("state") ?? "", poll: body.poll, url };
  }
  try {
    const card = await app.inject({ method: "GET", url: "/api/v1/instance" });
    assert.equal(card.json().googleLogin, true);
    assert.equal(card.body.includes(clientSecret), false);

    const first = await begin();
    assert.equal(first.url.origin + first.url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
    assert.equal(first.url.searchParams.get("client_id"), clientId);
    assert.equal(first.url.searchParams.get("redirect_uri"), "https://api.example.com/api/v1/auth/google/callback");
    assert.equal(first.url.searchParams.get("code_challenge_method"), "S256");
    assert.notEqual(first.state, first.poll);
    const stored = await db.query("select state_hash, poll_hash from oauth_logins");
    assert.equal(JSON.stringify(stored.rows).includes(first.state), false);
    assert.equal(JSON.stringify(stored.rows).includes(first.poll), false);

    const early = await app.inject({ method: "POST", url: "/api/v1/auth/google/poll", payload: { poll: first.poll } });
    assert.equal(early.statusCode, 202);
    const byState = await app.inject({ method: "POST", url: "/api/v1/auth/google/poll", payload: { poll: first.state } });
    assert.equal(byState.statusCode, 401);

    const back = await app.inject({ method: "GET", url: `/api/v1/auth/google/callback?state=${first.state}&code=google-code-1` });
    assert.equal(back.statusCode, 200);
    assert.match(String(back.headers["content-type"]), /^text\/html/);
    assert.equal(back.headers["cache-control"], "no-store");
    assert.equal(back.body.includes("Pode voltar ao OpenMeet"), true);
    assert.equal(back.body.includes("eyJ"), false);
    assert.equal(back.body.includes("<script"), false);
    assert.equal(exchanged[0]?.code, "google-code-1");
    assert.equal(exchanged[0]?.verifier.length, 43);
    const replay = await app.inject({ method: "GET", url: `/api/v1/auth/google/callback?state=${first.state}&code=google-code-1` });
    assert.equal(replay.statusCode, 400);
    assert.equal(exchanged.length, 1);

    const done = await app.inject({ method: "POST", url: "/api/v1/auth/google/poll", payload: { poll: first.poll } });
    assert.equal(done.statusCode, 200);
    const session = done.json() as { accessToken: string; refreshToken: string; user: { id: string; username: string; displayName: string; role: string } };
    assert.equal(session.user.role, "participant");
    assert.equal(session.user.username, "anasilva");
    assert.equal(session.user.displayName, "Ana Silva");
    const again = await app.inject({ method: "POST", url: "/api/v1/auth/google/poll", payload: { poll: first.poll } });
    assert.equal(again.statusCode, 401);
    const me = await app.inject({ method: "GET", url: "/api/v1/auth/me", headers: { authorization: `Bearer ${session.accessToken}` } });
    assert.equal(me.statusCode, 200);
    const servers = await db.query("select count(*)::int as n from server_members where user_id = $1", [session.user.id]);
    assert.equal(servers.rows[0]?.n, 0);
    const passwordLogin = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "anasilva", password: "" } });
    assert.equal(passwordLogin.statusCode, 401);

    const second = await begin();
    await app.inject({ method: "GET", url: `/api/v1/auth/google/callback?state=${second.state}&code=google-code-2` });
    const sameUser = await app.inject({ method: "POST", url: "/api/v1/auth/google/poll", payload: { poll: second.poll } });
    assert.equal((sameUser.json() as { user: { id: string } }).user.id, session.user.id);
    const accounts = await db.query("select count(*)::int as n from users");
    assert.equal(accounts.rows[0]?.n, 1);

    for (const [label, claims] of [
      ["audience", (nonce: string) => claimsFor(nonce, { aud: "someone-else" })],
      ["issuer", (nonce: string) => claimsFor(nonce, { iss: "https://evil.example" })],
      ["unverified", (nonce: string) => claimsFor(nonce, { email_verified: false })],
      ["nonce", () => claimsFor("other-nonce")],
      ["expired", (nonce: string) => claimsFor(nonce, { exp: 1 })],
    ] as const) {
      nextClaims = claims;
      const attempt = await begin();
      const page = await app.inject({ method: "GET", url: `/api/v1/auth/google/callback?state=${attempt.state}&code=c` });
      assert.equal(page.statusCode, 400, label);
      const refused = await app.inject({ method: "POST", url: "/api/v1/auth/google/poll", payload: { poll: attempt.poll } });
      assert.equal(refused.statusCode, 403, label);
      assert.equal(refused.json().error, "google_failed", label);
    }
    nextClaims = (nonce) => claimsFor(nonce);

    const denied = await begin();
    await app.inject({ method: "GET", url: `/api/v1/auth/google/callback?state=${denied.state}&error=access_denied` });
    const deniedPoll = await app.inject({ method: "POST", url: "/api/v1/auth/google/poll", payload: { poll: denied.poll } });
    assert.equal(deniedPoll.json().error, "google_denied");

    await db.query("update users set disabled_at = now() where id = $1", [session.user.id]);
    const disabled = await begin();
    await app.inject({ method: "GET", url: `/api/v1/auth/google/callback?state=${disabled.state}&code=c` });
    const disabledPoll = await app.inject({ method: "POST", url: "/api/v1/auth/google/poll", payload: { poll: disabled.poll } });
    assert.equal(disabledPoll.json().error, "account_disabled");

    const unknown = await app.inject({ method: "GET", url: "/api/v1/auth/google/callback?state=nada&code=c" });
    assert.equal(unknown.statusCode, 400);
    await db.query("update oauth_logins set expires_at = now() - interval '1 second'");
    const stale = await begin();
    await db.query("update oauth_logins set expires_at = now() - interval '1 second'");
    const late = await app.inject({ method: "GET", url: `/api/v1/auth/google/callback?state=${stale.state}&code=c` });
    assert.equal(late.statusCode, 400);
  } finally {
    await app.close();
    await pg.close();
  }
});

test("a second Google account with the same e-mail name gets its own username", async () => {
  const pg = new PGlite();
  const db = pgliteClient(pg);
  await applyMigrations(db);
  let sub = "a";
  let nonce = "";
  const app = await buildApp({
    logger: false,
    env,
    db,
    googleTokens: { exchange: async () => ({ idToken: idToken(claimsFor(nonce, { sub, name: "‮Ana\u0007" })) }) },
  });
  try {
    const names: string[] = [];
    for (const next of ["a", "b"]) {
      sub = next;
      const started = (await app.inject({ method: "POST", url: "/api/v1/auth/google/start" })).json() as { authUrl: string; poll: string };
      const url = new URL(started.authUrl);
      nonce = url.searchParams.get("nonce") ?? "";
      await app.inject({ method: "GET", url: `/api/v1/auth/google/callback?state=${url.searchParams.get("state")}&code=c` });
      const done = (await app.inject({ method: "POST", url: "/api/v1/auth/google/poll", payload: { poll: started.poll } })).json() as {
        user: { username: string; displayName: string };
      };
      names.push(done.user.username);
      assert.equal(done.user.displayName, "Ana");
    }
    assert.deepEqual(names, ["anasilva", "anasilva-2"]);
  } finally {
    await app.close();
    await pg.close();
  }
});

test("claims are checked one by one and the callback query is not logged", () => {
  const config = { clientId, clientSecret, redirectUri: "https://api.example.com/api/v1/auth/google/callback" };
  assert.equal(readIdToken(idToken(claimsFor("n")), config, "n", Math.floor(Date.now() / 1000)).subject, "google-sub-1");
  assert.throws(() => readIdToken("not-a-jwt", config, "n", 0));
  assert.throws(() => readIdToken(idToken(claimsFor("n", { email: 3 })), config, "n", 0));
  assert.equal(redactInviteUrl("/api/v1/auth/google/callback?state=abc&code=xyz"), "/api/v1/auth/google/callback?[redacted]");
});
