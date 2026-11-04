import { AudioPresets, type ScreenShareCaptureOptions, type TrackPublishOptions } from "livekit-client";

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

export function screenCapture(mode: ScreenMode, withAudio: boolean): ScreenShareCaptureOptions {
  const p = PROFILES[mode];
  return {
    audio: withAudio,
    ...(withAudio ? { systemAudio: "include" as const } : {}),
    resolution: { width: p.width, height: p.height, frameRate: p.frameRate },
    contentHint: mode,
  };
}

/** VP9 first with a VP8 backup for clients that cannot decode it; PC audio as stereo music, never DTX. */
export function screenPublish(mode: ScreenMode): TrackPublishOptions {
  const p = PROFILES[mode];
  return {
    videoCodec: "vp9",
    backupCodec: true,
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
