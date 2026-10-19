import assert from "node:assert/strict";
import test from "node:test";
import { parseGoogleStart, PocInputError, canonicalInstanceUrl, parseInstanceCard, prepareInstanceRequest, readErrorCode } from "../src/index.js";

const roomId = "11111111-1111-4111-8111-111111111111";

test("instance origin is the pinned HTTPS or loopback URL", () => {
  assert.equal(canonicalInstanceUrl(" https://meet.example/ "), "https://meet.example");
  assert.equal(canonicalInstanceUrl("http://127.0.0.1:3000"), "http://127.0.0.1:3000");
});

test("instance origin rejects a path, a public HTTP host, and embedded credentials", () => {
  assert.throws(() => canonicalInstanceUrl("https://meet.example/sala"), PocInputError);
  assert.throws(
    () => canonicalInstanceUrl("http://203.0.113.10:3000"),
    (error: unknown) => {
      assert.ok(error instanceof PocInputError);
      assert.equal(error.message.includes("203.0.113.10"), false);
      return true;
    },
  );
  assert.throws(
    () => canonicalInstanceUrl("https://user:secret-token@meet.example"),
    (error: unknown) => {
      assert.ok(error instanceof PocInputError);
      assert.equal(error.code, "invalid_api_base");
      assert.equal(error.message.includes("secret-token"), false);
      return true;
    },
  );
});

test("instance metadata requires the public card", () => {
  assert.deepEqual(parseInstanceCard({ name: "Sala", apiVersion: "v1", bootstrapOpen: true }), {
    name: "Sala",
    apiVersion: "v1",
    bootstrapOpen: true,
    googleLogin: false,
  });
  assert.throws(() => parseInstanceCard({ name: "Sala", apiVersion: "v1" }), PocInputError);
});

test("a credential request stays on the pinned origin", () => {
  const prepared = prepareInstanceRequest(
    "https://meet.example",
    "https://meet.example",
    "POST",
    "/api/v1/auth/login",
    { username: "ada", password: "correct-horse-battery" },
    null,
  );
  assert.equal(prepared.url, "https://meet.example/api/v1/auth/login");
  assert.equal(prepared.url.includes("correct-horse-battery"), false);
  assert.equal(prepared.headers.authorization, undefined);
  assert.throws(
    () => prepareInstanceRequest("https://meet.example", "https://other.example", "POST", "/api/v1/auth/login", { password: "correct-horse-battery" }, null),
    (error: unknown) => {
      assert.ok(error instanceof PocInputError);
      assert.equal(error.message.includes("correct-horse-battery"), false);
      return true;
    },
  );
});

test("room join is the only room path accepted", () => {
  const prepared = prepareInstanceRequest("https://meet.example", "https://meet.example", "POST", `/api/v1/rooms/${roomId}/join`, {}, "access-token-value");
  assert.equal(prepared.url, `https://meet.example/api/v1/rooms/${roomId}/join`);
  assert.equal(prepared.headers.authorization, "Bearer access-token-value");
  assert.throws(
    () => prepareInstanceRequest("https://meet.example", "https://meet.example", "GET", "https://other.example/api/v1/rooms", null, null),
    PocInputError,
  );
});

test("the server list and the rooms of one server are the only server paths accepted", () => {
  const serverId = "44444444-4444-4444-8444-444444444444";
  assert.equal(
    prepareInstanceRequest("https://meet.example", "https://meet.example", "GET", "/api/v1/servers", null, "t").url,
    "https://meet.example/api/v1/servers",
  );
  assert.equal(
    prepareInstanceRequest("https://meet.example", "https://meet.example", "POST", `/api/v1/servers/${serverId}/rooms`, {}, "t").url,
    `https://meet.example/api/v1/servers/${serverId}/rooms`,
  );
  for (const path of [`/api/v1/servers/${serverId}`, `/api/v1/servers/${serverId}/members/${serverId}`, "/api/v1/servers/../admin/users"]) {
    assert.throws(() => prepareInstanceRequest("https://meet.example", "https://meet.example", "GET", path, null, "t"), PocInputError, path);
  }
});

test("error codes stay inside a short token", () => {
  assert.equal(readErrorCode({ error: "invalid_credentials" }), "invalid_credentials");
  assert.equal(readErrorCode({ error: "Bearer secret-token" }), "request_failed");
  assert.equal(readErrorCode(null), "request_failed");
});

test("Google start is accepted only when it points at Google's own sign-in page", () => {
  const poll = "P".repeat(43);
  const good = { authUrl: "https://accounts.google.com/o/oauth2/v2/auth?client_id=x&state=y", poll, expiresIn: 600 };
  assert.equal(parseGoogleStart(good).poll, poll);
  for (const authUrl of [
    "https://evil.example/o/oauth2/v2/auth?x=1",
    "https://accounts.google.com.evil.example/o/oauth2/v2/auth",
    "http://accounts.google.com/o/oauth2/v2/auth",
    "https://user@accounts.google.com/o/oauth2/v2/auth",
    "https://accounts.google.com/o/oauth2/v2/auth#x",
    "javascript:alert(1)",
  ]) {
    assert.throws(() => parseGoogleStart({ ...good, authUrl }), PocInputError, authUrl);
  }
  assert.throws(() => parseGoogleStart({ ...good, poll: "short" }), PocInputError);
  assert.throws(() => parseGoogleStart({ ...good, expiresIn: 99999 }), PocInputError);
});
