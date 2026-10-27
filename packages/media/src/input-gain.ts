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
 * Graph: source → voice effect (ADR 0020) → gain → published track, plus an optional local monitor.
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
      this.gain.connect(this.destination);
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
    this.source?.disconnect();
    this.chain?.dispose();
    this.gain?.disconnect();
    this.destination?.disconnect();
    this.monitorNode?.disconnect();
    this.processedTrack?.stop();
    this.context = undefined;
    this.source = undefined;
    this.chain = null;
    this.gain = undefined;
    this.destination = undefined;
    this.monitorNode = undefined;
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
