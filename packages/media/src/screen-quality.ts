import { AudioPresets, type ScreenShareCaptureOptions, type TrackPublishOptions } from "livekit-client";
import type { ScreenExperiment } from "./screen-experiment.js";

/** ADR 0029: what the share is tuned for. "motion" keeps the frame rate, "detail" keeps text sharp. */
export type ScreenMode = "motion" | "detail";

export const DEFAULT_SCREEN_MODE: ScreenMode = "detail";

interface ScreenProfile {
  width: number;
  height: number;
  frameRate: number;
  maxBitrate: number;
  degradation: RTCDegradationPreference;
}

const PROFILES: Record<ScreenMode, ScreenProfile> = {
  motion: { width: 1920, height: 1080, frameRate: 60, maxBitrate: 6_000_000, degradation: "maintain-framerate" },
  detail: { width: 2560, height: 1440, frameRate: 30, maxBitrate: 4_000_000, degradation: "maintain-resolution" },
};

const RESOLUTION_PRESETS = {
  "1080p15": { width: 1920, height: 1080, frameRate: 15 },
  "1440p15": { width: 2560, height: 1440, frameRate: 15 },
} as const;

/** The profile with at most one F17 experiment applied; production when `experiment` is null. */
export function screenProfile(mode: ScreenMode, experiment: ScreenExperiment | null = null): ScreenProfile {
  const p = PROFILES[mode];
  if (experiment?.kind !== "resolution") return p;
  return { ...p, ...RESOLUTION_PRESETS[experiment.preset] };
}

/** The `contentHint` the share asks for. LiveKit overwrites it with "motion" when it publishes VP9 (see F17 audit). */
export function screenContentHint(mode: ScreenMode, experiment: ScreenExperiment | null = null): ScreenMode | "text" {
  return experiment?.kind === "contentHint" ? experiment.value : mode;
}

export function screenCapture(mode: ScreenMode, withAudio: boolean, experiment: ScreenExperiment | null = null): ScreenShareCaptureOptions {
  const p = screenProfile(mode, experiment);
  return {
    audio: withAudio,
    ...(withAudio ? { systemAudio: "include" as const } : {}),
    resolution: { width: p.width, height: p.height, frameRate: p.frameRate },
    contentHint: screenContentHint(mode, experiment),
  };
}

/** VP9 first with a VP8 backup for clients that cannot decode it; PC audio as stereo music, never DTX. */
export function screenPublish(mode: ScreenMode, experiment: ScreenExperiment | null = null): TrackPublishOptions {
  const p = screenProfile(mode, experiment);
  const codec = experiment?.kind === "codec" ? experiment.codec : "vp9";
  return {
    videoCodec: codec,
    // The backup only exists for SVC codecs; VP8 and H.264 are already the fallback themselves.
    backupCodec: codec === "vp9",
    ...(experiment?.kind === "simulcast" ? { simulcast: experiment.enabled } : {}),
    screenShareEncoding: { maxBitrate: p.maxBitrate, maxFramerate: p.frameRate, priority: "high" },
    degradationPreference: p.degradation,
    audioPreset: AudioPresets.musicHighQualityStereo,
    forceStereo: true,
    dtx: false,
    red: false,
  };
}

interface LatencyReceiver {
  jitterBufferTarget?: number | null;
  playoutDelayHint?: number;
}

/**
 * ADR 0029 (F15-04): a shared screen plays as soon as frames arrive. Audio keeps the browser's adaptive buffer,
 * because cutting it there gives clicks. Returns whether a hint was set.
 */
export function lowerScreenLatency(track: { kind: string; source: string; receiver?: unknown }): boolean {
  if (track.kind !== "video" || track.source !== "screen_share") return false;
  const receiver = track.receiver as LatencyReceiver | undefined;
  if (!receiver) return false;
  if ("jitterBufferTarget" in receiver) {
    receiver.jitterBufferTarget = 0;
    return true;
  }
  if ("playoutDelayHint" in receiver) {
    receiver.playoutDelayHint = 0;
    return true;
  }
  return false;
}
