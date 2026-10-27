import assert from "node:assert/strict";
import test from "node:test";
import { canDeleteMessage, canEditMessage, mergeMessages, parseChatMessage, parseChatPage, sendableBody, type ChatMessage } from "../src/chat.js";
import { prepareInstanceRequest } from "../src/instance.js";

const roomId = "11111111-1111-4111-8111-111111111111";
const ana = "22222222-2222-4222-8222-222222222222";
const bia = "33333333-3333-4333-8333-333333333333";

function message(id: string, body = `m${id}`, extra: Partial<ChatMessage> = {}): ChatMessage {
  return { id, roomId, authorId: ana, body, replyTo: null, pinned: false, edited: false, deleted: false, createdAt: "2026-10-27T12:00:00.000Z", ...extra };
}

test("a message parses only in the shape the API writes", () => {
  const wire = { ...message("7"), canEdit: true, canDelete: true };
  assert.deepEqual(parseChatMessage(wire), message("7"));
  assert.deepEqual(parseChatMessage({ ...wire, replyTo: { id: "3", authorId: bia, body: "antes", deleted: false } })?.replyTo, {
    id: "3",
    authorId: bia,
    body: "antes",
    deleted: false,
  });
  assert.equal(parseChatMessage({ ...wire, deleted: true, body: "sobrou" })?.body, "");
  for (const broken of [
    { ...wire, id: "07" },
    { ...wire, id: 7 },
    { ...wire, roomId: "sala" },
    { ...wire, authorId: undefined },
    { ...wire, createdAt: "ontem" },
    { ...wire, replyTo: { id: "x" } },
    null,
    [],
  ]) {
    assert.equal(parseChatMessage(broken), undefined);
  }
  assert.equal(parseChatPage({ messages: [wire, { ...wire, id: "x" }], hasMore: false }), undefined);
  assert.deepEqual(parseChatPage({ messages: [wire], hasMore: true }), { messages: [message("7")], hasMore: true });
});

test("merging orders by numeric id and lets the newer copy win", () => {
  const merged = mergeMessages([message("9"), message("10")], [message("2"), message("10", "editada", { edited: true }), message("100")]);
  assert.deepEqual(
    merged.map((item) => [item.id, item.body]),
    [
      ["2", "m2"],
      ["9", "m9"],
      ["10", "editada"],
      ["100", "m100"],
    ],
  );
});

test("authors edit, authors and managers remove, nobody touches a removed message", () => {
  const own = message("1");
  const removed = message("2", "", { deleted: true });
  assert.equal(canEditMessage(own, ana), true);
  assert.equal(canEditMessage(own, bia), false);
  assert.equal(canEditMessage(own, null), false);
  assert.equal(canDeleteMessage(own, bia, false), false);
  assert.equal(canDeleteMessage(own, bia, true), true);
  assert.equal(canEditMessage(removed, ana), false);
  assert.equal(canDeleteMessage(removed, ana, true), false);
});

test("the composer sends trimmed-blank-free text within 4000 code points", () => {
  assert.equal(sendableBody("oi\r\ntudo"), "oi\ntudo");
  assert.equal(sendableBody("  \n "), undefined);
  assert.equal(sendableBody("😀".repeat(4000))?.length, 8000);
  assert.equal(sendableBody("a".repeat(4001)), undefined);
});

test("the message routes pass the instance path check, with only the cursor as query", () => {
  const origin = "https://meet.example.com";
  for (const path of [
    `/api/v1/rooms/${roomId}/messages`,
    `/api/v1/rooms/${roomId}/messages?before=42`,
    `/api/v1/rooms/${roomId}/messages?after=1`,
    `/api/v1/rooms/${roomId}/messages/search`,
    `/api/v1/rooms/${roomId}/pins`,
    `/api/v1/rooms/${roomId}/typing`,
    "/api/v1/messages/42/edit",
    "/api/v1/messages/42/delete",
    "/api/v1/messages/42/pin",
  ]) {
    assert.equal(prepareInstanceRequest(origin, origin, "GET", path, undefined, null).url, `${origin}${path}`);
  }
  for (const path of [
    `/api/v1/rooms/${roomId}/messages?q=segredo`,
    `/api/v1/rooms/${roomId}/messages?after=01`,
    `/api/v1/rooms/${roomId}/messages?after=1&before=2`,
    "/api/v1/messages/abc/edit",
    `/api/v1/messages/${roomId}/edit`,
  ]) {
    assert.throws(() => prepareInstanceRequest(origin, origin, "GET", path, undefined, null));
  }
});
