import assert from "node:assert/strict";
import test from "node:test";
import { PocInputError, canonicalInstanceUrl, parseInstanceCard, prepareInstanceRequest, readErrorCode } from "../src/index.js";

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

test("error codes stay inside a short token", () => {
  assert.equal(readErrorCode({ error: "invalid_credentials" }), "invalid_credentials");
  assert.equal(readErrorCode({ error: "Bearer secret-token" }), "request_failed");
  assert.equal(readErrorCode(null), "request_failed");
});
