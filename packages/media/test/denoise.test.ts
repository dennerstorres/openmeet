import assert from "node:assert/strict";
import test from "node:test";
import { Track, type AudioProcessorOptions } from "livekit-client";
import { InputGain } from "../src/input-gain.js";

// ADR 0030. The fallback only; RNNoise itself needs a real AudioWorklet and a real microphone.

test("noise suppression off a 48 kHz context fails and leaves the voice plain", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "MediaStream");
  Object.defineProperty(globalThis, "MediaStream", { configurable: true, value: class {} });
  const node = () => ({ connect: () => undefined, disconnect: () => undefined });
  const context = {
    state: "running",
    sampleRate: 44_100,
    createMediaStreamSource: node,
    createGain: () => ({ ...node(), gain: { value: 1 } }),
    createMediaStreamDestination: () => ({ ...node(), stream: { getAudioTracks: () => [{ stop: () => undefined }] } }),
  } as unknown as AudioContext;
  const options: AudioProcessorOptions = { kind: Track.Kind.Audio, track: {} as MediaStreamTrack, audioContext: context };
  const gain = new InputGain({ denoiseUrl: () => "http://test/" });
  try {
    await gain.init(options);
    await assert.rejects(gain.setDenoise(true), /48 kHz/);
    assert.equal(gain.denoise, false);
    assert.ok(gain.processedTrack);
    await gain.destroy();
    // Before a microphone exists the choice is only kept.
    await gain.setDenoise(true);
    assert.equal(gain.denoise, true);
  } finally {
    if (original) Object.defineProperty(globalThis, "MediaStream", original);
    else Reflect.deleteProperty(globalThis, "MediaStream");
  }
});
