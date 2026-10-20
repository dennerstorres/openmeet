import { redactText, type DiagnosticEvent } from "./diagnostics.js";
import type { RtcSnapshot } from "./stats.js";

export interface ReconnectMark {
  startedAt: number;
  finishedAt: number | null;
  outcome: "open" | "recovered" | "fatal";
}

export interface ReconnectSummary {
  attempts: number;
  recovered: number;
  fatal: number;
  open: boolean;
  lastDurationMs: number | null;
}

export const EMPTY_RECONNECT: ReconnectSummary = {
  attempts: 0,
  recovered: 0,
  fatal: 0,
  open: false,
  lastDurationMs: null,
};

const MAX_MARKS = 20;

export function pushReconnect(marks: readonly ReconnectMark[], kind: "start" | "recovered" | "fatal", at: number): ReconnectMark[] {
  if (!Number.isFinite(at)) return [...marks];
  if (kind === "start") {
    if (marks.some((mark) => mark.finishedAt === null)) return [...marks];
    return trim([...marks, { startedAt: at, finishedAt: null, outcome: "open" }]);
  }
  const open = marks.findIndex((mark) => mark.finishedAt === null);
  if (open < 0) return [...marks];
  const current = marks[open];
  if (current === undefined) return [...marks];
  const finishedAt = at < current.startedAt ? current.startedAt : at;
  const next = marks.slice();
  next[open] = { startedAt: current.startedAt, finishedAt, outcome: kind };
  return next;
}

export function dropOpenReconnect(marks: readonly ReconnectMark[]): ReconnectMark[] {
  return marks.filter((mark) => mark.finishedAt !== null);
}

export function summarizeReconnect(marks: readonly ReconnectMark[]): ReconnectSummary {
  let recovered = 0;
  let fatal = 0;
  let open = false;
  let lastDurationMs: number | null = null;
  for (const mark of marks) {
    if (mark.outcome === "recovered") recovered += 1;
    if (mark.outcome === "fatal") fatal += 1;
    if (mark.finishedAt === null) open = true;
    const duration = durationMs(mark);
    if (duration !== null) lastDurationMs = duration;
  }
  return { attempts: marks.length, recovered, fatal, open, lastDurationMs };
}

export function reconnectLabel(summary: ReconnectSummary): string | null {
  if (summary.open) return "Reconectando";
  if (summary.lastDurationMs === null) return null;
  return `Última reconexão ${(summary.lastDurationMs / 1000).toFixed(1)} s`;
}

export interface DiagnosticExportInput {
  exportedAt: string;
  phase: string;
  disconnectReason: string | null;
  appVersion: string | null;
  userAgent: string | null;
  /** ADR 0014: which client and which browser, so a report says where it came from. */
  client?: "desktop" | "web" | null;
  browser?: string | null;
  stats: RtcSnapshot;
  events: readonly DiagnosticEvent[];
  reconnect: ReconnectSummary;
  secrets: readonly string[];
}

export function buildDiagnosticExport(input: DiagnosticExportInput, consent: boolean): string | null {
  if (!consent) return null;
  const secrets = input.secrets;
  const text = (value: string | null): string | null => (value === null ? null : redactText(value, secrets));
  const report = {
    kind: "openmeet-diagnostic",
    version: 1,
    exportedAt: text(input.exportedAt),
    phase: text(input.phase),
    disconnectReason: text(input.disconnectReason),
    appVersion: text(input.appVersion),
    userAgent: text(input.userAgent),
    client: input.client ?? null,
    browser: text(input.browser ?? null),
    reconnect: input.reconnect,
    stats: {
      packetsLost: input.stats.packetsLost,
      jitterMs: input.stats.jitterMs,
      rttMs: input.stats.rttMs,
      candidateType: input.stats.candidateType,
      outboundFps: input.stats.outboundFps,
      outboundWidth: input.stats.outboundWidth,
      outboundHeight: input.stats.outboundHeight,
    },
    events: input.events.map((event) => ({
      at: text(event.at),
      level: event.level,
      message: text(event.message),
    })),
  };
  return redactText(JSON.stringify(report), secrets);
}

function durationMs(mark: ReconnectMark): number | null {
  if (mark.finishedAt === null) return null;
  const duration = mark.finishedAt - mark.startedAt;
  if (!Number.isFinite(duration) || duration < 0) return null;
  return duration;
}

function trim(marks: ReconnectMark[]): ReconnectMark[] {
  return marks.length > MAX_MARKS ? marks.slice(marks.length - MAX_MARKS) : marks;
}
