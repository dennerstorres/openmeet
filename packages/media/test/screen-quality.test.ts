import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_SCREEN_MODE, screenCapture, screenPublish } from "../src/screen-quality.js";

// ADR 0029. Option shapes only; image quality and the VP9 backup need a real call on the SFU.

test("default mode keeps text sharp", () => {
  assert.equal(DEFAULT_SCREEN_MODE, "detail");
  const c = screenCapture("detail", false);
  assert.equal(c.contentHint, "detail");
  assert.deepEqual(c.resolution, { width: 2560, height: 1440, frameRate: 30 });
  assert.equal(c.audio, false);
  assert.equal("systemAudio" in c, false);
  assert.equal(screenPublish("detail").degradationPreference, "maintain-resolution");
});

test("motion mode keeps the frame rate", () => {
  const c = screenCapture("motion", true);
  assert.equal(c.contentHint, "motion");
  assert.equal(c.resolution?.frameRate, 60);
  assert.equal(c.systemAudio, "include");
  const p = screenPublish("motion");
  assert.equal(p.degradationPreference, "maintain-framerate");
  assert.deepEqual(p.screenShareEncoding, { maxBitrate: 6_000_000, maxFramerate: 60, priority: "high" });
});

test("VP9 with a backup codec and PC audio as stereo music", () => {
  for (const mode of ["motion", "detail"] as const) {
    const p = screenPublish(mode);
    assert.equal(p.videoCodec, "vp9");
    assert.equal(p.backupCodec, true);
    assert.equal(p.forceStereo, true);
    assert.equal(p.dtx, false);
    assert.equal(p.red, false);
  }
});
