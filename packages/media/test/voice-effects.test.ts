import assert from "node:assert/strict";
import test from "node:test";
import { Room, Track, type AudioProcessorOptions } from "livekit-client";
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
    const monitor = fake.nodes.find((node) => node.kind === "gain" && node.targets.includes(fake.destination));
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
