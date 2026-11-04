import assert from "node:assert/strict";
import test from "node:test";
import { Room } from "livekit-client";
import { roomOptions } from "../src/room-options.js";

// ADR 0029, F15-03. Only the flags; the bandwidth saving needs a real call with three or more people.

test("the room adapts the received layer and pauses unused ones", () => {
  assert.deepEqual(roomOptions(), { adaptiveStream: true, dynacast: true });
  const room = new Room(roomOptions());
  assert.equal(room.options.dynacast, true);
  assert.ok(room.options.adaptiveStream);
});
