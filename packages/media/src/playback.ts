export interface PlaybackLevel {
  heard: boolean;
  volume: number;
}

export const DEFAULT_PLAYBACK: PlaybackLevel = { heard: true, volume: 1 };

export function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return 1;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export function nextPlayback(current: PlaybackLevel, patch: Partial<PlaybackLevel>): PlaybackLevel {
  return {
    heard: patch.heard ?? current.heard,
    volume: patch.volume === undefined ? current.volume : clampVolume(patch.volume),
  };
}

/** ADR 0013: deafening cuts every remote sound here without touching what each card keeps. */
export function effectivePlayback(level: PlaybackLevel, deafened: boolean): PlaybackLevel {
  return deafened ? { heard: false, volume: level.volume } : level;
}

export function applyPlayback(element: { muted: boolean; volume: number }, level: PlaybackLevel): void {
  element.muted = !level.heard;
  element.volume = clampVolume(level.volume);
}

export function publicationControlsEnabled(phase: string): boolean {
  return phase === "connected" || phase === "reconnecting";
}
