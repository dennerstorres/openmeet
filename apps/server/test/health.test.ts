import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";
import type { MigrationClient } from "../src/db/migrate.js";

function stubDb(query: MigrationClient["query"]): MigrationClient {
  const db: MigrationClient = {
    exec: async () => {},
    query,
    transaction: async (run) => run(db),
  };
  return db;
}

test("GET /health/live reports the process is up", async () => {
  const app = await buildApp({ logger: false });
  const response = await app.inject({ method: "GET", url: "/health/live" });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: "ok" });
  await app.close();
});

test("GET /health/ready does not pretend a database exists", async () => {
  const app = await buildApp({ logger: false });
  const response = await app.inject({ method: "GET", url: "/health/ready" });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    status: "ok",
    checks: { database: "not_configured" },
  });
  await app.close();
});

test("GET /health/ready reports a connected database", async () => {
  const app = await buildApp({
    logger: false,
    db: stubDb(async () => ({ rows: [{ ok: 1 }] })),
  });
  const response = await app.inject({ method: "GET", url: "/health/ready" });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: "ok", checks: { database: "ok" } });
  await app.close();
});

test("GET /health/ready fails closed when the database does not answer", async () => {
  const app = await buildApp({
    logger: false,
    db: stubDb(async () => {
      throw new Error("postgres://secret@db/openmeet unreachable");
    }),
  });
  const response = await app.inject({ method: "GET", url: "/health/ready" });
  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.json(), { status: "unavailable", checks: { database: "error" } });
  assert.equal(response.body.includes("secret"), false);
  await app.close();
});

test("unknown routes stay closed", async () => {
  const app = await buildApp({ logger: false });
  const response = await app.inject({ method: "GET", url: "/api/v1/not-a-route" });
  assert.equal(response.statusCode, 404);
  await app.close();
});
