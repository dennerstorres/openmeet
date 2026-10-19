import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { buildApp } from "../src/app.js";
import { applyMigrations, type MigrationClient } from "../src/db/migrate.js";

const bootstrapToken = "unit-test-bootstrap-token";
const authSecret = "unit-test-auth-secret-do-not-leak";

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

test("GET /api/v1/instance returns only the public card", async () => {
  const app = await buildApp({ logger: false, env: { AUTH_SECRET: authSecret, BOOTSTRAP_TOKEN: bootstrapToken, INSTANCE_NAME: "Sala\nNorte" } });
  const response = await app.inject({ method: "GET", url: "/api/v1/instance" });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["cache-control"], "no-store");
  assert.deepEqual(response.json(), { name: "OpenMeet", apiVersion: "v1", bootstrapOpen: false, googleLogin: false });
  assert.equal(response.body.includes(authSecret), false);
  assert.equal(response.body.includes(bootstrapToken), false);
  await app.close();
});

test("GET /api/v1/instance uses the configured name", async () => {
  const app = await buildApp({ logger: false, env: { INSTANCE_NAME: "Sala Norte" } });
  const response = await app.inject({ method: "GET", url: "/api/v1/instance" });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().name, "Sala Norte");
  await app.close();
});

test("bootstrap flag follows the instance settings row", async () => {
  const pg = new PGlite();
  const db = pgliteClient(pg);
  await applyMigrations(db);
  const app = await buildApp({
    logger: false,
    env: { AUTH_SECRET: authSecret, BOOTSTRAP_TOKEN: bootstrapToken, INSTANCE_NAME: "Sala Norte" },
    db,
  });
  try {
    const open = await app.inject({ method: "GET", url: "/api/v1/instance" });
    assert.equal(open.statusCode, 200);
    assert.equal(open.json().bootstrapOpen, true);
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/auth/bootstrap",
      payload: { token: bootstrapToken, username: "admin", password: "correct-horse-battery", displayName: "Admin" },
    });
    assert.equal(created.statusCode, 201);
    const closed = await app.inject({ method: "GET", url: "/api/v1/instance" });
    assert.equal(closed.json().bootstrapOpen, false);
    assert.equal(closed.body.includes(authSecret), false);
    assert.equal(closed.body.includes("correct-horse-battery"), false);
  } finally {
    await app.close();
    await pg.close();
  }
});
