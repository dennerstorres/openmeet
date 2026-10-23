import type { AudioProcessorOptions, Track, TrackProcessor } from "livekit-client";

/** Changes outgoing microphone audio, never local playback or screen audio. */
export class InputGain implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  readonly name = "openmeet-input-gain";
  processedTrack?: MediaStreamTrack;
  private source: MediaStreamAudioSourceNode | undefined;
  private gain: GainNode | undefined;
  private destination: MediaStreamAudioDestinationNode | undefined;
  private volume = 1;

  setVolume(value: number): void {
    if (!Number.isFinite(value) || value < 0 || value > 2) throw new RangeError("Invalid microphone volume");
    this.volume = value;
    if (this.gain) this.gain.gain.value = value;
  }

  async init({ track, audioContext }: AudioProcessorOptions): Promise<void> {
    try {
      if (audioContext.state === "suspended") await audioContext.resume();
      this.source = audioContext.createMediaStreamSource(new MediaStream([track]));
      this.gain = audioContext.createGain();
      this.gain.gain.value = this.volume;
      this.destination = audioContext.createMediaStreamDestination();
      this.source.connect(this.gain);
      this.gain.connect(this.destination);
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
    this.gain?.disconnect();
    this.destination?.disconnect();
    this.processedTrack?.stop();
    this.source = undefined;
    this.gain = undefined;
    this.destination = undefined;
    delete this.processedTrack;
  }
}
