import assert from "node:assert/strict";
import test from "node:test";
import { applyPlayback, clampVolume, DEFAULT_PLAYBACK, effectivePlayback, nextPlayback, publicationControlsEnabled } from "../src/playback.js";

test("reception volume stays between silence and full and ignores a bad number", () => {
  assert.equal(clampVolume(-2), 0);
  assert.equal(clampVolume(0), 0);
  assert.equal(clampVolume(0.4), 0.4);
  assert.equal(clampVolume(3), 1);
  assert.equal(clampVolume(Number.NaN), 1);
});

test("local mute and volume replace only the element and keep the other choice", () => {
  const quieter = nextPlayback(DEFAULT_PLAYBACK, { volume: 0.25 });
  assert.deepEqual(quieter, { heard: true, volume: 0.25 });
  const silent = nextPlayback(quieter, { heard: false });
  assert.deepEqual(silent, { heard: false, volume: 0.25 });
  const element = { muted: false, volume: 1 };
  applyPlayback(element, silent);
  assert.deepEqual(element, { muted: true, volume: 0.25 });
});

test("microphone and camera controls follow the room connection", () => {
  assert.equal(publicationControlsEnabled("connected"), true);
  assert.equal(publicationControlsEnabled("reconnecting"), true);
  assert.equal(publicationControlsEnabled("idle"), false);
  assert.equal(publicationControlsEnabled("fatal"), false);
});

test("deafening cuts every card here and gives each card its own level back", () => {
  const quiet = { heard: true, volume: 0.3 };
  const muted = { heard: false, volume: 0.8 };
  assert.deepEqual(effectivePlayback(quiet, true), { heard: false, volume: 0.3 });
  assert.deepEqual(effectivePlayback(muted, true), { heard: false, volume: 0.8 });
  assert.equal(effectivePlayback(quiet, false), quiet);
  assert.equal(effectivePlayback(muted, false), muted);
  const element = { muted: false, volume: 1 };
  applyPlayback(element, effectivePlayback(quiet, true));
  assert.deepEqual(element, { muted: true, volume: 0.3 });
  applyPlayback(element, effectivePlayback(quiet, false));
  assert.deepEqual(element, { muted: false, volume: 0.3 });
});
