import assert from "node:assert/strict";
import test from "node:test";
import { parseAccounts, prepareInstanceRequest } from "../src/index.js";

const ID = "11111111-2222-4333-8444-555555555555";

test("admin account routes pass the pinned path filter", () => {
  for (const path of ["/api/v1/admin/users", `/api/v1/admin/users/${ID}/password`, `/api/v1/admin/users/${ID}/disable`, `/api/v1/admin/users/${ID}/enable`]) {
    assert.equal(prepareInstanceRequest("https://meet.example", "https://meet.example", "POST", path, {}, "token").url, `https://meet.example${path}`);
  }
  assert.throws(() => prepareInstanceRequest("https://meet.example", "https://meet.example", "POST", `/api/v1/admin/users/${ID}/delete`, {}, "token"));
  assert.throws(() => prepareInstanceRequest("https://meet.example", "https://meet.example", "POST", "/api/v1/admin/users/x/disable", {}, "token"));
});

test("parseAccounts keeps only well-formed rows", () => {
  const rows = parseAccounts([
    { id: ID, username: "ana", displayName: "Ana", role: "participant", disabled: true },
    { id: ID, username: "bob", displayName: "Bob", role: "moderator" },
    { id: 1, username: "x" },
    null,
  ]);
  assert.deepEqual(rows, [
    { id: ID, username: "ana", displayName: "Ana", role: "participant", disabled: true },
    { id: ID, username: "bob", displayName: "Bob", role: "moderator", disabled: false },
  ]);
  assert.deepEqual(parseAccounts({}), []);
});
