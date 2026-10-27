import assert from "node:assert/strict";
import test from "node:test";
import { LocalAudioTrack, Room, Track, type AudioProcessorOptions } from "livekit-client";
import { InputGain } from "../src/input-gain.js";
import { LiveKitPocSession } from "../src/session.js";

test("microphone processing starts after track creation and before publication; failed publication stops capture", async () => {
  const room = new Room();
  const calls: string[] = [];
  const track = Object.create(LocalAudioTrack.prototype) as LocalAudioTrack;
  track.setProcessor = async () => {
    calls.push("process");
  };
  track.stop = () => {
    calls.push("stop");
  };
  const local = room.localParticipant as unknown as Record<string, unknown>;
  local.getTrackPublication = () => undefined;
  local.createTracks = async (options: unknown) => {
    assert.deepEqual(options, { audio: true, video: false });
    calls.push("capture");
    return [track];
  };
  local.publishTrack = async () => {
    calls.push("publish");
    throw new Error("publication failed");
  };
  const session = new LiveKitPocSession({ room });
  await assert.rejects(session.setMicrophone(true), /publication failed/);
  assert.deepEqual(calls, ["capture", "process", "publish", "stop"]);
});

// Graph lifecycle only; this is not evidence of audible media in WebView2.
test("input gain applies levels, rebuilds on device change and releases only owned output", async () => {
  const gain = new InputGain();
  assert.throws(() => gain.setVolume(NaN), RangeError);
  assert.throws(() => gain.setVolume(2.1), RangeError);
  assert.throws(() => gain.setVolume(-1), RangeError);
  const original = Object.getOwnPropertyDescriptor(globalThis, "MediaStream");
  Object.defineProperty(globalThis, "MediaStream", {
    configurable: true,
    value: class {
      constructor(readonly tracks: unknown[]) {}
    },
  });
  let stopped = 0;
  let disconnected = 0;
  const levels: { value: number }[] = [];
  const node = () => ({
    connect: () => undefined,
    disconnect: () => {
      disconnected++;
    },
  });
  const context = {
    state: "running",
    createMediaStreamSource: node,
    createGain: () => {
      const level = { value: 1 };
      levels.push(level);
      return { ...node(), gain: level };
    },
    createMediaStreamDestination: () => ({
      ...node(),
      stream: {
        getAudioTracks: () => [
          {
            stop: () => {
              stopped++;
            },
          },
        ],
      },
    }),
  } as unknown as AudioContext;
  const options: AudioProcessorOptions = { kind: Track.Kind.Audio, track: {} as MediaStreamTrack, audioContext: context };
  try {
    gain.setVolume(0.5);
    await gain.init(options);
    assert.equal(levels[0]?.value, 0.5);
    gain.setVolume(0);
    assert.equal(levels[0]?.value, 0);
    gain.setVolume(2);
    await gain.restart(options);
    assert.equal(levels[1]?.value, 2);
    assert.equal(stopped, 1);
    await gain.destroy();
    await gain.destroy();
    assert.equal(stopped, 2);
    // Each build unplugs the source once before wiring the (empty) effect.
    assert.equal(disconnected, 8);
    assert.equal(gain.processedTrack, undefined);
  } finally {
    if (original) Object.defineProperty(globalThis, "MediaStream", original);
    else Reflect.deleteProperty(globalThis, "MediaStream");
  }
});
