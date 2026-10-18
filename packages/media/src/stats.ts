export type CandidateType = "host" | "srflx" | "relay";

export interface StatLike {
  type: string;
  id?: string;
  packetsLost?: number;
  jitter?: number;
  currentRoundTripTime?: number;
  nominated?: boolean;
  state?: string;
  localCandidateId?: string;
  candidateType?: string;
  framesPerSecond?: number;
  frameWidth?: number;
  frameHeight?: number;
  kind?: string;
}

export interface RtcContext {
  displaySurface?: string | null;
  userAgent?: string | null;
  appVersion?: string | null;
}

export interface RtcSnapshot {
  available: boolean;
  packetsLost: number | null;
  jitterMs: number | null;
  rttMs: number | null;
  candidateType: CandidateType | null;
  outboundFps: number | null;
  outboundWidth: number | null;
  outboundHeight: number | null;
  displaySurface: string | null;
  userAgent: string | null;
  appVersion: string | null;
}

interface RawStat {
  type: string;
  id?: unknown;
  packetsLost?: unknown;
  jitter?: unknown;
  currentRoundTripTime?: unknown;
  nominated?: unknown;
  state?: unknown;
  localCandidateId?: unknown;
  candidateType?: unknown;
  framesPerSecond?: unknown;
  frameWidth?: unknown;
  frameHeight?: unknown;
  kind?: unknown;
}

export interface TrackReportSource {
  getRTCStatsReport: () => Promise<{ forEach: (callback: (stat: RawStat) => void) => void } | undefined>;
}

interface OutboundVideo {
  fps: number | null;
  width: number | null;
  height: number | null;
  pixels: number;
}

interface NominatedPair {
  rttMs: number | null;
  localCandidateId?: string;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asCandidateType(value: string | undefined): CandidateType | null {
  if (value === "host" || value === "srflx" || value === "relay") {
    return value;
  }
  return null;
}

export function readUserAgent(): string | null {
  if (typeof navigator === "undefined") {
    return null;
  }
  return asString(navigator.userAgent) ?? null;
}

export function readDisplaySurface(settings: { displaySurface?: string } | null | undefined): string | null {
  return asString(settings?.displaySurface) ?? null;
}

export function toStatLike(stat: RawStat): StatLike {
  const like: StatLike = { type: stat.type };
  const id = asString(stat.id);
  const packetsLost = asNumber(stat.packetsLost);
  const jitter = asNumber(stat.jitter);
  const currentRoundTripTime = asNumber(stat.currentRoundTripTime);
  const localCandidateId = asString(stat.localCandidateId);
  const candidateType = asString(stat.candidateType);
  const framesPerSecond = asNumber(stat.framesPerSecond);
  const frameWidth = asNumber(stat.frameWidth);
  const frameHeight = asNumber(stat.frameHeight);
  const kind = asString(stat.kind);
  const state = asString(stat.state);
  if (id) {
    like.id = id;
  }
  if (packetsLost !== undefined) {
    like.packetsLost = packetsLost;
  }
  if (jitter !== undefined) {
    like.jitter = jitter;
  }
  if (currentRoundTripTime !== undefined) {
    like.currentRoundTripTime = currentRoundTripTime;
  }
  if (typeof stat.nominated === "boolean") {
    like.nominated = stat.nominated;
  }
  if (state) {
    like.state = state;
  }
  if (localCandidateId) {
    like.localCandidateId = localCandidateId;
  }
  if (candidateType) {
    like.candidateType = candidateType;
  }
  if (framesPerSecond !== undefined) {
    like.framesPerSecond = framesPerSecond;
  }
  if (frameWidth !== undefined) {
    like.frameWidth = frameWidth;
  }
  if (frameHeight !== undefined) {
    like.frameHeight = frameHeight;
  }
  if (kind) {
    like.kind = kind;
  }
  return like;
}

export function emptyStats(): RtcSnapshot {
  return {
    available: false,
    packetsLost: null,
    jitterMs: null,
    rttMs: null,
    candidateType: null,
    outboundFps: null,
    outboundWidth: null,
    outboundHeight: null,
    displaySurface: null,
    userAgent: null,
    appVersion: null,
  };
}

function withContext(snapshot: RtcSnapshot, context?: RtcContext): RtcSnapshot {
  return {
    ...snapshot,
    displaySurface: context?.displaySurface ?? null,
    userAgent: context?.userAgent ?? null,
    appVersion: context?.appVersion ?? null,
  };
}

export function summarizeRtcStats(report: Iterable<StatLike>, context?: RtcContext): RtcSnapshot {
  let packetsLost: number | null = null;
  let jitterMs: number | null = null;
  let sawInbound = false;
  let outbound: OutboundVideo | null = null;
  let nominated: NominatedPair | null = null;
  const localCandidates = new Map<string, CandidateType>();

  for (const stat of report) {
    if (stat.type === "inbound-rtp") {
      if (typeof stat.packetsLost === "number") {
        packetsLost = (packetsLost ?? 0) + stat.packetsLost;
        sawInbound = true;
      }
      if (typeof stat.jitter === "number") {
        const sample = Math.round(stat.jitter * 1000);
        jitterMs = jitterMs === null ? sample : Math.max(jitterMs, sample);
        sawInbound = true;
      }
    }
    if (stat.type === "local-candidate" && stat.id) {
      const candidateType = asCandidateType(stat.candidateType);
      if (candidateType) {
        localCandidates.set(stat.id, candidateType);
      }
    }
    if (stat.type === "candidate-pair" && stat.nominated === true) {
      const rttMs = typeof stat.currentRoundTripTime === "number" ? Math.round(stat.currentRoundTripTime * 1000) : null;
      if (!nominated || (rttMs !== null && (nominated.rttMs === null || rttMs > nominated.rttMs))) {
        const next: NominatedPair = { rttMs };
        if (stat.localCandidateId) {
          next.localCandidateId = stat.localCandidateId;
        }
        nominated = next;
      }
    }
    if (stat.type === "outbound-rtp" && stat.kind !== "audio") {
      const width = typeof stat.frameWidth === "number" ? stat.frameWidth : null;
      const height = typeof stat.frameHeight === "number" ? stat.frameHeight : null;
      const fps = typeof stat.framesPerSecond === "number" ? Math.round(stat.framesPerSecond) : null;
      if (width !== null || height !== null || fps !== null) {
        const pixels = (width ?? 0) * (height ?? 0);
        if (!outbound || pixels > outbound.pixels || (pixels === outbound.pixels && (fps ?? -1) > (outbound.fps ?? -1))) {
          outbound = { fps, width, height, pixels };
        }
      }
    }
  }

  const candidateType = nominated?.localCandidateId ? (localCandidates.get(nominated.localCandidateId) ?? null) : null;
  const rttMs = nominated?.rttMs ?? null;
  if (!sawInbound && rttMs === null && candidateType === null && outbound === null) {
    return withContext(emptyStats(), context);
  }
  return withContext(
    {
      available: true,
      packetsLost,
      jitterMs,
      rttMs,
      candidateType,
      outboundFps: outbound?.fps ?? null,
      outboundWidth: outbound?.width ?? null,
      outboundHeight: outbound?.height ?? null,
      displaySurface: null,
      userAgent: null,
      appVersion: null,
    },
    context,
  );
}

export async function collectTrackReports(tracks: TrackReportSource[]): Promise<StatLike[]> {
  const stats: StatLike[] = [];
  for (const track of tracks) {
    try {
      const report = await track.getRTCStatsReport();
      report?.forEach((item) => {
        stats.push(toStatLike(item));
      });
    } catch {
      // A closed peer connection on one track must not reject the refresh.
    }
  }
  return stats;
}
