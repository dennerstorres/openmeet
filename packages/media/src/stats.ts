export interface StatLike {
  type: string;
  packetsLost?: number;
  jitter?: number;
  currentRoundTripTime?: number;
  nominated?: boolean;
  state?: string;
}

export interface RtcSnapshot {
  available: boolean;
  packetsLost: number | null;
  jitterMs: number | null;
  rttMs: number | null;
}

export function emptyStats(): RtcSnapshot {
  return { available: false, packetsLost: null, jitterMs: null, rttMs: null };
}

export function summarizeRtcStats(report: Iterable<StatLike>): RtcSnapshot {
  let packetsLost: number | null = null;
  let jitterMs: number | null = null;
  let rttMs: number | null = null;
  let sawInbound = false;

  for (const stat of report) {
    if (stat.type === "inbound-rtp" && typeof stat.packetsLost === "number") {
      packetsLost = (packetsLost ?? 0) + stat.packetsLost;
      if (typeof stat.jitter === "number") {
        jitterMs = Math.round(stat.jitter * 1000);
      }
      sawInbound = true;
    }
    if (stat.type === "candidate-pair" && stat.nominated === true && typeof stat.currentRoundTripTime === "number") {
      rttMs = Math.round(stat.currentRoundTripTime * 1000);
    }
  }

  if (!sawInbound && rttMs === null) {
    return emptyStats();
  }
  return { available: true, packetsLost, jitterMs, rttMs };
}
