import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { buildApp } from "../src/app.js";
import { applyMigrations, type MigrationClient } from "../src/db/migrate.js";
import { hashSecret } from "../src/auth/tokens.js";
import { signAccessToken } from "../src/auth/tokens.js";

const bootstrapToken = "unit-test-bootstrap-token";
const authSecret = "unit-test-auth-secret-do-not-leak";
const password = "correct-horse-battery";

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

test("auth stays unconfigured until a database and secrets exist", async () => {
  const app = await buildApp({ logger: false });
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/bootstrap",
    payload: { token: bootstrapToken, username: "admin", password, displayName: "Admin" },
  });
  assert.equal(response.statusCode, 503);
  assert.equal(response.json().error, "auth_unconfigured");
  assert.equal(response.body.includes(bootstrapToken), false);
  assert.equal(response.body.includes(password), false);
  const ready = await app.inject({ method: "GET", url: "/health/ready" });
  assert.deepEqual(ready.json(), { status: "ok", checks: { database: "not_configured" } });
  await app.close();
});

test("bootstrap, login, refresh and logout keep only hashes", async () => {
  const pg = new PGlite();
  const db = pgliteClient(pg);
  await applyMigrations(db);
  const app = await buildApp({
    logger: false,
    env: { AUTH_SECRET: authSecret, BOOTSTRAP_TOKEN: bootstrapToken },
    db,
  });
  try {
    const ready = await app.inject({ method: "GET", url: "/health/ready" });
    assert.equal(ready.json().checks.database, "ok");

    const rejected = await app.inject({
      method: "POST",
      url: "/api/v1/auth/bootstrap",
      payload: { token: "wrong-bootstrap-token-value", username: "admin", password, displayName: "Admin" },
    });
    assert.equal(rejected.statusCode, 401);
    assert.equal(rejected.json().error, "bootstrap_rejected");

    const weak = await app.inject({
      method: "POST",
      url: "/api/v1/auth/bootstrap",
      payload: { token: bootstrapToken, username: "admin", password: "short", displayName: "Admin" },
    });
    assert.equal(weak.statusCode, 400);

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/auth/bootstrap",
      payload: { token: bootstrapToken, username: "admin", password, displayName: "Admin" },
    });
    assert.equal(created.statusCode, 201);
    const session = created.json() as { accessToken: string; refreshToken: string; expiresIn: number; user: { role: string } };
    assert.equal(session.user.role, "admin");
    assert.equal(session.expiresIn, 900);
    assert.equal(created.body.includes(password), false);
    assert.equal(created.body.includes(bootstrapToken), false);

    const closed = await app.inject({
      method: "POST",
      url: "/api/v1/auth/bootstrap",
      payload: { token: bootstrapToken, username: "other", password, displayName: "Other" },
    });
    assert.equal(closed.statusCode, 409);

    const stored = await db.query("select password_hash from users where username = 'admin'");
    const passwordHash = stored.rows[0]?.password_hash;
    assert.equal(typeof passwordHash, "string");
    assert.equal(String(passwordHash).startsWith("$argon2id$"), true);
    assert.equal(String(passwordHash).includes("m=19456,t=2,p=1"), true);
    assert.equal(passwordHash === password, false);

    const hashes = await db.query("select token_hash from refresh_sessions");
    assert.equal(
      hashes.rows.some((row) => row.token_hash === session.refreshToken),
      false,
    );
    assert.equal(
      hashes.rows.some((row) => row.token_hash === hashSecret(session.refreshToken)),
      true,
    );
    const install = await db.query("select token_hash from bootstrap_tokens");
    assert.equal(install.rows[0]?.token_hash, hashSecret(bootstrapToken));

    const me = await app.inject({ method: "GET", url: "/api/v1/auth/me", headers: { authorization: `Bearer ${session.accessToken}` } });
    assert.equal(me.statusCode, 200);
    assert.equal(me.json().username, "admin");
    const anonymous = await app.inject({ method: "GET", url: "/api/v1/auth/me" });
    assert.equal(anonymous.statusCode, 401);
    const missingSession = "00000000-0000-4000-8000-000000000001";
    const expired = signAccessToken(authSecret, me.json().id as string, missingSession, Date.now() - 16 * 60 * 1000);
    const stale = await app.inject({ method: "GET", url: "/api/v1/auth/me", headers: { authorization: `Bearer ${expired}` } });
    assert.equal(stale.statusCode, 401);

    const badLogin = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: "wrong-password-value" } });
    assert.equal(badLogin.statusCode, 401);
    assert.equal(badLogin.body.includes(password), false);
    const loggedIn = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password } });
    assert.equal(loggedIn.statusCode, 200);
    const second = loggedIn.json() as { refreshToken: string; accessToken: string };

    const rotated = await app.inject({ method: "POST", url: "/api/v1/auth/refresh", payload: { refreshToken: second.refreshToken } });
    assert.equal(rotated.statusCode, 200);
    const third = rotated.json() as { refreshToken: string; accessToken: string };
    const rotatedAccess = await app.inject({ method: "GET", url: "/api/v1/auth/me", headers: { authorization: `Bearer ${second.accessToken}` } });
    assert.equal(rotatedAccess.statusCode, 401);
    const reused = await app.inject({ method: "POST", url: "/api/v1/auth/refresh", payload: { refreshToken: second.refreshToken } });
    assert.equal(reused.statusCode, 401);
    const old = await db.query("select revoked_at is not null as revoked, replaced_by from refresh_sessions where token_hash = $1", [
      hashSecret(second.refreshToken),
    ]);
    assert.equal(old.rows[0]?.revoked === true || old.rows[0]?.revoked === "t", true);
    assert.equal(typeof old.rows[0]?.replaced_by, "string");
    // S-03: presenting the replaced token again takes the replacement down with it.
    const replacement = await app.inject({ method: "POST", url: "/api/v1/auth/refresh", payload: { refreshToken: third.refreshToken } });
    assert.equal(replacement.statusCode, 401);
    const replacementAccess = await app.inject({ method: "GET", url: "/api/v1/auth/me", headers: { authorization: `Bearer ${third.accessToken}` } });
    assert.equal(replacementAccess.statusCode, 401);

    const gone = await app.inject({ method: "POST", url: "/api/v1/auth/logout", payload: { refreshToken: third.refreshToken } });
    assert.equal(gone.statusCode, 204);
    const afterLogout = await app.inject({ method: "POST", url: "/api/v1/auth/refresh", payload: { refreshToken: third.refreshToken } });
    assert.equal(afterLogout.statusCode, 401);

    const accessAfterLogout = await app.inject({ method: "GET", url: "/api/v1/auth/me", headers: { authorization: `Bearer ${third.accessToken}` } });
    assert.equal(accessAfterLogout.statusCode, 401);
    const otherSession = await app.inject({ method: "GET", url: "/api/v1/auth/me", headers: { authorization: `Bearer ${session.accessToken}` } });
    assert.equal(otherSession.statusCode, 200);

    for (const token of ["invalid", `${third.accessToken}tampered`, signAccessToken("another-instance-secret", me.json().id as string, missingSession)]) {
      const invalid = await app.inject({ method: "GET", url: "/api/v1/auth/me", headers: { authorization: `Bearer ${token}` } });
      assert.equal(invalid.statusCode, 401);
    }
    const malformed = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: { sql: "admin" }, password } });
    assert.equal(malformed.statusCode, 400);
    const absent = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "absent", password } });
    assert.equal(absent.statusCode, 401);
    assert.equal(absent.json().error, badLogin.json().error);
    await db.query("update refresh_sessions set expires_at = now() - interval '1 second' where token_hash = $1", [hashSecret(session.refreshToken)]);
    const expiredRefresh = await app.inject({ method: "POST", url: "/api/v1/auth/refresh", payload: { refreshToken: session.refreshToken } });
    assert.equal(expiredRefresh.statusCode, 401);

    await db.query("update users set disabled_at = now() where username = 'admin'");
    const blocked = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password } });
    assert.equal(blocked.statusCode, 401);
    const blockedMe = await app.inject({ method: "GET", url: "/api/v1/auth/me", headers: { authorization: `Bearer ${session.accessToken}` } });
    assert.equal(blockedMe.statusCode, 401);

    const audit = await db.query("select action from audit_events order by created_at");
    const actions = audit.rows.map((row) => row.action);
    assert.deepEqual(actions, ["bootstrap", "login", "refresh", "refresh_reuse"]);
    const leaked = await db.query(
      "select count(*) as n from audit_events where action like $1 or target_type like $1 or coalesce(target_id::text, '') like $1",
      [`%${password}%`],
    );
    assert.equal(Number(leaked.rows[0]?.n), 0);
  } finally {
    await app.close();
    await pg.close();
  }
});

test("refresh reuse revokes only its own family; logout and expiry revoke nothing else", async () => {
  const pg = new PGlite();
  const db = pgliteClient(pg);
  await applyMigrations(db);
  const app = await buildApp({ logger: false, env: { AUTH_SECRET: authSecret, BOOTSTRAP_TOKEN: bootstrapToken }, db });
  type Session = { refreshToken: string; accessToken: string };
  const refresh = async (token: string) => app.inject({ method: "POST", url: "/api/v1/auth/refresh", payload: { refreshToken: token } });
  const me = async (token: string) => (await app.inject({ method: "GET", url: "/api/v1/auth/me", headers: { authorization: `Bearer ${token}` } })).statusCode;
  const signIn = async () => (await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password } })).json() as Session;
  try {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/auth/bootstrap",
      payload: { token: bootstrapToken, username: "admin", password, displayName: "Admin" },
    });
    assert.equal(created.statusCode, 201);
    const laptop = await signIn();
    const phone = await signIn();
    const laptop2 = (await refresh(laptop.refreshToken)).json() as Session;
    const laptop3 = (await refresh(laptop2.refreshToken)).json() as Session;
    assert.equal(await me(laptop3.accessToken), 200);

    const reused = await refresh(laptop.refreshToken);
    assert.equal(reused.statusCode, 401);
    assert.deepEqual(reused.json(), { error: "invalid_session" });
    assert.equal(reused.body.includes("eyJ"), false);
    assert.equal((await refresh(laptop3.refreshToken)).statusCode, 401);
    assert.equal(await me(laptop3.accessToken), 401);
    const family = await db.query(
      "select count(*)::int as n, count(revoked_at)::int as revoked from refresh_sessions where family_id = (select family_id from refresh_sessions where token_hash = $1)",
      [hashSecret(laptop.refreshToken)],
    );
    assert.deepEqual(family.rows[0], { n: 3, revoked: 3 });

    // The other device is another family and keeps going.
    assert.equal(await me(phone.accessToken), 200);
    const phone2 = (await refresh(phone.refreshToken)).json() as Session;
    assert.equal(await me(phone2.accessToken), 200);

    // Expiry and logout are not reuse.
    const tablet = await signIn();
    const tablet2 = (await refresh(tablet.refreshToken)).json() as Session;
    await db.query("update refresh_sessions set expires_at = now() - interval '1 second' where token_hash = $1", [hashSecret(tablet2.refreshToken)]);
    assert.equal((await refresh(tablet2.refreshToken)).statusCode, 401);
    assert.equal(await me(phone2.accessToken), 200);
    assert.equal((await app.inject({ method: "POST", url: "/api/v1/auth/logout", payload: { refreshToken: phone2.refreshToken } })).statusCode, 204);
    assert.equal((await refresh(phone2.refreshToken)).statusCode, 401);
    const desk = await signIn();
    assert.equal(await me(desk.accessToken), 200);
    assert.equal((await refresh(desk.refreshToken)).statusCode, 200);
  } finally {
    await app.close();
    await pg.close();
  }
});
