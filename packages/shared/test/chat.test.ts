import assert from "node:assert/strict";
import test from "node:test";
import {
  attachmentIsImage,
  bumpDm,
  chatPath,
  dmTitle,
  inChat,
  parseDm,
  upsertDm,
  canDeleteMessage,
  canEditMessage,
  customReactionId,
  emojiDisplay,
  emojiWire,
  mentionCandidates,
  mentionDisplay,
  mentionQuery,
  mentionWire,
  mentionsUser,
  mergeMessages,
  parseChatMessage,
  parseChatPage,
  parseServerEmojis,
  plainBody,
  sendableBody,
  type ChatMessage,
} from "../src/chat.js";
import { prepareInstanceRequest } from "../src/instance.js";

const roomId = "11111111-1111-4111-8111-111111111111";
const ana = "22222222-2222-4222-8222-222222222222";
const bia = "33333333-3333-4333-8333-333333333333";

function message(id: string, body = `m${id}`, extra: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id,
    roomId,
    dmId: null,
    authorId: ana,
    body,
    replyTo: null,
    pinned: false,
    edited: false,
    deleted: false,
    createdAt: "2026-10-27T12:00:00.000Z",
    reactions: [],
    mentions: [],
    mentionsEveryone: false,
    attachments: [],
    emojis: [],
    ...extra,
  };
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
  assert.deepEqual(parseChatPage({ messages: [wire], hasMore: true }), { messages: [message("7")], hasMore: true, hasNewer: false });
  const reacted = parseChatMessage({ ...wire, reactions: [{ emoji: "👍", userIds: [ana, bia] }] });
  assert.deepEqual(reacted?.reactions, [{ emoji: "👍", userIds: [ana, bia] }]);
  assert.equal(parseChatMessage({ ...wire, reactions: [{ emoji: "👍", userIds: ["x"] }] }), undefined);
  assert.equal(parseChatMessage({ ...wire, reactions: [{ emoji: "👍", userIds: [] }] }), undefined);
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
    "/api/v1/messages/42/reactions",
    `/api/v1/rooms/${roomId}/messages?around=9`,
    "/api/v1/dms",
    `/api/v1/dms/${roomId}`,
    `/api/v1/dms/${roomId}/messages`,
    `/api/v1/dms/${roomId}/messages?before=42`,
    `/api/v1/dms/${roomId}/messages/search`,
    `/api/v1/dms/${roomId}/pins`,
    `/api/v1/dms/${roomId}/typing`,
    `/api/v1/dms/${roomId}/members`,
    `/api/v1/dms/${roomId}/leave`,
    `/api/v1/dms/${roomId}/rename`,
    "/api/v1/blocks",
    `/api/v1/users/${roomId}/block`,
    `/api/v1/rooms/${roomId}/attachments`,
    `/api/v1/attachments/${roomId}`,
  ]) {
    assert.equal(prepareInstanceRequest(origin, origin, "GET", path, undefined, null).url, `${origin}${path}`);
  }
  for (const path of [
    `/api/v1/rooms/${roomId}/messages?q=segredo`,
    `/api/v1/rooms/${roomId}/messages?after=01`,
    `/api/v1/rooms/${roomId}/messages?after=1&before=2`,
    "/api/v1/messages/abc/edit",
    `/api/v1/messages/${roomId}/edit`,
    `/api/v1/dms/${roomId}/messages?q=segredo`,
    "/api/v1/dms/not-an-id/leave",
    `/api/v1/dms/${roomId}/members/${roomId}`,
    "/api/v1/users/not-an-id/block",
    "/api/v1/attachments/foto.png",
    `/api/v1/attachments/${roomId}?name=foto.png`,
  ]) {
    assert.throws(() => prepareInstanceRequest(origin, origin, "GET", path, undefined, null));
  }
});

test("mentions show as names and travel as tokens", () => {
  const label = (id: string) => (id === bia ? "Bia Souza" : "Ana");
  const body = `oi <@${bia}>, viu <@${ana}>?`;
  assert.equal(plainBody(body, label), "oi @Bia Souza, viu @Ana?");
  const shown = mentionDisplay(body, label);
  assert.equal(shown.text, "oi @Bia Souza, viu @Ana?");
  assert.equal(mentionWire(shown.text, shown.picks), body);
  assert.equal(mentionWire("mail@Ana e @Anabela e @Ana.", { "@Ana": ana }), `mail@Ana e @Anabela e <@${ana}>.`);
  assert.deepEqual(mentionQuery("fala @bi", 8), { start: 5, query: "bi" });
  assert.equal(mentionQuery("mail@bi", 7), undefined);
  assert.equal(mentionQuery("@bia souza", 10), undefined);
});

test("candidates match a word of the name and keep @everyone for managers", () => {
  const members = [
    { id: ana, label: "Ana", globalName: "Ana" },
    { id: bia, label: "Bia Souza", globalName: "Beatriz" },
  ];
  assert.deepEqual(
    mentionCandidates(members, "sou", false).map((item) => item.id),
    [bia],
  );
  assert.deepEqual(
    mentionCandidates(members, "be", false).map((item) => item.id),
    [bia],
  );
  assert.deepEqual(
    mentionCandidates(members, "e", false).map((item) => item.id),
    [],
  );
  assert.deepEqual(
    mentionCandidates(members, "e", true).map((item) => item.id),
    ["everyone"],
  );
  assert.equal(mentionCandidates(members, "", true).length, 4);
});

test("a message calls whoever it names, never its author", () => {
  assert.equal(mentionsUser(message("1", "x", { mentions: [bia] }), bia), true);
  assert.equal(mentionsUser(message("1", "x", { mentionsEveryone: true }), bia), true);
  assert.equal(mentionsUser(message("1", "x", { mentionsEveryone: true }), ana), false);
  assert.equal(mentionsUser(message("1", "x", { mentions: [ana] }), bia), false);
  assert.deepEqual(parseChatMessage({ ...message("1"), mentions: ["nope"] }), undefined);
});

test("attachments parse as the API writes them and only a measured picture gets a preview", () => {
  const picture = { id: bia, name: "foto.png", contentType: "image/png", size: 45, width: 3, height: 2 };
  const file = { id: ana, name: "foto.png", contentType: "application/octet-stream", size: 40, width: null, height: null };
  const parsed = parseChatMessage({ ...message("8"), attachments: [picture, file] });
  assert.deepEqual(parsed?.attachments, [picture, file]);
  assert.equal(attachmentIsImage(picture), true);
  assert.equal(attachmentIsImage(file), false);
  assert.equal(attachmentIsImage({ ...picture, contentType: "image/svg+xml" }), false);
  assert.equal(attachmentIsImage({ ...file, contentType: "image/png" }), false);
  assert.equal(parseChatMessage({ ...message("8"), attachments: [{ ...picture, height: null }] }), undefined);
  assert.equal(parseChatMessage({ ...message("8"), attachments: [{ ...picture, id: "x" }] }), undefined);
  assert.equal(parseChatMessage({ ...message("8"), attachments: Array.from({ length: 11 }, () => file) }), undefined);
  assert.deepEqual(parseChatMessage({ ...message("8"), deleted: true, attachments: [picture] })?.attachments, []);
  // A message with files may go without text.
  assert.equal(sendableBody("   "), undefined);
  assert.equal(sendableBody("", true), "");
});

test("a DM message carries dmId instead of roomId, never both", () => {
  const dmId = "44444444-4444-4444-8444-444444444444";
  const wire = { ...message("8"), roomId: null, dmId };
  assert.deepEqual(parseChatMessage(wire), { ...message("8"), roomId: null, dmId });
  assert.equal(parseChatMessage({ ...wire, roomId }), undefined);
  assert.equal(parseChatMessage({ ...wire, dmId: null }), undefined);
  assert.equal(inChat(wire, { kind: "dm", id: dmId }), true);
  assert.equal(inChat(wire, { kind: "room", id: dmId }), false);
  assert.equal(inChat(message("9"), { kind: "room", id: roomId }), true);
  assert.equal(chatPath({ kind: "dm", id: dmId }), `/api/v1/dms/${dmId}`);
  assert.equal(chatPath({ kind: "room", id: roomId }), `/api/v1/rooms/${roomId}`);
});

test("the DM list keeps the API shape, names the other people and drops a DM the caller left", () => {
  const first = "55555555-5555-4555-8555-555555555555";
  const second = "66666666-6666-4666-8666-666666666666";
  const direct = parseDm({
    id: first,
    kind: "direct",
    name: null,
    createdBy: ana,
    memberIds: [ana, bia],
    members: [
      { id: ana, label: "Ana", avatarId: null },
      { id: bia, label: "Bia", avatarId: "nada" },
    ],
    readOnly: true,
  });
  assert.ok(direct);
  assert.equal(direct.readOnly, true);
  assert.equal(direct.members[1]?.avatarId, null);
  assert.equal(dmTitle(direct, ana), "Bia");
  assert.equal(parseDm({ ...direct, kind: "canal" }), undefined);
  assert.equal(parseDm({ ...direct, members: [{ id: "x", label: "X" }] }), undefined);
  const group = { ...direct, id: second, kind: "group" as const, name: null, readOnly: false };
  assert.equal(dmTitle(group, bia), "Ana");
  assert.equal(dmTitle({ ...group, name: "Turma" }, bia), "Turma");
  const list = upsertDm([direct], group, ana);
  assert.deepEqual(
    list.map((dm) => dm.id),
    [second, first],
  );
  assert.deepEqual(
    bumpDm(list, first).map((dm) => dm.id),
    [first, second],
  );
  const left = { ...group, members: group.members.filter((member) => member.id !== ana) };
  assert.deepEqual(
    upsertDm(list, left, ana).map((dm) => dm.id),
    [first],
  );
});

test("server emojis: `:name:` goes to the wire outside code and back for editing", () => {
  const festa = { id: "44444444-4444-4444-8444-444444444444", serverId: roomId, name: "festa", animated: false };
  const find = (name: string) => (name.toLowerCase() === "festa" ? festa : undefined);
  const wire = emojiWire("oi :festa: e :outro: `:festa:` :FESTA:", find);
  assert.equal(wire, `oi <:festa:${festa.id}> e :outro: \`:festa:\` <:festa:${festa.id}>`);
  assert.equal(emojiDisplay(wire), "oi :festa: e :outro: `:festa:` :festa:");
  assert.equal(
    plainBody(`<:festa:${festa.id}> <@${bia}>`, () => "Bia"),
    ":festa: @Bia",
  );
  assert.equal(customReactionId(`custom:${festa.id.toUpperCase()}`), festa.id);
  assert.equal(customReactionId("👍"), undefined);
  const parsed = parseChatMessage({ ...message("1"), emojis: [{ id: festa.id, name: "festa", animated: false, removed: true }] });
  assert.deepEqual(parsed?.emojis, [{ id: festa.id, name: "festa", animated: false, removed: true }]);
  assert.equal(parseChatMessage({ ...message("1"), emojis: [{ id: festa.id, name: "x" }] }), undefined);
  assert.deepEqual(parseServerEmojis({ emojis: [festa] }), [festa]);
});
