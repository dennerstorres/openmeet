import type { AudioProcessorOptions, Track, TrackProcessor } from "livekit-client";
import { buildVoiceEffect, isVoiceEffect, needsWorklet, type EffectChain, type VoiceEffect } from "./voice-effects.js";

export interface InputGainOptions {
  /** URL of the pitch worklet module; defaults to the bundle's `media/` folder. */
  workletUrl?: () => string;
}

function defaultWorkletUrl(): string {
  return new URL("media/pitch-shift-worklet.js", document.baseURI).href;
}

/**
 * Changes outgoing microphone audio, never local playback or screen audio.
 * Graph: source → voice effect (ADR 0020) → gain → voice gate → published track, plus an optional local monitor.
 * Library sounds (ADR 0021) enter after the gate, so they skip the effect and the microphone volume, and also
 * play on this device.
 */
export class InputGain implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  readonly name = "openmeet-input-gain";
  processedTrack?: MediaStreamTrack;
  private context: AudioContext | undefined;
  private source: MediaStreamAudioSourceNode | undefined;
  private gain: GainNode | undefined;
  private destination: MediaStreamAudioDestinationNode | undefined;
  private chain: EffectChain | null = null;
  private monitorNode: GainNode | undefined;
  private voiceGate: GainNode | undefined;
  private soundBus: GainNode | undefined;
  private playingSound: { node: AudioBufferSourceNode; done: () => void } | undefined;
  private voiceOpen = true;
  private soundLevel = 1;
  private volume = 1;
  private currentEffect: VoiceEffect = "off";
  private monitoring = false;
  private readonly loaded = new WeakSet<BaseAudioContext>();
  private readonly workletUrl: () => string;

  constructor(options?: InputGainOptions) {
    this.workletUrl = options?.workletUrl ?? defaultWorkletUrl;
  }

  get effect(): VoiceEffect {
    return this.currentEffect;
  }

  get monitor(): boolean {
    return this.monitoring;
  }

  get soundPlaying(): boolean {
    return this.playingSound !== undefined;
  }

  get soundVolume(): number {
    return this.soundLevel;
  }

  /** Closed while a sound plays with the microphone muted: the sound goes out, the voice does not. */
  setVoiceOpen(open: boolean): void {
    this.voiceOpen = open;
    if (this.voiceGate) this.voiceGate.gain.value = open ? 1 : 0;
  }

  setSoundVolume(value: number): void {
    if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError("Invalid sound volume");
    this.soundLevel = value;
    if (this.soundBus) this.soundBus.gain.value = value;
  }

  /** Decodes with the context of the live graph; without a microphone there is nothing to play into. */
  async decodeSound(bytes: Uint8Array): Promise<AudioBuffer> {
    if (!this.context) throw new Error("microphone_unavailable");
    return this.context.decodeAudioData(bytes.slice().buffer);
  }

  /** Plays one sound into the published track and on this device. A new one cuts the previous; resolves when it ends or stops. */
  playSound(buffer: AudioBuffer): Promise<void> {
    if (!this.context || !this.soundBus) return Promise.reject(new Error("microphone_unavailable"));
    this.stopSound();
    const node = this.context.createBufferSource();
    node.buffer = buffer;
    node.connect(this.soundBus);
    return new Promise((resolve) => {
      let finished = false;
      const done = () => {
        if (finished) return;
        finished = true;
        if (this.playingSound?.node === node) this.playingSound = undefined;
        node.disconnect();
        resolve();
      };
      node.onended = done;
      this.playingSound = { node, done };
      node.start();
    });
  }

  stopSound(): void {
    const current = this.playingSound;
    if (!current) return;
    this.playingSound = undefined;
    try {
      current.node.stop();
    } catch {
      // Already ended.
    }
    current.done();
  }

  setVolume(value: number): void {
    if (!Number.isFinite(value) || value < 0 || value > 2) throw new RangeError("Invalid microphone volume");
    this.volume = value;
    if (this.gain) this.gain.gain.value = value;
  }

  /** Swaps the effect inside the live graph; the published track stays the same. A failure falls back to the plain voice. */
  async setEffect(effect: VoiceEffect): Promise<void> {
    if (!isVoiceEffect(effect)) throw new RangeError("Invalid voice effect");
    this.currentEffect = effect;
    if (!this.context || !this.source || !this.gain) return;
    try {
      await this.wire(this.context);
    } catch (error) {
      this.currentEffect = "off";
      await this.wire(this.context);
      throw error;
    }
  }

  /** Plays the processed voice on this device only, for "Ouvir minha voz". */
  setMonitor(enabled: boolean): void {
    this.monitoring = enabled;
    this.connectMonitor();
  }

  async init({ track, audioContext }: AudioProcessorOptions): Promise<void> {
    try {
      if (audioContext.state === "suspended") await audioContext.resume();
      this.context = audioContext;
      this.source = audioContext.createMediaStreamSource(new MediaStream([track]));
      this.gain = audioContext.createGain();
      this.gain.gain.value = this.volume;
      this.destination = audioContext.createMediaStreamDestination();
      this.voiceGate = audioContext.createGain();
      this.voiceGate.gain.value = this.voiceOpen ? 1 : 0;
      this.gain.connect(this.voiceGate);
      this.voiceGate.connect(this.destination);
      this.soundBus = audioContext.createGain();
      this.soundBus.gain.value = this.soundLevel;
      this.soundBus.connect(this.destination);
      this.soundBus.connect(audioContext.destination);
      try {
        await this.wire(audioContext);
      } catch {
        // A broken effect never takes the microphone down; the voice goes out plain.
        this.currentEffect = "off";
        await this.wire(audioContext);
      }
      this.connectMonitor();
      const output = this.destination.stream.getAudioTracks()[0];
      if (!output) throw new Error("Microphone processing unavailable");
      this.processedTrack = output;
    } catch (error) {
      await this.destroy();
      throw error;
    }
  }

  async restart(options: AudioProcessorOptions): Promise<void> {
    await this.destroy();
    await this.init(options);
  }

  async destroy(): Promise<void> {
    this.stopSound();
    this.source?.disconnect();
    this.chain?.dispose();
    this.gain?.disconnect();
    this.destination?.disconnect();
    this.monitorNode?.disconnect();
    this.voiceGate?.disconnect();
    this.soundBus?.disconnect();
    this.processedTrack?.stop();
    this.context = undefined;
    this.source = undefined;
    this.chain = null;
    this.gain = undefined;
    this.destination = undefined;
    this.monitorNode = undefined;
    this.voiceGate = undefined;
    this.soundBus = undefined;
    delete this.processedTrack;
  }

  private async wire(context: AudioContext): Promise<void> {
    const effect = this.currentEffect;
    if (needsWorklet(effect) && !this.loaded.has(context)) {
      await context.audioWorklet.addModule(this.workletUrl());
      this.loaded.add(context);
    }
    if (!this.source || !this.gain || effect !== this.currentEffect) return;
    const next = buildVoiceEffect(context, effect);
    this.source.disconnect();
    this.chain?.dispose();
    this.chain = next;
    if (next) {
      this.source.connect(next.input);
      next.output.connect(this.gain);
    } else {
      this.source.connect(this.gain);
    }
  }

  private connectMonitor(): void {
    if (!this.context || !this.gain) return;
    if (this.monitoring && !this.monitorNode) {
      this.monitorNode = this.context.createGain();
      this.gain.connect(this.monitorNode);
      this.monitorNode.connect(this.context.destination);
    } else if (!this.monitoring && this.monitorNode) {
      this.gain.disconnect(this.monitorNode);
      this.monitorNode.disconnect();
      this.monitorNode = undefined;
    }
  }
}
