import assert from "node:assert/strict";
import test from "node:test";
import { LocalAudioTrack, Room, Track, type AudioProcessorOptions } from "livekit-client";
import { InputGain } from "../src/input-gain.js";
import { LiveKitPocSession } from "../src/session.js";
import { VOICE_EFFECTS, buildVoiceEffect, isVoiceEffect, voiceEffectsFor } from "../src/voice-effects.js";

// Graph wiring and lifecycle only. These fakes prove no sound; ADR 0020 asks for real microphones.

interface FakeNode {
  kind: string;
  targets: unknown[];
  disconnected: number;
  stopped?: number;
  options?: { processorOptions?: { ratio?: number } };
  connect(target: unknown): void;
  disconnect(target?: unknown): void;
}

function fakeContext() {
  const nodes: FakeNode[] = [];
  const modules: string[] = [];
  let failModule = false;
  const param = (value = 0) => ({ value });
  const node = (kind: string, extra: object = {}): FakeNode => {
    const created: FakeNode = {
      kind,
      targets: [],
      disconnected: 0,
      connect(target) {
        this.targets.push(target);
      },
      disconnect(target) {
        this.disconnected++;
        this.targets = target === undefined ? [] : this.targets.filter((item) => item !== target);
      },
      ...extra,
    };
    nodes.push(created);
    return created;
  };
  const destination = node("speakers");
  const context = {
    state: "running",
    sampleRate: 48000,
    destination,
    audioWorklet: {
      addModule: async (url: string) => {
        if (failModule) throw new Error("module refused");
        modules.push(url);
      },
    },
    createMediaStreamSource: () => node("source"),
    createGain: () => node("gain", { gain: param(1) }),
    createBiquadFilter: () => node("filter", { type: "lowpass", frequency: param(), gain: param() }),
    createWaveShaper: () => node("shaper", { curve: null, oversample: "none" }),
    createDelay: () => node("delay", { delayTime: param() }),
    createConvolver: () => node("convolver", { buffer: null }),
    createBuffer: (_channels: number, length: number) => {
      const data = new Float32Array(length);
      return { getChannelData: () => data };
    },
    createOscillator: () =>
      node("oscillator", {
        type: "sine",
        frequency: param(),
        stopped: 0,
        start() {},
        stop() {
          (this as FakeNode).stopped = ((this as FakeNode).stopped ?? 0) + 1;
        },
      }),
    createBufferSource: () =>
      node("buffer", {
        buffer: null,
        onended: null,
        started: 0,
        start() {
          (this as unknown as { started: number }).started++;
        },
        stop() {
          (this as unknown as { onended: (() => void) | null }).onended?.();
        },
      }),
    decodeAudioData: async (data: ArrayBuffer) => ({ length: data.byteLength }),
    createMediaStreamDestination: () =>
      node("destination", {
        stream: { getAudioTracks: () => [{ stop: () => undefined }] },
      }),
  };
  return {
    context: context as unknown as AudioContext,
    nodes,
    modules,
    destination,
    failNextModule: () => {
      failModule = true;
    },
  };
}

function withAudioGlobals(run: (nodes: FakeNode[]) => Promise<void>, nodes: FakeNode[]): Promise<void> {
  const saved = ["MediaStream", "AudioWorkletNode"].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  Object.defineProperty(globalThis, "MediaStream", { configurable: true, value: class {} });
  Object.defineProperty(globalThis, "AudioWorkletNode", {
    configurable: true,
    value: function (_context: unknown, _name: string, options: FakeNode["options"]) {
      const created: FakeNode = {
        kind: "pitch",
        targets: [],
        disconnected: 0,
        ...(options ? { options } : {}),
        connect(target) {
          this.targets.push(target);
        },
        disconnect() {
          this.disconnected++;
          this.targets = [];
        },
      };
      nodes.push(created);
      return created;
    },
  });
  return run(nodes).finally(() => {
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  });
}

test("the effect list drops pitch effects without AudioWorklet and rejects unknown names", () => {
  assert.deepEqual(voiceEffectsFor(true), [...VOICE_EFFECTS]);
  assert.deepEqual(voiceEffectsFor(false), ["off", "robot", "radio", "telephone", "echo", "cave"]);
  assert.equal(isVoiceEffect("robot"), true);
  assert.equal(isVoiceEffect("whisper"), false);
  assert.equal(isVoiceEffect(undefined), false);
});

test("every effect builds a graph that dispose fully unplugs", async () => {
  const fake = fakeContext();
  await withAudioGlobals(async () => {
    assert.equal(buildVoiceEffect(fake.context, "off"), null);
    for (const effect of VOICE_EFFECTS.filter((name) => name !== "off")) {
      const start = fake.nodes.length;
      const chain = buildVoiceEffect(fake.context, effect);
      assert.ok(chain, effect);
      const built = fake.nodes.slice(start);
      chain.dispose();
      for (const node of built) assert.ok(node.disconnected > 0, `${effect}: ${node.kind} left connected`);
      for (const node of built.filter((item) => item.kind === "oscillator")) assert.equal(node.stopped, 1);
    }
    const ratios = fake.nodes.filter((node) => node.kind === "pitch").map((node) => node.options?.processorOptions?.ratio);
    assert.deepEqual(ratios, [0.75, 1.6, 0.6]);
  }, fake.nodes);
});

test("switching effects keeps the published track, loads the worklet once and survives a device restart", async () => {
  const fake = fakeContext();
  await withAudioGlobals(async () => {
    const gain = new InputGain({ workletUrl: () => "https://app.test/media/pitch-shift-worklet.js" });
    const options: AudioProcessorOptions = { kind: Track.Kind.Audio, track: {} as MediaStreamTrack, audioContext: fake.context };
    await gain.setEffect("robot");
    await gain.init(options);
    const published = gain.processedTrack;
    const source = () => fake.nodes.filter((node) => node.kind === "source").at(-1)!;
    assert.equal((source().targets[0] as FakeNode).kind, "gain", "robot starts with its ring gain");

    await gain.setEffect("echo");
    assert.equal(gain.processedTrack, published, "no new track on switch");
    await gain.setEffect("deep");
    await gain.setEffect("chipmunk");
    assert.deepEqual(fake.modules, ["https://app.test/media/pitch-shift-worklet.js"]);
    assert.equal((source().targets[0] as FakeNode).kind, "pitch");

    await gain.setEffect("off");
    const outputGain = source().targets[0] as FakeNode & { gain: { value: number } };
    gain.setVolume(1.5);
    assert.equal(outputGain.gain.value, 1.5, "plain voice goes straight to the input gain");

    await gain.setEffect("monster");
    await gain.restart(options);
    assert.equal(gain.effect, "monster");
    assert.equal((source().targets[0] as FakeNode).kind, "pitch", "effect rebuilt on the new graph");
    assert.equal(fake.modules.length, 1, "same context, module not reloaded");

    await assert.rejects(gain.setEffect("loud" as never), RangeError);
    await gain.destroy();
  }, fake.nodes);
});

test("a worklet that fails to load falls back to the plain voice without dropping the microphone", async () => {
  const fake = fakeContext();
  await withAudioGlobals(async () => {
    const gain = new InputGain({ workletUrl: () => "media/pitch-shift-worklet.js" });
    await gain.init({ kind: Track.Kind.Audio, track: {} as MediaStreamTrack, audioContext: fake.context });
    const published = gain.processedTrack;
    fake.failNextModule();
    await assert.rejects(gain.setEffect("deep"), /module refused/);
    assert.equal(gain.effect, "off");
    assert.equal(gain.processedTrack, published);
    const source = fake.nodes.filter((node) => node.kind === "source").at(-1)!;
    assert.equal((source.targets[0] as FakeNode).kind, "gain");

    // A pitch effect picked before the microphone exists also falls back at init.
    const late = new InputGain({ workletUrl: () => "media/pitch-shift-worklet.js" });
    await late.setEffect("chipmunk");
    await late.init({ kind: Track.Kind.Audio, track: {} as MediaStreamTrack, audioContext: fake.context });
    assert.equal(late.effect, "off");
    assert.ok(late.processedTrack);
  }, fake.nodes);
});

test("the monitor plays the processed voice locally and unplugs when turned off", async () => {
  const fake = fakeContext();
  await withAudioGlobals(async () => {
    const gain = new InputGain();
    gain.setMonitor(true);
    await gain.init({ kind: Track.Kind.Audio, track: {} as MediaStreamTrack, audioContext: fake.context });
    // The sound bus also reaches the speakers; the monitor is the gain that reaches only them.
    const monitor = fake.nodes.find((node) => node.kind === "gain" && node.targets.length === 1 && node.targets[0] === fake.destination);
    assert.ok(monitor, "monitor reaches the speakers");
    gain.setMonitor(false);
    assert.equal(monitor.targets.length, 0);
    assert.equal(gain.monitor, false);
    await gain.destroy();
  }, fake.nodes);
});

test("the session reports the effects it can run and resets them when the room disconnects", async () => {
  const room = new Room();
  const session = new LiveKitPocSession({ room, audioWorklet: false });
  assert.deepEqual(session.snapshot().voiceEffects, voiceEffectsFor(false));
  assert.equal(session.snapshot().voiceEffect, "off");
  await session.setVoiceEffect("robot");
  session.setVoiceMonitor(true);
  assert.equal(session.snapshot().voiceEffect, "robot");
  assert.equal(session.snapshot().voiceMonitor, true);
  (room as unknown as { emit(event: string): boolean }).emit("disconnected");
  await Promise.resolve();
  assert.equal(session.snapshot().voiceEffect, "off");
  assert.equal(session.snapshot().voiceMonitor, false);
});

// ADR 0021: library sounds share the microphone graph. Wiring only; a real room must prove the sound.

type FakeSource = FakeNode & { started: number; onended: (() => void) | null; stop(): void };

test("sounds skip the voice path, cut each other, and stop with the graph", async () => {
  const fake = fakeContext();
  await withAudioGlobals(async () => {
    const gain = new InputGain();
    await assert.rejects(gain.decodeSound(new Uint8Array(4)), /microphone_unavailable/);
    await assert.rejects(gain.playSound({} as AudioBuffer), /microphone_unavailable/);
    assert.throws(() => gain.setSoundVolume(1.5), RangeError);
    gain.setSoundVolume(0.4);
    await gain.init({ kind: Track.Kind.Audio, track: {} as MediaStreamTrack, audioContext: fake.context });
    const published = fake.nodes.find((node) => node.kind === "destination")!;
    const gains = fake.nodes.filter((node) => node.kind === "gain") as (FakeNode & { gain: { value: number } })[];
    const gate = gains.find((node) => node.targets.includes(published) && !node.targets.includes(fake.destination));
    const bus = gains.find((node) => node.targets.includes(published) && node.targets.includes(fake.destination));
    assert.ok(gate && bus, "voice gate and sound bus both reach the published track; only the bus reaches the speakers");
    assert.equal(bus.gain.value, 0.4);

    gain.setVoiceOpen(false);
    assert.equal(gate.gain.value, 0);
    gain.setVoiceOpen(true);
    assert.equal(gate.gain.value, 1);

    const buffer = await gain.decodeSound(new Uint8Array(10));
    let firstEnded = false;
    const first = gain.playSound(buffer).then(() => {
      firstEnded = true;
    });
    const firstNode = fake.nodes.filter((node) => node.kind === "buffer").at(-1) as FakeSource;
    assert.equal(firstNode.started, 1);
    assert.ok(firstNode.targets.includes(bus));
    assert.equal(gain.soundPlaying, true);
    const second = gain.playSound(buffer);
    await first;
    assert.equal(firstEnded, true, "a new sound cuts the previous one");
    const secondNode = fake.nodes.filter((node) => node.kind === "buffer").at(-1) as FakeSource;
    assert.notEqual(secondNode, firstNode);
    secondNode.onended?.();
    await second;
    assert.equal(gain.soundPlaying, false);

    const third = gain.playSound(buffer);
    await gain.restart({ kind: Track.Kind.Audio, track: {} as MediaStreamTrack, audioContext: fake.context });
    await third;
    assert.equal(gain.soundPlaying, false, "a device change leaves no sound behind");
    assert.equal(gain.soundVolume, 0.4);
    await gain.destroy();
  }, fake.nodes);
});

const SOUND = "11111111-2222-4333-8444-555555555555";

function soundRoom(muted: boolean) {
  const room = new Room();
  const calls: string[] = [];
  const state = { muted };
  const track = Object.create(LocalAudioTrack.prototype) as LocalAudioTrack;
  const local = room.localParticipant as unknown as Record<string, unknown>;
  Object.defineProperty(local, "isMicrophoneEnabled", { configurable: true, get: () => !state.muted });
  local.getTrackPublication = (source: Track.Source) => (source === Track.Source.Microphone ? { track } : undefined);
  local.setMicrophoneEnabled = async (enabled: boolean) => {
    calls.push(enabled ? "enable" : "disable");
    state.muted = !enabled;
  };
  track.unmute = async () => {
    calls.push("unmute");
    state.muted = false;
    return track;
  };
  track.mute = async () => {
    calls.push("mute");
    state.muted = true;
    return track;
  };
  return { room, track, calls, state };
}

function fakeGain(session: LiveKitPocSession, track: LocalAudioTrack) {
  const events: string[] = [];
  let finish: (() => void) | undefined;
  const gain = {
    effect: "off",
    monitor: false,
    soundVolume: 1,
    decodeSound: async () => ({}) as AudioBuffer,
    setVoiceOpen: (open: boolean) => events.push(open ? "voice-open" : "voice-closed"),
    playSound: () =>
      new Promise<void>((resolve) => {
        events.push("play");
        finish = resolve;
      }),
    stopSound: () => {
      events.push("stop");
      finish?.();
    },
    setMonitor: () => undefined,
    setEffect: async () => undefined,
  };
  track.getProcessor = () => gain as never;
  (session as unknown as { inputGain: unknown }).inputGain = gain;
  return { events, end: () => finish?.() };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("a sound opens a muted microphone with the voice at zero and closes it again", async () => {
  const { room, track, calls, state } = soundRoom(true);
  const session = new LiveKitPocSession({ room, audioWorklet: false });
  const { events, end } = fakeGain(session, track);

  await session.playSound(SOUND, new Uint8Array(46));
  assert.deepEqual(calls, ["unmute"]);
  assert.deepEqual(events, ["voice-closed", "play"]);
  assert.equal(session.snapshot().soundPlaying, SOUND);
  end();
  await tick();
  assert.deepEqual(calls, ["unmute", "mute"]);
  assert.deepEqual(events.slice(-1), ["voice-open"], "the voice comes back only after the track is muted");
  assert.equal(state.muted, true);
  assert.equal(session.snapshot().soundPlaying, null);
});

test("an open microphone stays open, and muting during a sound stops it", async () => {
  const open = soundRoom(false);
  const session = new LiveKitPocSession({ room: open.room, audioWorklet: false });
  const fake = fakeGain(session, open.track);
  await session.playSound(SOUND, new Uint8Array(46));
  fake.end();
  await tick();
  assert.deepEqual(open.calls, [], "nothing to unmute or mute back");
  assert.equal(fake.events.includes("voice-closed"), false);

  const muted = soundRoom(true);
  const other = new LiveKitPocSession({ room: muted.room, audioWorklet: false });
  const held = fakeGain(other, muted.track);
  await other.playSound(SOUND, new Uint8Array(46));
  await other.setMicrophone(false).catch(() => undefined);
  assert.ok(held.events.includes("stop"), "the user's mute stops the sound");
  assert.ok(held.events.includes("voice-open"));
  await tick();
  assert.equal(muted.calls.includes("mute"), false, "no automatic close after the user chose");
});

test("without a processed microphone there is nothing to play into", async () => {
  const room = new Room();
  const local = room.localParticipant as unknown as Record<string, unknown>;
  local.getTrackPublication = () => undefined;
  const session = new LiveKitPocSession({ room, audioWorklet: false });
  await assert.rejects(session.playSound(SOUND, new Uint8Array(46)), /microphone_unavailable/);
});
