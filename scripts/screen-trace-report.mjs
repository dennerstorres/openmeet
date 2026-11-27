#!/usr/bin/env node
// F17-03: reads one or more consented OpenMeet diagnostic exports and prints, per file, the facts that separate the
// screen-quality hypotheses (CPU/bandwidth limit, hint override, upscaling, layer switches). Offline and read-only:
// it never contacts a server. Build @openmeet/media first (`pnpm --filter @openmeet/media build`).
//
//   node scripts/screen-trace-report.mjs diag-exe.json diag-browser.json
import { readFile } from "node:fs/promises";
import { analyzeScreenTrace } from "../packages/media/dist/index.js";

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("usage: node scripts/screen-trace-report.mjs <diagnostic.json> [...]");
  process.exit(2);
}

const rows = [];
for (const file of files) {
  const report = JSON.parse(await readFile(file, "utf8"));
  if (report?.kind !== "openmeet-diagnostic") {
    console.error(`${file}: not an OpenMeet diagnostic export`);
    process.exitCode = 1;
    continue;
  }
  const trace = Array.isArray(report.screenTrace) ? report.screenTrace : [];
  const verdict = analyzeScreenTrace(trace, null);
  const hints = [...new Set(trace.filter((sample) => sample.direction === "send").map((sample) => sample.contentHint))];
  rows.push({
    file,
    client: report.client ?? "?",
    app: report.appVersion ?? "?",
    experiment: report.screenExperiment ?? "production",
    send: verdict.sendSamples,
    recv: verdict.recvSamples,
    codecs: verdict.codecs.join("/") || "-",
    sendHint: hints.join("/") || "-",
    cpuLimited: verdict.cpuLimitedShare,
    bwLimited: verdict.bandwidthLimitedShare,
    belowRequest: verdict.sentBelowRequest,
    upscaled: verdict.upscaledSamples,
    recvSizeChanges: verdict.recvResolutionChanges,
    views: Array.isArray(report.screenViews) ? report.screenViews.length : 0,
  });
}
console.table(rows);
