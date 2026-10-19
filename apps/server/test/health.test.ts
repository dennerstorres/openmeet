import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";

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

test("unknown routes stay closed", async () => {
  const app = await buildApp({ logger: false });
  const response = await app.inject({ method: "GET", url: "/api/v1/not-a-route" });
  assert.equal(response.statusCode, 404);
  await app.close();
});
