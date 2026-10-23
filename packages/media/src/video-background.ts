import {
  BackgroundProcessor,
  supportsBackgroundProcessors,
  type BackgroundProcessorWrapper,
  type SwitchBackgroundProcessorOptions,
} from "@livekit/track-processors";
import type { LocalVideoTrack } from "livekit-client";

type Processor = Pick<BackgroundProcessorWrapper, "switchTo">;
type ProcessorFactory = (options: SwitchBackgroundProcessorOptions & { assetPaths: { tasksVisionFileSet: string; modelAssetPath: string } }) => Processor;

export interface VideoBackgroundOptions {
  supported?: () => boolean;
  create?: ProcessorFactory;
  assetBase?: () => string;
}

function defaultAssetBase(): string {
  return new URL("media/", document.baseURI).href;
}

export class VideoBackground {
  private readonly supportedCheck: () => boolean;
  private readonly createProcessor: ProcessorFactory;
  private readonly assetBase: () => string;
  private processor: Processor | null = null;
  private track: LocalVideoTrack | null = null;
  private enabled = false;

  constructor(options: VideoBackgroundOptions = {}) {
    this.supportedCheck = options.supported ?? supportsBackgroundProcessors;
    this.createProcessor = options.create ?? BackgroundProcessor;
    this.assetBase = options.assetBase ?? defaultAssetBase;
  }

  get isSupported(): boolean {
    return this.supportedCheck();
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  async setEnabled(track: LocalVideoTrack | undefined, enabled: boolean): Promise<void> {
    if (enabled && !this.isSupported) throw new Error("Background blur is not supported");
    if (!enabled) {
      if (this.processor) await this.processor.switchTo({ mode: "disabled" });
      this.enabled = false;
      return;
    }
    this.enabled = true;
    try {
      if (track) await this.apply(track);
    } catch (error) {
      this.enabled = false;
      throw error;
    }
  }

  async apply(track: LocalVideoTrack): Promise<void> {
    if (!this.enabled) return;
    if (this.track === track && this.processor) {
      await this.processor.switchTo({ mode: "background-blur", blurRadius: 10 });
      return;
    }
    const base = this.assetBase();
    const processor = this.createProcessor({
      mode: "background-blur",
      blurRadius: 10,
      assetPaths: {
        tasksVisionFileSet: new URL("vision/", base).href.replace(/\/$/, ""),
        modelAssetPath: new URL("selfie_segmenter.tflite", base).href,
      },
    });
    await track.setProcessor(processor as BackgroundProcessorWrapper);
    this.track = track;
    this.processor = processor;
  }
}
