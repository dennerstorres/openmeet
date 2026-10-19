import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { buildApp } from "../src/app.js";
import { clientAddress } from "../src/auth/limit.js";
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

test("client address ignores a forwarded header unless the proxy is trusted", () => {
  assert.equal(clientAddress("127.0.0.1", "203.0.113.8", false), "127.0.0.1");
  assert.equal(clientAddress("127.0.0.1", "203.0.113.8, 10.0.0.1", true), "203.0.113.8");
  assert.equal(clientAddress("127.0.0.1", "bad hop", true), "127.0.0.1");
  assert.equal(clientAddress("127.0.0.1", undefined, true), "127.0.0.1");
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
      env: { AUTH_SECRET: authSecret, BOOTSTRAP_TOKEN: bootstrapToken, TRUST_PROXY: "1" },
      db,
      attempts: { loginLimit: 1, loginIpLimit: 1, windowMs: 60_000 },
    });
    const fromA = await trusted.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: { "x-forwarded-for": "203.0.113.8" },
      payload: { username: "admin", password: "wrong-password-value" },
    });
    assert.equal(fromA.statusCode, 401);
    const fromB = await trusted.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: { "x-forwarded-for": "203.0.113.9" },
      payload: { username: "other", password: "wrong-password-value" },
    });
    assert.equal(fromB.statusCode, 401);
    await trusted.close();
  } finally {
    await app.close();
    await pg.close();
  }
});
