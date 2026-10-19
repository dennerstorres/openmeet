import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { buildApp } from "../src/app.js";
import { clientAddress, createAttemptGate, ProxyRejected } from "../src/auth/limit.js";
import { applyMigrations, type MigrationClient } from "../src/db/migrate.js";

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

const proxySecret = "p".repeat(32);
const behindProxy = { trustProxy: true, proxySecret };

test("client address trusts the forwarded hop only with the proxy secret (S-11)", () => {
  assert.equal(clientAddress("127.0.0.1", { forwarded: "203.0.113.8", proxy: undefined }, { trustProxy: false, proxySecret: undefined }), "127.0.0.1");
  assert.equal(clientAddress("127.0.0.1", { forwarded: "203.0.113.8", proxy: proxySecret }, behindProxy), "203.0.113.8");
  for (const headers of [
    { forwarded: "203.0.113.8", proxy: undefined },
    { forwarded: "203.0.113.8", proxy: "q".repeat(32) },
    { forwarded: "203.0.113.8, 10.0.0.1", proxy: proxySecret },
    { forwarded: "bad hop", proxy: proxySecret },
    { forwarded: undefined, proxy: proxySecret },
  ]) {
    assert.throws(() => clientAddress("127.0.0.1", headers, behindProxy), ProxyRejected);
  }
  assert.throws(() => clientAddress("127.0.0.1", { forwarded: "203.0.113.8", proxy: "short" }, { trustProxy: true, proxySecret: "short" }), ProxyRejected);
});

test("the attempt map stops at its cap and refuses a new key instead of dropping a live one", () => {
  const gate = createAttemptGate(2, 1_000, 4096);
  for (let index = 0; index < 4096; index += 1) assert.equal(gate.allow(`k${index}`, 0), true);
  assert.equal(gate.allow("extra", 10), false);
  assert.equal(gate.allow("k0", 10), true);
  assert.equal(gate.allow("k0", 20), false);
  assert.equal(gate.allow("extra", 1_000), true);
});

test("login, bootstrap and refresh behind the proxy need the secret; health does not", async () => {
  const pg = new PGlite();
  const db = pgliteClient(pg);
  await applyMigrations(db);
  const app = await buildApp({
    logger: false,
    env: { AUTH_SECRET: authSecret, BOOTSTRAP_TOKEN: bootstrapToken, TRUST_PROXY: "1", PROXY_AUTH: proxySecret },
    db,
    attempts: { refreshIpLimit: 3, windowMs: 60_000 },
  });
  const viaProxy = (address: string) => ({ "x-forwarded-for": address, "x-openmeet-proxy": proxySecret });
  try {
    for (const headers of [
      {},
      { "x-forwarded-for": "203.0.113.8" },
      { "x-forwarded-for": "203.0.113.8", "x-openmeet-proxy": "wrong-secret-wrong-secret-wrong-1" },
    ]) {
      for (const [url, payload] of [
        ["/api/v1/auth/login", { username: "admin", password }],
        ["/api/v1/auth/bootstrap", { token: bootstrapToken, username: "admin", password, displayName: "Admin" }],
        ["/api/v1/auth/refresh", { refreshToken: "r".repeat(43) }],
      ] as const) {
        const refused = await app.inject({ method: "POST", url, headers, payload });
        assert.equal(refused.statusCode, 503, `${url} ${JSON.stringify(headers)}`);
        assert.deepEqual(refused.json(), { error: "proxy_rejected" });
      }
    }
    assert.equal((await app.inject({ method: "GET", url: "/health/live" })).statusCode, 200);
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/auth/bootstrap",
      headers: viaProxy("203.0.113.8"),
      payload: { token: bootstrapToken, username: "admin", password, displayName: "Admin" },
    });
    assert.equal(created.statusCode, 201);
    let refreshToken = (created.json() as { refreshToken: string }).refreshToken;
    for (let index = 0; index < 3; index += 1) {
      const rotated = await app.inject({ method: "POST", url: "/api/v1/auth/refresh", headers: viaProxy("203.0.113.9"), payload: { refreshToken } });
      assert.equal(rotated.statusCode, 200);
      refreshToken = (rotated.json() as { refreshToken: string }).refreshToken;
    }
    const limited = await app.inject({ method: "POST", url: "/api/v1/auth/refresh", headers: viaProxy("203.0.113.9"), payload: { refreshToken } });
    assert.equal(limited.statusCode, 429);
    const otherAddress = await app.inject({ method: "POST", url: "/api/v1/auth/refresh", headers: viaProxy("198.51.100.4"), payload: { refreshToken } });
    assert.equal(otherAddress.statusCode, 200);
  } finally {
    await app.close();
    await pg.close();
  }
});

test("one refresh token is limited on its own across addresses", async () => {
  const pg = new PGlite();
  const db = pgliteClient(pg);
  await applyMigrations(db);
  const app = await buildApp({ logger: false, env: { AUTH_SECRET: authSecret, BOOTSTRAP_TOKEN: bootstrapToken }, db, attempts: { refreshTokenLimit: 2 } });
  try {
    for (let index = 0; index < 2; index += 1) {
      assert.equal((await app.inject({ method: "POST", url: "/api/v1/auth/refresh", payload: { refreshToken: "s".repeat(43) } })).statusCode, 401);
    }
    assert.equal((await app.inject({ method: "POST", url: "/api/v1/auth/refresh", payload: { refreshToken: "s".repeat(43) } })).statusCode, 429);
  } finally {
    await app.close();
    await pg.close();
  }
});

test("login and bootstrap attempts are limited, separated by user, and recover", async () => {
  const pg = new PGlite();
  const db = pgliteClient(pg);
  await applyMigrations(db);
  let now = 10_000;
  const app = await buildApp({
    logger: false,
    env: { AUTH_SECRET: authSecret, BOOTSTRAP_TOKEN: bootstrapToken },
    db,
    attempts: { now: () => now, loginLimit: 2, loginIpLimit: 10, bootstrapLimit: 2, windowMs: 1_000 },
  });
  try {
    const weak = await app.inject({
      method: "POST",
      url: "/api/v1/auth/bootstrap",
      payload: { token: bootstrapToken, username: "admin", password: "short", displayName: "Admin" },
    });
    assert.equal(weak.statusCode, 400);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const rejected = await app.inject({
        method: "POST",
        url: "/api/v1/auth/bootstrap",
        payload: { token: "wrong-bootstrap-token-value", username: "admin", password, displayName: "Admin" },
      });
      assert.equal(rejected.statusCode, 401);
    }
    const limitedBootstrap = await app.inject({
      method: "POST",
      url: "/api/v1/auth/bootstrap",
      payload: { token: bootstrapToken, username: "admin", password, displayName: "Admin" },
    });
    assert.equal(limitedBootstrap.statusCode, 429);
    assert.equal(limitedBootstrap.json().error, "rate_limited");
    now += 1_000;
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/auth/bootstrap",
      payload: { token: bootstrapToken, username: "admin", password, displayName: "Admin" },
    });
    assert.equal(created.statusCode, 201);

    const empty = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: "" } });
    assert.equal(empty.statusCode, 401);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const rejected = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password: "wrong-password-value" } });
      assert.equal(rejected.statusCode, 401);
    }
    const limitedLogin = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password } });
    assert.equal(limitedLogin.statusCode, 429);
    const other = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "other", password: "wrong-password-value" } });
    assert.equal(other.statusCode, 401);
    assert.equal(other.json().error, "invalid_credentials");
    now += 1_000;
    const loggedIn = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password } });
    assert.equal(loggedIn.statusCode, 200);

    const locked = await buildApp({
      logger: false,
      env: { AUTH_SECRET: authSecret, BOOTSTRAP_TOKEN: bootstrapToken },
      db,
      attempts: { loginLimit: 1, loginIpLimit: 1, windowMs: 60_000 },
    });
    const first = await locked.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: { "x-forwarded-for": "203.0.113.8" },
      payload: { username: "admin", password: "wrong-password-value" },
    });
    assert.equal(first.statusCode, 401);
    const spoofed = await locked.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: { "x-forwarded-for": "203.0.113.9" },
      payload: { username: "admin", password: "wrong-password-value" },
    });
    assert.equal(spoofed.statusCode, 429);
    await locked.close();

    const trusted = await buildApp({
      logger: false,
      env: { AUTH_SECRET: authSecret, BOOTSTRAP_TOKEN: bootstrapToken, TRUST_PROXY: "1", PROXY_AUTH: proxySecret },
      db,
      attempts: { loginLimit: 1, loginIpLimit: 1, windowMs: 60_000 },
    });
    const fromA = await trusted.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: { "x-forwarded-for": "203.0.113.8", "x-openmeet-proxy": proxySecret },
      payload: { username: "admin", password: "wrong-password-value" },
    });
    assert.equal(fromA.statusCode, 401);
    const fromB = await trusted.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: { "x-forwarded-for": "203.0.113.9", "x-openmeet-proxy": proxySecret },
      payload: { username: "other", password: "wrong-password-value" },
    });
    assert.equal(fromB.statusCode, 401);
    await trusted.close();
  } finally {
    await app.close();
    await pg.close();
  }
});
