import assert from "node:assert/strict";
import test from "node:test";
import { SOUND_MAX_BYTES, SOUND_SAMPLE_RATE, encodeSound, parseOwnSounds, parseSoundLibrary, prepareInstanceRequest, sniffSound } from "../src/index.js";

const ID = "11111111-2222-4333-8444-555555555555";
const OTHER = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

test("encoded sounds round-trip through the validator with the exact duration", () => {
  const second = new Float32Array(SOUND_SAMPLE_RATE).map((_, index) => Math.sin(index / 10));
  const bytes = encodeSound(second);
  assert.deepEqual(sniffSound(bytes), { samples: SOUND_SAMPLE_RATE, durationMs: 1000 });
  const longest = encodeSound(new Float32Array(SOUND_SAMPLE_RATE * 20));
  assert.equal(longest.length, SOUND_MAX_BYTES);
  assert.equal(sniffSound(longest)?.durationMs, 20_000);
  assert.throws(() => encodeSound(new Float32Array(SOUND_SAMPLE_RATE * 20 + 1)), /sound_too_long/);
  assert.throws(() => encodeSound(new Float32Array(0)), /sound_too_long/);
  // Out-of-range and NaN samples are clamped instead of wrapping.
  const clamped = encodeSound(Float32Array.from([2, -2, Number.NaN]));
  const view = new DataView(clamped.buffer);
  assert.deepEqual([view.getInt16(44, true), view.getInt16(46, true), view.getInt16(48, true)], [32767, -32767, 0]);
});

test("anything off the canonical layout is refused", () => {
  const good = encodeSound(new Float32Array(2400));
  const broken = (change: (bytes: Uint8Array, view: DataView) => void) => {
    const copy = good.slice();
    change(copy, new DataView(copy.buffer));
    return sniffSound(copy);
  };
  assert.equal(
    broken((_, view) => view.setUint16(22, 2, true)),
    undefined,
    "stereo",
  );
  assert.equal(
    broken((_, view) => view.setUint32(24, 48000, true)),
    undefined,
    "48 kHz",
  );
  assert.equal(
    broken((_, view) => view.setUint16(34, 8, true)),
    undefined,
    "8 bits",
  );
  assert.equal(
    broken((_, view) => view.setUint16(20, 3, true)),
    undefined,
    "float",
  );
  assert.equal(
    broken((_, view) => view.setUint32(40, 9999, true)),
    undefined,
    "lying data size",
  );
  assert.equal(
    broken((_, view) => view.setUint32(4, 1, true)),
    undefined,
    "lying RIFF size",
  );
  assert.equal(
    broken((bytes) => bytes.set([0x4c, 0x49, 0x53, 0x54], 36)),
    undefined,
    "extra chunk",
  );
  assert.equal(sniffSound(good.subarray(0, good.length - 2)), undefined, "truncated");
  assert.equal(sniffSound(new Uint8Array(SOUND_MAX_BYTES + 2)), undefined, "too big");
  assert.equal(sniffSound(new Uint8Array(0)), undefined);
  // Valid header shape but past 20 s cannot exist within the byte cap.
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(60).fill(0)]);
  assert.equal(sniffSound(png), undefined);
});

test("library lists keep only sane entries", () => {
  const sounds = parseSoundLibrary({
    sounds: [
      { id: ID.toUpperCase(), name: "Buzina", durationMs: 1500, mine: true, canRemove: true },
      { id: OTHER, name: "Palmas", durationMs: 20_000, mine: "yes", canRemove: 1 },
      { id: "nope", name: "x", durationMs: 10 },
      { id: OTHER, name: "", durationMs: 10 },
      { id: OTHER, name: "x", durationMs: 20_001 },
      { id: OTHER, name: "a".repeat(33), durationMs: 10 },
    ],
  });
  assert.deepEqual(sounds, [
    { id: ID, name: "Buzina", durationMs: 1500, mine: true, canRemove: true },
    { id: OTHER, name: "Palmas", durationMs: 20_000, mine: false, canRemove: false },
  ]);
  assert.deepEqual(parseSoundLibrary(null), []);
  assert.deepEqual(parseOwnSounds({ sounds: [{ id: ID, name: "Buzina", durationMs: 900, serverIds: [OTHER, "bad", 3] }] }), [
    { id: ID, name: "Buzina", durationMs: 900, serverIds: [OTHER] },
  ]);
});

test("only the sound routes of ADR 0021 pass the instance path check", () => {
  const origin = "https://meet.example.com";
  for (const path of [
    `/api/v1/servers/${ID}/sounds`,
    `/api/v1/servers/${ID}/sounds/${OTHER}/import`,
    `/api/v1/servers/${ID}/sounds/${OTHER}/remove`,
    `/api/v1/sounds/${ID}`,
    `/api/v1/sounds/${ID}/rename`,
    `/api/v1/sounds/${ID}/delete`,
    "/api/v1/sounds/mine",
  ]) {
    assert.equal(prepareInstanceRequest(origin, origin, "GET", path, null, null).url, `${origin}${path}`);
  }
  for (const path of [
    `/api/v1/servers/${ID}/sounds/${OTHER}`,
    `/api/v1/servers/${ID}/sounds/nope/import`,
    `/api/v1/sounds/${ID}/play`,
    "/api/v1/sounds",
    "/api/v1/sounds/everyone",
  ]) {
    assert.throws(() => prepareInstanceRequest(origin, origin, "GET", path, null, null), /not part of the instance API/, path);
  }
});
