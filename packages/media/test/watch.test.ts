import assert from "node:assert/strict";
import test from "node:test";
import { formatElapsed, meetingElapsedMs } from "../src/watch.js";

test("the meeting clock keeps running through reconnect and stops on a fatal end", () => {
  assert.equal(meetingElapsedMs(1_000, 61_000, "connected"), 60_000);
  assert.equal(meetingElapsedMs(1_000, 91_000, "reconnecting"), 90_000);
  assert.equal(meetingElapsedMs(1_000, 91_000, "fatal"), null);
  assert.equal(meetingElapsedMs(null, 91_000, "connected"), null);
  assert.equal(meetingElapsedMs(5_000, 1_000, "connected"), 0);
});

test("elapsed time reads as minutes until the hour", () => {
  assert.equal(formatElapsed(0), "0:00");
  assert.equal(formatElapsed(5_000), "0:05");
  assert.equal(formatElapsed(65_000), "1:05");
  assert.equal(formatElapsed(3_661_000), "1:01:01");
});
