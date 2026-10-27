import assert from "node:assert/strict";
import test from "node:test";

// ADR 0020: the worklet math on a synthetic tone. This is not proof of how a real voice sounds.

const RATE = 48000;
let Processor;
globalThis.sampleRate = RATE;
globalThis.AudioWorkletProcessor = class {};
globalThis.registerProcessor = (name, value) => {
  assert.equal(name, "openmeet-pitch-shift");
  Processor = value;
};
await import("../public/media/pitch-shift-worklet.js");

function run(ratio, frequency, seconds = 1) {
  const processor = new Processor({ processorOptions: { ratio } });
  const block = 128;
  const out = [];
  for (let start = 0; start < RATE * seconds; start += block) {
    const input = Float32Array.from({ length: block }, (_, index) => Math.sin((2 * Math.PI * frequency * (start + index)) / RATE));
    const output = [new Float32Array(block), new Float32Array(block)];
    assert.equal(processor.process([[input]], [output]), true);
    assert.deepEqual(output[1], output[0], "every output channel carries the same voice");
    out.push(...output[0]);
  }
  return out.slice(RATE / 4);
}

function dominant(samples) {
  // Power-weighted centre of a coarse DFT between 100 and 2000 Hz. The crossfade puts sidebands
  // at ± the grain rate around the shifted tone, so the centre, not the single peak, is the pitch.
  let weighted = 0;
  let total = 0;
  for (let frequency = 100; frequency <= 2000; frequency += 4) {
    let re = 0;
    let im = 0;
    for (let index = 0; index < samples.length; index += 2) {
      const angle = (2 * Math.PI * frequency * index) / RATE;
      re += samples[index] * Math.cos(angle);
      im += samples[index] * Math.sin(angle);
    }
    const power = re * re + im * im;
    weighted += power * frequency;
    total += power;
  }
  return weighted / total;
}

test("ratio moves a 440 Hz tone to the expected pitch", () => {
  for (const [ratio, expected] of [
    [1.6, 704],
    [0.75, 330],
    [0.6, 264],
  ]) {
    const found = dominant(run(ratio, 440));
    // Within 8%: the sidebands are not perfectly symmetric, and an effect does not need tuner accuracy.
    assert.ok(Math.abs(found - expected) <= expected * 0.08, `ratio ${ratio}: expected about ${expected} Hz, got ${found}`);
  }
});

test("level stays near the input and silence stays silent", () => {
  const tone = run(0.75, 440);
  const rms = Math.sqrt(tone.reduce((sum, value) => sum + value * value, 0) / tone.length);
  assert.ok(rms > 0.45 && rms < 0.85, `rms ${rms}`);
  const processor = new Processor({ processorOptions: { ratio: 1.6 } });
  const output = [new Float32Array(128)];
  processor.process([[]], [output]);
  assert.ok(output[0].every((value) => value === 0));
});

test("an invalid ratio passes the voice through", () => {
  const found = dominant(run(Number.NaN, 440, 0.5));
  assert.ok(Math.abs(found - 440) <= 10, `got ${found}`);
});
