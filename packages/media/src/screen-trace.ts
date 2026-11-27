import type { StatLike } from "./stats.js";

/**
 * F17-02: a bounded, in-memory trace of every screen-share track this client sends or receives, for the consented
 * diagnostic only. It holds numbers and short codec/implementation labels: no media, names, SDP, IPs, SSRCs or ids.
 */
export type ScreenTraceDirection = "send" | "recv";

export interface ScreenTraceSample {
  elapsedMs: number;
  /** Real time since the previous sample of the same RTP stream; null on the first one or after a stream change. */
  intervalMs: number | null;
  direction: ScreenTraceDirection;
  /** Index of the remote screen in arrival order, so two sharers stay apart without an identity. */
  track: number;
  bitrateKbps: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  codec: string | null;
  /** send only */
  requestedWidth: number | null;
  requestedHeight: number | null;
  requestedHint: string | null;
  contentHint: string | null;
  qualityLimitationReason: string | null;
  cpuLimitedMsDelta: number | null;
  bandwidthLimitedMsDelta: number | null;
  targetBitrateKbps: number | null;
  availableOutgoingBitrateKbps: number | null;
  implementation: string | null;
  powerEfficient: boolean | null;
  /** recv only */
  packetsLostDelta: number | null;
  framesDroppedDelta: number | null;
  freezeCountDelta: number | null;
  pliCountDelta: number | null;
  /** recv only: the largest element showing the track, in CSS pixels, and the screen scale. */
  elementWidth: number | null;
  elementHeight: number | null;
  devicePixelRatio: number | null;
}

export interface ScreenTraceView {
  elapsedMs: number;
  layout: string;
  fullscreen: boolean;
  /** Local number of the screen in focus (null: none), so a switch from one screen to another is visible. */
  focusedScreen: number | null;
  devicePixelRatio: number | null;
}

export interface ScreenTraceCounter {
  at: number;
  /** Stats id of the RTP stream the counters belong to; another id means another stream, so no delta. */
  rtpId: string | null;
  bytes: number | null;
  packetsLost: number | null;
  framesDropped: number | null;
  freezeCount: number | null;
  pliCount: number | null;
  cpuS: number | null;
  bandwidthS: number | null;
}

export interface ScreenTraceContext {
  elapsedMs: number;
  now: number;
  direction: ScreenTraceDirection;
  track: number;
  requested?: { width: number; height: number } | null;
  requestedHint?: string | null;
  contentHint?: string | null;
  element?: { width: number; height: number } | null;
  devicePixelRatio?: number | null;
}

export const SCREEN_TRACE_MAX_SAMPLES = 240;
export const SCREEN_TRACE_MAX_VIEWS = 60;
export const SCREEN_TRACE_INTERVAL_MS = 2_000;

function delta(next: number | null, previous: number | null | undefined): number | null {
  if (next === null || previous === null || previous === undefined || next < previous) return null;
  return next - previous;
}

function num(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function round(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null;
}

/** Reduces one track's stats report to a trace sample; `previous` gives the deltas and is replaced by the result. */
export function screenTraceSample(
  report: Iterable<StatLike>,
  context: ScreenTraceContext,
  previous: ScreenTraceCounter | null,
): { sample: ScreenTraceSample | null; counter: ScreenTraceCounter | null } {
  const stats = [...report];
  const rtpType = context.direction === "send" ? "outbound-rtp" : "inbound-rtp";
  const rtp = stats
    .filter((stat) => stat.type === rtpType && stat.kind !== "audio")
    .sort((left, right) => (right.frameWidth ?? 0) * (right.frameHeight ?? 0) - (left.frameWidth ?? 0) * (left.frameHeight ?? 0))[0];
  if (!rtp) return { sample: null, counter: previous };
  const codecs = new Map(stats.filter((stat) => stat.type === "codec" && stat.id && stat.mimeType).map((stat) => [stat.id as string, stat.mimeType as string]));
  const send = context.direction === "send";
  const counter: ScreenTraceCounter = {
    at: context.now,
    rtpId: rtp.id ?? null,
    bytes: num(send ? rtp.bytesSent : rtp.bytesReceived),
    packetsLost: num(rtp.packetsLost),
    framesDropped: num(rtp.framesDropped),
    freezeCount: num(rtp.freezeCount),
    pliCount: num(rtp.pliCount),
    cpuS: num(rtp.qualityLimitationCpuS),
    bandwidthS: num(rtp.qualityLimitationBandwidthS),
  };
  const fresh = previous !== null && counter.at > previous.at && previous.rtpId === counter.rtpId;
  const intervalMs = fresh && previous ? counter.at - previous.at : null;
  const bytes = fresh ? delta(counter.bytes, previous?.bytes) : null;
  const bitrateKbps = bytes === null || intervalMs === null ? null : Math.round((bytes * 8) / intervalMs);
  const limitedMs = (next: number | null, before: number | null | undefined): number | null => {
    const d = fresh ? delta(next, before) : null;
    return d === null ? null : Math.round(d * 1000);
  };
  // Bandwidth needs a proven link to this RTP stream: its transport's selected pair (the pointer is the proof), or, with
  // no pointer, a nominated pair of that same transport that has an estimate. No transportId on the RTP, no value.
  const transportId = rtp.transportId;
  const pairs = stats.filter((stat) => stat.type === "candidate-pair");
  const selectedId = transportId ? stats.find((stat) => stat.type === "transport" && stat.id === transportId)?.selectedCandidatePairId : undefined;
  const estimated = pairs.filter(
    (stat) => stat.transportId !== undefined && stat.transportId === transportId && typeof stat.availableOutgoingBitrate === "number",
  );
  const available = !transportId
    ? undefined
    : (selectedId
        ? pairs.find((stat) => stat.id === selectedId)
        : (estimated.find((stat) => stat.nominated === true && stat.state === "succeeded") ?? estimated.find((stat) => stat.nominated === true))
      )?.availableOutgoingBitrate;
  const codec = rtp.codecId ? codecs.get(rtp.codecId) : undefined;
  const element = context.element ?? null;
  return {
    sample: {
      elapsedMs: Math.max(0, Math.round(context.elapsedMs)),
      intervalMs,
      direction: context.direction,
      track: context.track,
      bitrateKbps,
      width: num(rtp.frameWidth),
      height: num(rtp.frameHeight),
      fps: round(rtp.framesPerSecond),
      codec: codec?.replace(/^video\//i, "").toLowerCase() ?? null,
      requestedWidth: send ? (context.requested?.width ?? null) : null,
      requestedHeight: send ? (context.requested?.height ?? null) : null,
      requestedHint: send ? (context.requestedHint ?? null) : null,
      contentHint: send ? (context.contentHint ?? null) : null,
      qualityLimitationReason: send ? (rtp.qualityLimitationReason ?? null) : null,
      cpuLimitedMsDelta: send ? limitedMs(counter.cpuS, previous?.cpuS) : null,
      bandwidthLimitedMsDelta: send ? limitedMs(counter.bandwidthS, previous?.bandwidthS) : null,
      targetBitrateKbps: send && typeof rtp.targetBitrate === "number" ? Math.round(rtp.targetBitrate / 1000) : null,
      availableOutgoingBitrateKbps: send && typeof available === "number" ? Math.round(available / 1000) : null,
      implementation: (send ? rtp.encoderImplementation : rtp.decoderImplementation) ?? null,
      powerEfficient: (send ? rtp.powerEfficientEncoder : rtp.powerEfficientDecoder) ?? null,
      packetsLostDelta: send || !fresh ? null : delta(counter.packetsLost, previous?.packetsLost),
      framesDroppedDelta: send || !fresh ? null : delta(counter.framesDropped, previous?.framesDropped),
      freezeCountDelta: send || !fresh ? null : delta(counter.freezeCount, previous?.freezeCount),
      pliCountDelta: send || !fresh ? null : delta(counter.pliCount, previous?.pliCount),
      elementWidth: send ? null : round(element?.width),
      elementHeight: send ? null : round(element?.height),
      devicePixelRatio: send ? null : (context.devicePixelRatio ?? null),
    },
    counter,
  };
}

/** Appends and keeps only the newest `max` entries, so a long share cannot grow memory without bound. */
export function pushBounded<T>(list: T[], item: T, max: number): void {
  list.push(item);
  if (list.length > max) list.splice(0, list.length - max);
}

/** Largest attached element of a track in CSS pixels; null when nothing visible is attached. */
export function largestElement(elements: readonly { clientWidth: number; clientHeight: number }[]): { width: number; height: number } | null {
  let best: { width: number; height: number } | null = null;
  for (const element of elements) {
    if (element.clientWidth <= 0 || element.clientHeight <= 0) continue;
    if (!best || element.clientWidth * element.clientHeight > best.width * best.height) {
      best = { width: element.clientWidth, height: element.clientHeight };
    }
  }
  return best;
}

export interface ScreenTraceVerdict {
  sendSamples: number;
  recvSamples: number;
  /** Share of send time the encoder reported a CPU or bandwidth limit (0–1). */
  cpuLimitedShare: number | null;
  bandwidthLimitedShare: number | null;
  /** Sent below the requested size at least once. */
  sentBelowRequest: boolean;
  /** LiveKit replaced the capture hint (VP9 forces "motion"). */
  contentHintOverridden: boolean;
  /** Received frames smaller than the element showed them, in device pixels (upscaled, so blurry). */
  upscaledSamples: number;
  /** Times the received resolution changed between consecutive samples of one track. */
  recvResolutionChanges: number;
  codecs: string[];
}

/**
 * F17-03: turns an exported trace into the few facts that separate the hypotheses in the audit. Pure, so the bench
 * replays fixtures and real exports with the same code. A verdict is evidence to read, never a pass/fail of quality.
 */
export function analyzeScreenTrace(samples: readonly ScreenTraceSample[], askedHint: string | null = null): ScreenTraceVerdict {
  const send = samples.filter((sample) => sample.direction === "send");
  const recv = samples.filter((sample) => sample.direction === "recv");
  const share = (pick: (sample: ScreenTraceSample) => number | null): number | null => {
    // Divide by the real time covered, not by a nominal tick: rounds can be skipped or late.
    let limited = 0;
    let covered = 0;
    for (const sample of send) {
      const value = pick(sample);
      if (value === null || typeof sample.intervalMs !== "number" || !Number.isFinite(sample.intervalMs) || sample.intervalMs <= 0) continue;
      limited += value;
      covered += sample.intervalMs;
    }
    if (covered === 0) return null;
    return Math.min(1, Math.round((limited / covered) * 100) / 100);
  };
  let upscaledSamples = 0;
  let recvResolutionChanges = 0;
  const lastByTrack = new Map<number, string>();
  for (const sample of recv) {
    const dpr = sample.devicePixelRatio ?? 1;
    if (sample.width !== null && sample.height !== null && sample.elementWidth !== null && sample.elementHeight !== null) {
      const fit = Math.min((sample.elementWidth * dpr) / sample.width, (sample.elementHeight * dpr) / sample.height);
      if (fit > 1.05) upscaledSamples += 1;
    }
    const size = `${sample.width ?? "?"}x${sample.height ?? "?"}`;
    const last = lastByTrack.get(sample.track);
    if (last !== undefined && last !== size) recvResolutionChanges += 1;
    lastByTrack.set(sample.track, size);
  }
  return {
    sendSamples: send.length,
    recvSamples: recv.length,
    cpuLimitedShare: share((sample) => sample.cpuLimitedMsDelta),
    bandwidthLimitedShare: share((sample) => sample.bandwidthLimitedMsDelta),
    sentBelowRequest: send.some(
      (sample) =>
        sample.width !== null &&
        sample.requestedWidth !== null &&
        sample.height !== null &&
        sample.requestedHeight !== null &&
        sample.width * sample.height < sample.requestedWidth * sample.requestedHeight * 0.95,
    ),
    contentHintOverridden: askedHint !== null && send.some((sample) => sample.contentHint !== null && sample.contentHint !== askedHint),
    upscaledSamples,
    recvResolutionChanges,
    codecs: [...new Set(samples.map((sample) => sample.codec).filter((codec): codec is string => codec !== null))].sort(),
  };
}

/** Short labels only: letters, digits, `._=()-` and spaces, capped. Anything else is dropped, not escaped. */
export function traceLabel(value: unknown, max: number, redact: (text: string) => string = (text) => text): string | null {
  if (typeof value !== "string") return null;
  // Redact known secrets first (the cleanup below would otherwise break their match), then drop IPv4-looking runs.
  const clean = redact(value)
    .replace(/\d{1,3}(?:\.\d{1,3}){3}/g, "")
    .replace(/[^A-Za-z0-9._ =()-]/g, "")
    .slice(0, max);
  return clean.length > 0 ? clean : null;
}

/**
 * F17-07 third pass: the export carries no free text. Each label field is mapped onto a closed vocabulary, so an
 * identifier can only reach the JSON if it is one of these words. Anything else becomes `other`.
 */
const CODECS = ["vp8", "vp9", "h264", "h265", "av1"] as const;
const HINTS = ["motion", "detail", "text"] as const;
const LIMITATIONS = ["none", "cpu", "bandwidth", "other"] as const;
const LAYOUTS = ["spotlight", "grid"] as const;
const IMPLEMENTATIONS = new Map(
  [
    "SimulcastEncoderAdapter",
    "ExternalEncoder",
    "ExternalDecoder",
    "MediaFoundationVideoEncodeAccelerator",
    "D3D11VideoDecoder",
    "DXVAVideoDecodeAccelerator",
    "VideoToolbox",
    "OpenH264",
    "FFmpeg",
    "libvpx",
    "libaom",
    "dav1d",
    "fallback",
    "unknown",
  ].map((name) => [name.toLowerCase(), name]),
);

export function closedLabel(value: unknown, allowed: readonly string[]): string | null {
  if (typeof value !== "string" || value === "") return null;
  const lower = value.toLowerCase();
  return allowed.includes(lower) ? lower : "other";
}

/** Keeps only known library names, in order (e.g. `SimulcastEncoderAdapter+libvpx+libvpx`); otherwise `other`. */
export function implementationLabel(value: unknown): string | null {
  if (typeof value !== "string" || value === "") return null;
  const names = (value.match(/[A-Za-z0-9]+/g) ?? []).map((word) => IMPLEMENTATIONS.get(word.toLowerCase())).filter((name) => name !== undefined);
  return names.length > 0 ? names.slice(0, 6).join("+") : "other";
}

const finite = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
const flag = (value: unknown): boolean | null => (typeof value === "boolean" ? value : null);

/** Export boundary: rebuilds each sample from the allowed fields, so an extra property can never reach the JSON. */
export function projectTraceSample(sample: ScreenTraceSample): ScreenTraceSample {
  return {
    elapsedMs: finite(sample.elapsedMs) ?? 0,
    intervalMs: finite(sample.intervalMs),
    direction: sample.direction === "send" ? "send" : "recv",
    track: finite(sample.track) ?? 0,
    bitrateKbps: finite(sample.bitrateKbps),
    width: finite(sample.width),
    height: finite(sample.height),
    fps: finite(sample.fps),
    codec: closedLabel(sample.codec, CODECS),
    requestedWidth: finite(sample.requestedWidth),
    requestedHeight: finite(sample.requestedHeight),
    requestedHint: closedLabel(sample.requestedHint, HINTS),
    contentHint: closedLabel(sample.contentHint, HINTS),
    qualityLimitationReason: closedLabel(sample.qualityLimitationReason, LIMITATIONS),
    cpuLimitedMsDelta: finite(sample.cpuLimitedMsDelta),
    bandwidthLimitedMsDelta: finite(sample.bandwidthLimitedMsDelta),
    targetBitrateKbps: finite(sample.targetBitrateKbps),
    availableOutgoingBitrateKbps: finite(sample.availableOutgoingBitrateKbps),
    implementation: implementationLabel(sample.implementation),
    powerEfficient: flag(sample.powerEfficient),
    packetsLostDelta: finite(sample.packetsLostDelta),
    framesDroppedDelta: finite(sample.framesDroppedDelta),
    freezeCountDelta: finite(sample.freezeCountDelta),
    pliCountDelta: finite(sample.pliCountDelta),
    elementWidth: finite(sample.elementWidth),
    elementHeight: finite(sample.elementHeight),
    devicePixelRatio: finite(sample.devicePixelRatio),
  };
}

export function projectTraceView(view: ScreenTraceView): ScreenTraceView {
  return {
    elapsedMs: finite(view.elapsedMs) ?? 0,
    layout: typeof view.layout === "string" && (LAYOUTS as readonly string[]).includes(view.layout) ? view.layout : "",
    fullscreen: view.fullscreen === true,
    focusedScreen: finite(view.focusedScreen),
    devicePixelRatio: finite(view.devicePixelRatio),
  };
}
