import assert from "node:assert/strict";
import test from "node:test";
import { updateFailure, watchUpdates } from "../src/shell/update.ts";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("a check runs at start and again on the interval, and stops", async () => {
  let checks = 0;
  const seen = [];
  const stop = watchUpdates(
    async () => {
      checks += 1;
      return checks === 2 ? { version: "0.3.0", notes: null } : null;
    },
    (update) => seen.push(update.version),
    5,
  );
  await tick();
  assert.equal(checks, 1);
  assert.deepEqual(seen, []);
  await new Promise((resolve) => setTimeout(resolve, 12));
  assert.deepEqual(seen, ["0.3.0"]);
  stop();
  const after = checks;
  await new Promise((resolve) => setTimeout(resolve, 12));
  assert.equal(checks, after);
});

test("a failed check stays silent", async () => {
  const seen = [];
  const stop = watchUpdates(
    () => Promise.reject(new Error("offline")),
    (update) => seen.push(update),
    1000,
  );
  await tick();
  stop();
  assert.deepEqual(seen, []);
});

test("a failed check tries again after the retry delay, not the interval", async () => {
  let checks = 0;
  const seen = [];
  const stop = watchUpdates(
    async () => {
      checks += 1;
      if (checks === 1) throw "update_in_call";
      return { version: "0.3.0", notes: null };
    },
    (update) => seen.push(update.version),
    1000,
    5,
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  stop();
  assert.equal(checks, 2);
  assert.deepEqual(seen, ["0.3.0"]);
});

test("a wake checks again only past the gap", async () => {
  let checks = 0;
  let signal = () => {};
  const stop = watchUpdates(
    async () => {
      checks += 1;
      return null;
    },
    () => {},
    1000,
    1000,
    (fire) => {
      signal = fire;
      return () => {};
    },
    10,
  );
  await tick();
  signal();
  assert.equal(checks, 1);
  await new Promise((resolve) => setTimeout(resolve, 15));
  signal();
  assert.equal(checks, 2);
  stop();
  signal();
  assert.equal(checks, 2);
});

test("install failures read as short messages, in a call first", () => {
  assert.match(updateFailure("update_in_call"), /Saia da chamada para reiniciar/);
  assert.match(updateFailure("update_missing"), /não está mais disponível/);
  assert.match(updateFailure("update_install_failed"), /Não foi possível/);
});
