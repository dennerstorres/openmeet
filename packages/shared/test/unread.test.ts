import assert from "node:assert/strict";
import test from "node:test";
import {
  EMPTY_UNREAD,
  applyRead,
  badgeCount,
  chatBadge,
  clearChat,
  countMessage,
  effectiveLevel,
  parseUnreadState,
  serverBadge,
  shouldNotify,
  titleWithCount,
  type ChatMessage,
  type UnreadState,
} from "../src/index.js";

// ADR 0024 (F13-13): when a message notifies and what the badge shows.
const SELF = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
const SERVER = "00000000-0000-4000-8000-0000000000aa";
const ROOM = "00000000-0000-4000-8000-0000000000b1";
const DM = "00000000-0000-4000-8000-0000000000c1";

function message(over: Partial<ChatMessage>): ChatMessage {
  return {
    id: "10",
    roomId: ROOM,
    dmId: null,
    authorId: OTHER,
    body: "oi",
    replyTo: null,
    reactions: [],
    attachments: [],
    emojis: [],
    mentions: [],
    mentionsEveryone: false,
    pinned: false,
    edited: false,
    deleted: false,
    createdAt: "2026-10-27T12:00:00.000Z",
    ...over,
  } as ChatMessage;
}

const state: UnreadState = {
  chats: [
    { kind: "room", id: ROOM, serverId: SERVER, lastReadId: null, unread: 0, mentions: 0, level: null },
    { kind: "dm", id: DM, serverId: null, lastReadId: null, unread: 0, mentions: 0, level: null },
  ],
  servers: {},
};

const mention = message({ body: `<@${SELF}>`, mentions: [SELF] });
const direct = message({ roomId: null, dmId: DM });

test("a mention and a DM notify while the window is out of focus", () => {
  assert.equal(shouldNotify(state, mention, SELF, null), true);
  assert.equal(shouldNotify(state, message({ mentionsEveryone: true }), SELF, null), true);
  assert.equal(shouldNotify(state, direct, SELF, null), true);
  // A plain room message stays quiet at the default "mentions"; "all" lets it through.
  assert.equal(shouldNotify(state, message({}), SELF, null), false);
  assert.equal(shouldNotify({ ...state, servers: { [SERVER]: "all" } }, message({}), SELF, null), true);
  assert.equal(shouldNotify(state, message({ authorId: SELF, mentions: [SELF] }), SELF, null), false);
});

test("nothing notifies in the conversation that is open and focused", () => {
  assert.equal(shouldNotify(state, mention, SELF, { kind: "room", id: ROOM }), false);
  assert.equal(shouldNotify(state, direct, SELF, { kind: "dm", id: DM }), false);
  // Another chat in view does not hide this one.
  assert.equal(shouldNotify(state, direct, SELF, { kind: "room", id: ROOM }), true);
  assert.equal(countMessage(state, mention, SELF, { kind: "room", id: ROOM }), state);
});

test("level none silences, whether set on the room, the server or the DM", () => {
  const room = { ...state, chats: state.chats.map((chat) => (chat.kind === "room" ? { ...chat, level: "none" as const } : chat)) };
  assert.equal(shouldNotify(room, mention, SELF, null), false);
  assert.equal(shouldNotify({ ...state, servers: { [SERVER]: "none" } }, mention, SELF, null), false);
  // The room's own level wins over its server's.
  const louder = {
    servers: { [SERVER]: "none" as const },
    chats: state.chats.map((chat) => (chat.kind === "room" ? { ...chat, level: "all" as const } : chat)),
  };
  assert.equal(shouldNotify(louder, message({}), SELF, null), true);
  const dm = { ...state, chats: state.chats.map((chat) => (chat.kind === "dm" ? { ...chat, level: "none" as const } : chat)) };
  assert.equal(shouldNotify(dm, direct, SELF, null), false);
  assert.equal(effectiveLevel(state, state.chats[1]!), "all");
  // Silenced chats leave the badge too.
  const counted = countMessage(room, mention, SELF, null);
  assert.deepEqual([badgeCount(counted), chatBadge(counted, { kind: "room", id: ROOM }).mentions], [0, 0]);
});

test("the title counter goes up with mentions and DMs and back to zero on read", () => {
  let held = countMessage(state, mention, SELF, null);
  held = countMessage(held, message({ id: "11" }), SELF, null);
  held = countMessage(held, { ...direct, id: "12" }, SELF, null);
  assert.equal(badgeCount(held), 2);
  assert.equal(titleWithCount("OpenMeet", badgeCount(held)), "(2) OpenMeet");
  assert.deepEqual(serverBadge(held, SERVER), { mentions: 1, unread: true });
  assert.deepEqual(chatBadge(held, { kind: "room", id: ROOM }), { mentions: 1, unread: true });

  held = clearChat(held, { kind: "room", id: ROOM });
  held = applyRead(held, { kind: "dm", id: DM, serverId: null, lastReadId: "12", unread: 0, mentions: 0, level: null });
  assert.equal(titleWithCount("OpenMeet", badgeCount(held)), "OpenMeet");
  assert.equal(titleWithCount("OpenMeet", 150), "(99+) OpenMeet");
});

test("the API answer is parsed strictly", () => {
  const body = {
    chats: [{ kind: "room", id: ROOM, serverId: SERVER, lastReadId: "3", unread: 2, mentions: 1, level: "all" }],
    servers: [{ serverId: SERVER, level: "none" }],
  };
  assert.deepEqual(parseUnreadState(body), { chats: body.chats, servers: { [SERVER]: "none" } });
  assert.equal(parseUnreadState({ chats: [{ ...body.chats[0], level: "loud" }], servers: [] }), undefined);
  assert.equal(parseUnreadState({ chats: [{ ...body.chats[0], unread: -1 }], servers: [] }), undefined);
  assert.equal(parseUnreadState(EMPTY_UNREAD), undefined);
});
