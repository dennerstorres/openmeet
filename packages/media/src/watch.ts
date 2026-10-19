export function meetingElapsedMs(startedAt: number | null, now: number, phase: string): number | null {
  if (startedAt === null || phase === "idle" || phase === "fatal") return null;
  if (!Number.isFinite(startedAt) || !Number.isFinite(now)) return null;
  return Math.max(0, now - startedAt);
}

export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  const clock = `${minutes}:${seconds < 10 ? `0${seconds}` : String(seconds)}`;
  if (hours < 1) return clock;
  return `${hours}:${minutes < 10 ? `0${minutes}` : String(minutes)}:${seconds < 10 ? `0${seconds}` : String(seconds)}`;
}
