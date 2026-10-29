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
    { id: ID, username: "ana", displayName: "Ana", role: "participant", disabled: true, sessions: [] },
    { id: ID, username: "bob", displayName: "Bob", role: "moderator", disabled: false, sessions: [] },
  ]);
  assert.deepEqual(parseAccounts({}), []);
});

test("parseAccounts reads each signed-in device (ADR 0028)", () => {
  const [row] = parseAccounts([
    {
      id: ID,
      username: "ana",
      displayName: "Ana",
      role: "participant",
      sessions: [
        {
          client: "desktop",
          version: "0.2.15",
          agent: "OpenMeet-Desktop/0.2.15 (windows)",
          signedInAt: "2026-10-29T10:00:00.000Z",
          lastSeenAt: "2026-10-29T11:00:00.000Z",
        },
        { client: "tv", version: "", signedInAt: "2026-10-29T10:00:00.000Z", lastSeenAt: "2026-10-29T10:00:00.000Z" },
        { client: "web" },
      ],
    },
  ]);
  assert.deepEqual(row?.sessions, [
    {
      client: "desktop",
      version: "0.2.15",
      agent: "OpenMeet-Desktop/0.2.15 (windows)",
      signedInAt: "2026-10-29T10:00:00.000Z",
      lastSeenAt: "2026-10-29T11:00:00.000Z",
    },
    { client: null, version: null, agent: null, signedInAt: "2026-10-29T10:00:00.000Z", lastSeenAt: "2026-10-29T10:00:00.000Z" },
  ]);
});
