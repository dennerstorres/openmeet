import assert from "node:assert/strict";
import test from "node:test";
import { ServerError } from "livekit-server-sdk";
import { liveKitHttpHost, roomMedia } from "../src/rooms/media.js";

test("the SFU adapter revokes old tokens and treats a missing participant as already gone", async () => {
  const removed: { room: string; identity: string; revokeTokenTs?: bigint }[] = [];
  const media = roomMedia(
    {
      listParticipants: async () => [],
      removeParticipant: async (room, identity, options) => {
        removed.push({ room, identity, ...(options?.revokeTokenTs !== undefined ? { revokeTokenTs: options.revokeTokenTs } : {}) });
        if (identity === "gone") throw new ServerError("not_found", "missing", 404);
      },
      deleteRoom: async () => {},
    },
    () => 1_700_000_000_000,
  );
  await media.disconnect("sala", "user-1");
  await media.disconnect("sala", "gone");
  assert.deepEqual(removed, [
    { room: "sala", identity: "user-1", revokeTokenTs: 1_700_000_000n },
    { room: "sala", identity: "gone", revokeTokenTs: 1_700_000_000n },
  ]);
});

test("closing a room removes each participant before the room is deleted", async () => {
  const steps: string[] = [];
  const media = roomMedia({
    listParticipants: async (room) => {
      steps.push(`list ${room}`);
      return [{ identity: "a" }, { identity: "" }, { identity: "b" }];
    },
    removeParticipant: async (_room, identity) => {
      steps.push(`remove ${identity}`);
    },
    deleteRoom: async (room) => {
      steps.push(`delete ${room}`);
    },
  });
  await media.closeRoom("sala");
  assert.deepEqual(steps, ["list sala", "remove a", "remove b", "delete sala"]);
});

test("a livekit signal URL becomes the HTTP host used by room service", () => {
  assert.equal(liveKitHttpHost("ws://127.0.0.1:7880"), "http://127.0.0.1:7880");
  assert.equal(liveKitHttpHost("wss://livekit.example/path"), "https://livekit.example");
});
