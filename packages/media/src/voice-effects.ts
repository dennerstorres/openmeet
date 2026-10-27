/** ADR 0020: local voice effects, built between the microphone source and the input gain. */
export const VOICE_EFFECTS = ["off", "robot", "radio", "telephone", "echo", "cave", "deep", "chipmunk", "monster"] as const;
export type VoiceEffect = (typeof VOICE_EFFECTS)[number];

/** Registered by `public/media/pitch-shift-worklet.js`, served by the bundle origin. */
export const PITCH_WORKLET_NAME = "openmeet-pitch-shift";
const PITCH_RATIO: Partial<Record<VoiceEffect, number>> = { deep: 0.75, chipmunk: 1.6, monster: 0.6 };

export function isVoiceEffect(value: unknown): value is VoiceEffect {
  return typeof value === "string" && (VOICE_EFFECTS as readonly string[]).includes(value);
}

export function needsWorklet(effect: VoiceEffect): boolean {
  return PITCH_RATIO[effect] !== undefined;
}

/** Without AudioWorklet the pitch effects leave the list; the others keep working. */
export function voiceEffectsFor(worklet: boolean): VoiceEffect[] {
  return VOICE_EFFECTS.filter((effect) => worklet || !needsWorklet(effect));
}

export function readAudioWorkletSupport(): boolean {
  return typeof AudioWorkletNode !== "undefined";
}

export interface EffectChain {
  input: AudioNode;
  output: AudioNode;
  dispose(): void;
}

function chain(nodes: AudioNode[], extra: AudioNode[] = [], sources: AudioScheduledSourceNode[] = []): EffectChain {
  for (let index = 0; index < nodes.length - 1; index++) nodes[index]!.connect(nodes[index + 1]!);
  return {
    input: nodes[0]!,
    output: nodes[nodes.length - 1]!,
    dispose: () => {
      for (const source of sources) {
        try {
          source.stop();
        } catch {
          // Already stopped.
        }
      }
      for (const node of [...nodes, ...extra, ...sources]) node.disconnect();
    },
  };
}

function filter(context: BaseAudioContext, type: BiquadFilterType, frequency: number, gain = 0): BiquadFilterNode {
  const node = context.createBiquadFilter();
  node.type = type;
  node.frequency.value = frequency;
  node.gain.value = gain;
  return node;
}

function shaper(context: BaseAudioContext, amount: number): WaveShaperNode {
  const node = context.createWaveShaper();
  const curve = new Float32Array(1024);
  for (let index = 0; index < curve.length; index++) {
    const x = (index / (curve.length - 1)) * 2 - 1;
    curve[index] = Math.tanh(amount * x) / Math.tanh(amount);
  }
  node.curve = curve;
  node.oversample = "2x";
  return node;
}

function gainOf(context: BaseAudioContext, value: number): GainNode {
  const node = context.createGain();
  node.gain.value = value;
  return node;
}

/** Dry signal plus a wet branch, mixed into one output. */
function wetDry(context: BaseAudioContext, wet: AudioNode[], level: number, extra: AudioNode[] = []): EffectChain {
  const input = gainOf(context, 1);
  const output = gainOf(context, 1);
  const send = gainOf(context, level);
  input.connect(output);
  input.connect(wet[0]!);
  for (let index = 0; index < wet.length - 1; index++) wet[index]!.connect(wet[index + 1]!);
  wet[wet.length - 1]!.connect(send);
  send.connect(output);
  return {
    input,
    output,
    dispose: () => {
      for (const node of [input, ...wet, ...extra, send, output]) node.disconnect();
    },
  };
}

function caveImpulse(context: BaseAudioContext, seconds: number): AudioBuffer {
  const length = Math.round(context.sampleRate * seconds);
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  let seed = 0x2f6b;
  for (let index = 0; index < length; index++) {
    // Fixed pseudo-random noise: every build of the cave sounds the same.
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    data[index] = ((seed / 0x7fffffff) * 2 - 1) * Math.pow(1 - index / length, 3);
  }
  return buffer;
}

/** Builds the effect graph; `null` means the voice passes untouched. */
export function buildVoiceEffect(context: BaseAudioContext, effect: VoiceEffect): EffectChain | null {
  switch (effect) {
    case "off":
      return null;
    case "robot": {
      // Ring modulation: the voice is multiplied by a low sine carrier.
      const ring = gainOf(context, 0);
      const carrier = context.createOscillator();
      carrier.type = "sine";
      carrier.frequency.value = 50;
      carrier.connect(ring.gain);
      carrier.start();
      const boost = gainOf(context, 1.6);
      return chain([ring, boost], [], [carrier]);
    }
    case "radio":
      return chain([filter(context, "highpass", 500), filter(context, "lowpass", 3000), shaper(context, 4), gainOf(context, 0.8)]);
    case "telephone":
      return chain([filter(context, "highpass", 300), filter(context, "lowpass", 3400), filter(context, "peaking", 1500, 6)]);
    case "echo": {
      const delay = context.createDelay(1);
      delay.delayTime.value = 0.28;
      const feedback = gainOf(context, 0.4);
      delay.connect(feedback);
      feedback.connect(delay);
      return wetDry(context, [delay], 0.6, [feedback]);
    }
    case "cave": {
      const reverb = context.createConvolver();
      reverb.buffer = caveImpulse(context, 2.5);
      return wetDry(context, [reverb], 0.7);
    }
    case "deep":
    case "chipmunk":
    case "monster": {
      const pitch = new AudioWorkletNode(context, PITCH_WORKLET_NAME, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        channelCount: 1,
        channelCountMode: "explicit",
        processorOptions: { ratio: PITCH_RATIO[effect] },
      });
      return effect === "monster" ? chain([pitch, shaper(context, 3), gainOf(context, 0.9)]) : chain([pitch]);
    }
  }
}
