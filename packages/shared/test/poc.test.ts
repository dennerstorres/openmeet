import assert from "node:assert/strict";
import test from "node:test";
import { PocInputError, parseApiBase, parseIdentity, parseJoinResponse, parsePastedJoin, parseRoomName, parseSignalUrl } from "../src/index.js";

test("room and identity accept a short stable name", () => {
  assert.equal(parseRoomName(" poc-room_1 "), "poc-room_1");
  assert.equal(parseIdentity("win-a"), "win-a");
});

test("room and identity reject empty and unexpected characters", () => {
  assert.throws(() => parseRoomName("sala um"), PocInputError);
  assert.throws(() => parseIdentity(""), PocInputError);
});

test("API base allows loopback HTTP and any HTTPS host", () => {
  assert.equal(parseApiBase("http://127.0.0.1:3000").origin, "http://127.0.0.1:3000");
  assert.equal(parseApiBase("https://meet.example").protocol, "https:");
});

test("API base rejects remote HTTP and credentialed URLs are still parsed without being logged", () => {
  assert.throws(() => parseApiBase("http://203.0.113.10:3000"), (error: unknown) => {
    assert.ok(error instanceof PocInputError);
    assert.equal(error.code, "invalid_api_base");
    assert.equal(error.message.includes("203.0.113.10"), false);
    return true;
  });
});

test("signal URL normalizes loopback HTTP and rejects public ws", () => {
  assert.equal(parseSignalUrl("http://localhost:7880/").protocol, "ws:");
  assert.equal(parseSignalUrl("wss://sfu.example/livekit").protocol, "wss:");
  assert.throws(() => parseSignalUrl("ws://203.0.113.10:7880"), PocInputError);
});

test("pasted join accepts wss and rejects a public ws URL", () => {
  const parsed = parsePastedJoin(" wss://livekit.example ", "a.b.c");
  assert.equal(parsed.url, "wss://livekit.example/");
  assert.equal(parsed.token, "a.b.c");
  assert.throws(() => parsePastedJoin("ws://203.0.113.10:7880", "a.b.c"), PocInputError);
});

test("join response keeps the token and checks the signal URL", () => {
  const parsed = parseJoinResponse({
    url: "ws://127.0.0.1:7880",
    token: "a.b.c",
  });
  assert.equal(parsed.url, "ws://127.0.0.1:7880/");
  assert.equal(parsed.token, "a.b.c");
  assert.throws(() => parseJoinResponse({ url: "ws://127.0.0.1:7880", token: "not-a-jwt" }), PocInputError);
});
