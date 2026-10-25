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
  /** Strength restored from the user's saved choice; clamped like any later change. */
  blurRadius?: number;
}

/** Blur radius in pixels. 10 is the moderate default of ADR 0016; the range keeps the face readable and the cost bounded. */
export const BLUR_RADIUS_MIN = 2;
export const BLUR_RADIUS_MAX = 30;
export const BLUR_RADIUS_DEFAULT = 10;

export function clampBlurRadius(value: number): number {
  if (!Number.isFinite(value)) return BLUR_RADIUS_DEFAULT;
  return Math.min(BLUR_RADIUS_MAX, Math.max(BLUR_RADIUS_MIN, Math.round(value)));
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
  private radius = BLUR_RADIUS_DEFAULT;

  constructor(options: VideoBackgroundOptions = {}) {
    this.supportedCheck = options.supported ?? supportsBackgroundProcessors;
    this.createProcessor = options.create ?? BackgroundProcessor;
    this.assetBase = options.assetBase ?? defaultAssetBase;
    if (options.blurRadius !== undefined) this.radius = clampBlurRadius(options.blurRadius);
  }

  get isSupported(): boolean {
    return this.supportedCheck();
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  get blurRadius(): number {
    return this.radius;
  }

  /** Changes the strength in place: the processor stays on the published track, nothing is republished. */
  async setBlurRadius(value: number): Promise<void> {
    this.radius = clampBlurRadius(value);
    if (this.enabled && this.processor) await this.processor.switchTo({ mode: "background-blur", blurRadius: this.radius });
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
      await this.processor.switchTo({ mode: "background-blur", blurRadius: this.radius });
      return;
    }
    const base = this.assetBase();
    const processor = this.createProcessor({
      mode: "background-blur",
      blurRadius: this.radius,
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
