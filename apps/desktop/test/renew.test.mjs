import assert from "node:assert/strict";
import test from "node:test";
import { createRenewal } from "../src/shell/renew.ts";

const origin = "https://meet.example.com";
const ok = { status: 200, body: [] };
const expired = { status: 401, body: { error: "unauthorized" } };

test("parallel 401s renew once and every call runs again", async () => {
  let refreshes = 0;
  let renewed = false;
  const renewal = createRenewal(async () => {
    refreshes += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    renewed = true;
    return { status: 200, body: { accessToken: "held-by-native" } };
  });
  const runs = [];
  const call = (name) =>
    renewal.call(origin, async () => {
      runs.push(name);
      return renewed ? ok : expired;
    });
  const results = await Promise.all([call("a"), call("b"), call("c")]);
  assert.deepEqual(
    results.map((result) => result.status),
    [200, 200, 200],
  );
  assert.equal(refreshes, 1);
  assert.equal(runs.length, 6);
});

test("a call that finds no token while another renews waits for the same renewal", async () => {
  let refreshes = 0;
  let renewed = false;
  const renewal = createRenewal(async () => {
    refreshes += 1;
    renewed = true;
    return { status: 200, body: {} };
  });
  const result = await renewal.call(origin, async () => {
    if (!renewed) throw "unauthorized";
    return ok;
  });
  assert.equal(result.status, 200);
  assert.equal(refreshes, 1);
});

test("a failed renewal returns the first 401 and runs nothing again", async () => {
  let runs = 0;
  const renewal = createRenewal(async () => ({ status: 401, body: { error: "invalid_session" } }));
  const result = await renewal.call(origin, async () => {
    runs += 1;
    return expired;
  });
  assert.deepEqual(result, expired);
  assert.equal(runs, 1);
  const empty = createRenewal(async () => null);
  assert.deepEqual(await empty.call(origin, async () => expired), expired);
  const broken = createRenewal(async () => {
    throw new Error("network");
  });
  assert.deepEqual(await broken.call(origin, async () => expired), expired);
});

test("other answers and other errors pass as they are", async () => {
  let refreshes = 0;
  const renewal = createRenewal(async () => {
    refreshes += 1;
    return { status: 200, body: {} };
  });
  assert.equal((await renewal.call(origin, async () => ({ status: 403, body: { error: "forbidden" } }))).status, 403);
  await assert.rejects(
    renewal.call(origin, async () => {
      throw "invalid_path";
    }),
  );
  assert.equal(refreshes, 0);
  // After a renewal ends, the next 401 starts a new one.
  await renewal.renew(origin);
  await renewal.renew(origin);
  assert.equal(refreshes, 2);
});
