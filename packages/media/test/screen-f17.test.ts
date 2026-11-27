import assert from "node:assert/strict";
import test from "node:test";
import { Room } from "livekit-client";
import { roomOptions } from "../src/room-options.js";
import { describeScreenExperiment, parseScreenExperiment, readScreenExperiment, SCREEN_EXPERIMENT_KEY } from "../src/screen-experiment.js";
import { screenCapture, screenContentHint, screenProfile, screenPublish } from "../src/screen-quality.js";
import { analyzeScreenTrace, largestElement, pushBounded, screenTraceSample, type ScreenTraceSample } from "../src/screen-trace.js";
import { buildDiagnosticExport, EMPTY_RECONNECT } from "../src/report.js";
import { emptyStats, toStatLike } from "../src/stats.js";
import { LiveKitPocSession } from "../src/session.js";

test("F17-04: an experiment changes exactly one variable and nothing else parses", () => {
  assert.deepEqual(parseScreenExperiment("codec=h264"), { kind: "codec", codec: "h264" });
  assert.deepEqual(parseScreenExperiment("dynacast=off"), { kind: "dynacast", enabled: false });
  assert.deepEqual(parseScreenExperiment(" resolution=1080P15 "), { kind: "resolution", preset: "1080p15" });
  for (const bad of [null, "", "codec=av1", "codec=h264,dynacast=off", "codec=h264;x=1", "codec", "pixelDensity=2", "<script>"]) {
    assert.equal(parseScreenExperiment(bad), null, String(bad));
  }
  assert.equal(describeScreenExperiment(null), "production");
  assert.equal(describeScreenExperiment({ kind: "adaptiveStream", enabled: false }), "adaptiveStream=off");
  assert.deepEqual(readScreenExperiment({ getItem: (key) => (key === SCREEN_EXPERIMENT_KEY ? "simulcast=on" : null) }), { kind: "simulcast", enabled: true });
  assert.equal(
    readScreenExperiment({
      getItem: () => {
        throw new Error("blocked");
      },
    }),
    null,
  );
});

test("F17-04: production publish and room options stay exactly ADR 0029 without an experiment", () => {
  assert.deepEqual(roomOptions(null), { adaptiveStream: true, dynacast: true });
  assert.deepEqual(screenPublish("detail", null), screenPublish("detail"));
  assert.equal(screenPublish("detail").videoCodec, "vp9");
  assert.equal(screenPublish("detail").backupCodec, true);
  assert.equal("simulcast" in screenPublish("detail"), false);
  assert.deepEqual(screenCapture("detail", false).resolution, { width: 2560, height: 1440, frameRate: 30 });
  assert.equal(screenContentHint("detail"), "detail");
});

test("F17-04/05: each experiment touches only its own knob", () => {
  const base = screenPublish("detail");
  const h264 = screenPublish("detail", { kind: "codec", codec: "h264" });
  assert.equal(h264.videoCodec, "h264");
  assert.equal(h264.backupCodec, false);
  assert.deepEqual(h264.screenShareEncoding, base.screenShareEncoding);
  assert.equal(screenPublish("detail", { kind: "simulcast", enabled: false }).simulcast, false);
  const low = screenProfile("detail", { kind: "resolution", preset: "1080p15" });
  assert.deepEqual([low.width, low.height, low.frameRate, low.maxBitrate], [1920, 1080, 15, 4_000_000]);
  assert.equal(screenPublish("detail", { kind: "resolution", preset: "1440p15" }).screenShareEncoding?.maxFramerate, 15);
  assert.equal(screenCapture("detail", false, { kind: "contentHint", value: "text" }).contentHint, "text");
  assert.deepEqual(roomOptions({ kind: "adaptiveStream", enabled: false }), { adaptiveStream: false, dynacast: true });
  assert.deepEqual(roomOptions({ kind: "dynacast", enabled: false }), { adaptiveStream: true, dynacast: false });
  assert.deepEqual(roomOptions({ kind: "pixelDensity", value: "screen" }), { adaptiveStream: { pixelDensity: "screen" }, dynacast: true });
  // Pinning the top layer by hand only works with adaptiveStream off, so that experiment turns it off.
  assert.deepEqual(roomOptions({ kind: "focusQuality", value: "high" }), { adaptiveStream: false, dynacast: true });
  assert.deepEqual(roomOptions({ kind: "codec", codec: "vp8" }), { adaptiveStream: true, dynacast: true });
  assert.doesNotThrow(() => new Room(roomOptions({ kind: "pixelDensity", value: "screen" })));
});

test("F17-02: send sample keeps requested vs. real size, hint, limits and deltas", () => {
  const ctx = { direction: "send" as const, track: 0, requested: { width: 2560, height: 1440 }, contentHint: "motion" };
  const report = (bytes: number, cpu: number) => [
    toStatLike({
      type: "outbound-rtp",
      kind: "video",
      bytesSent: bytes,
      frameWidth: 1920,
      frameHeight: 1080,
      framesPerSecond: 29.6,
      codecId: "c1",
      qualityLimitationReason: "cpu",
      qualityLimitationDurations: { cpu, bandwidth: 0, none: 1 },
      encoderImplementation: "libvpx",
      powerEfficientEncoder: false,
      targetBitrate: 3_000_000,
    }),
    toStatLike({ type: "codec", id: "c1", mimeType: "video/VP9" }),
    toStatLike({ type: "candidate-pair", nominated: true, state: "succeeded", availableOutgoingBitrate: 3_500_000 }),
  ];
  const first = screenTraceSample(report(1_000, 1), { ...ctx, elapsedMs: 0, now: 1_000 }, null);
  assert.equal(first.sample?.bitrateKbps, null);
  const second = screenTraceSample(report(501_000, 2.5), { ...ctx, elapsedMs: 2_000, now: 3_000 }, first.counter);
  const s = second.sample;
  assert.ok(s);
  assert.equal(s.bitrateKbps, 2_000);
  assert.deepEqual([s.width, s.height, s.requestedWidth, s.requestedHeight, s.fps], [1920, 1080, 2560, 1440, 30]);
  assert.equal(s.codec, "vp9");
  assert.equal(s.contentHint, "motion");
  assert.equal(s.cpuLimitedMsDelta, 1_500);
  assert.equal(s.implementation, "libvpx");
  assert.equal(s.powerEfficient, false);
  assert.equal(s.targetBitrateKbps, 3_000);
  assert.equal(s.availableOutgoingBitrateKbps, 3_500);
  assert.equal(s.elementWidth, null);
});

test("F17-02: receive sample keeps decoded size, losses, drops, freezes and element size with DPR", () => {
  const ctx = { direction: "recv" as const, track: 1, element: { width: 1280.4, height: 720 }, devicePixelRatio: 1.5 };
  const report = (lost: number, dropped: number) => [
    toStatLike({
      type: "inbound-rtp",
      kind: "video",
      bytesReceived: lost * 1000,
      packetsLost: lost,
      framesDropped: dropped,
      freezeCount: 0,
      pliCount: 1,
      frameWidth: 1280,
      frameHeight: 720,
      decoderImplementation: "D3D11VideoDecoder",
    }),
  ];
  const first = screenTraceSample(report(2, 3), { ...ctx, elapsedMs: 0, now: 0 }, null);
  const second = screenTraceSample(report(7, 4), { ...ctx, elapsedMs: 2_000, now: 2_000 }, first.counter);
  assert.deepEqual([second.sample?.packetsLostDelta, second.sample?.framesDroppedDelta, second.sample?.freezeCountDelta], [5, 1, 0]);
  assert.equal(second.sample?.elementWidth, 1280);
  assert.equal(second.sample?.devicePixelRatio, 1.5);
  assert.equal(second.sample?.requestedWidth, null);
  assert.equal(second.sample?.contentHint, null);
  assert.equal(screenTraceSample([toStatLike({ type: "outbound-rtp", kind: "video" })], { ...ctx, elapsedMs: 0, now: 0 }, null).sample, null);
});

test("F17-02: a counter that goes back (reconnect) never yields a negative delta", () => {
  const ctx = { direction: "recv" as const, track: 0 };
  const first = screenTraceSample(
    [toStatLike({ type: "inbound-rtp", kind: "video", packetsLost: 50, bytesReceived: 9_000 })],
    { ...ctx, elapsedMs: 0, now: 0 },
    null,
  );
  const second = screenTraceSample(
    [toStatLike({ type: "inbound-rtp", kind: "video", packetsLost: 1, bytesReceived: 10 })],
    { ...ctx, elapsedMs: 2_000, now: 2_000 },
    first.counter,
  );
  assert.equal(second.sample?.packetsLostDelta, null);
  assert.equal(second.sample?.bitrateKbps, null);
});

test("F17-02: bounded buffers and element measure", () => {
  const list: number[] = [];
  for (let index = 0; index < 10; index += 1) pushBounded(list, index, 3);
  assert.deepEqual(list, [7, 8, 9]);
  assert.deepEqual(
    largestElement([
      { clientWidth: 200, clientHeight: 120 },
      { clientWidth: 0, clientHeight: 0 },
      { clientWidth: 1600, clientHeight: 900 },
    ]),
    { width: 1600, height: 900 },
  );
  assert.equal(largestElement([]), null);
});

function sample(partial: Partial<ScreenTraceSample>): ScreenTraceSample {
  return {
    elapsedMs: 0,
    intervalMs: null,
    direction: "recv",
    track: 0,
    bitrateKbps: null,
    width: null,
    height: null,
    fps: null,
    codec: null,
    requestedWidth: null,
    requestedHeight: null,
    requestedHint: null,
    contentHint: null,
    qualityLimitationReason: null,
    cpuLimitedMsDelta: null,
    bandwidthLimitedMsDelta: null,
    targetBitrateKbps: null,
    availableOutgoingBitrateKbps: null,
    implementation: null,
    powerEfficient: null,
    packetsLostDelta: null,
    framesDroppedDelta: null,
    freezeCountDelta: null,
    pliCountDelta: null,
    elementWidth: null,
    elementHeight: null,
    devicePixelRatio: null,
    ...partial,
  };
}

test("F17-03 bench: the analyzer separates the audit hypotheses on replayed traces", () => {
  // Scenario A — sender CPU bound and LiveKit's VP9 hint override, as the audit predicts for software VP9 at 1440p.
  const cpuBound = [0, 2_000, 4_000].map((elapsedMs) =>
    sample({
      elapsedMs,
      direction: "send",
      codec: "vp9",
      contentHint: "motion",
      width: 2560,
      height: 1440,
      requestedWidth: 2560,
      requestedHeight: 1440,
      intervalMs: 2_000,
      cpuLimitedMsDelta: 1_600,
      bandwidthLimitedMsDelta: 0,
    }),
  );
  const a = analyzeScreenTrace(cpuBound, "detail");
  assert.equal(a.cpuLimitedShare, 0.8);
  assert.equal(a.bandwidthLimitedShare, 0);
  assert.equal(a.contentHintOverridden, true);
  assert.equal(a.sentBelowRequest, false);
  // Scenario B — viewer at 150 % scale receives a layer smaller than the card's device pixels, then a switch.
  const upscaled = [
    sample({ width: 1280, height: 720, elementWidth: 1280, elementHeight: 720, devicePixelRatio: 1.5, codec: "vp8" }),
    sample({ width: 1920, height: 1080, elementWidth: 1280, elementHeight: 720, devicePixelRatio: 1.5, codec: "vp8" }),
    sample({ width: 1280, height: 720, elementWidth: 1280, elementHeight: 720, devicePixelRatio: 1, codec: "vp8" }),
  ];
  const b = analyzeScreenTrace(upscaled);
  assert.equal(b.upscaledSamples, 1);
  assert.equal(b.recvResolutionChanges, 2);
  assert.deepEqual(b.codecs, ["vp8"]);
  assert.equal(b.cpuLimitedShare, null);
  // Scenario C — sent below request (resolution dropped by the encoder).
  assert.equal(
    analyzeScreenTrace([sample({ direction: "send", width: 1280, height: 720, requestedWidth: 2560, requestedHeight: 1440 })]).sentBelowRequest,
    true,
  );
});

test("F17-02: diagnostic export carries trace, views and experiment label only after consent", () => {
  const input = {
    exportedAt: "2026-11-27T00:00:00.000Z",
    phase: "connected",
    disconnectReason: null,
    appVersion: "0.2.25",
    userAgent: null,
    stats: emptyStats(),
    events: [],
    reconnect: EMPTY_RECONNECT,
    screenExperiment: "codec=h264",
    screenTrace: [sample({ width: 1920, height: 1080 })],
    screenViews: [{ elapsedMs: 10, layout: "spotlight", fullscreen: true, focusedScreen: 0, devicePixelRatio: 1.25 }],
    secrets: ["tok-secret"],
  };
  assert.equal(buildDiagnosticExport(input, false), null);
  const parsed = JSON.parse(buildDiagnosticExport(input, true) ?? "{}") as Record<string, unknown>;
  assert.equal(parsed.screenExperiment, "codec=h264");
  assert.equal((parsed.screenTrace as unknown[]).length, 1);
  assert.equal((parsed.screenViews as unknown[]).length, 1);
  const session = new LiveKitPocSession({ screenExperiment: null });
  const exported = JSON.parse(session.exportDiagnostic(true, "2026-11-27T00:00:00.000Z") ?? "{}") as Record<string, unknown>;
  assert.equal(exported.screenExperiment, "production");
  assert.deepEqual(exported.screenTrace, []);
  // No view is kept outside a call.
  session.noteScreenView({ layout: "grid", fullscreen: false, focusedScreenId: null });
  assert.deepEqual(JSON.parse(session.exportDiagnostic(true, "x") ?? "{}").screenViews, []);
});

test("F17-07: the export rebuilds trace and views from allowed fields and cleans labels", () => {
  const dirty = { ...sample({ codec: "vp9", implementation: "libvpx <img src=x> 10.0.0.1" }), sdp: "v=0", ip: "10.0.0.1" } as ScreenTraceSample;
  const json = buildDiagnosticExport(
    {
      exportedAt: "x",
      phase: "connected",
      disconnectReason: null,
      appVersion: null,
      userAgent: null,
      stats: emptyStats(),
      events: [],
      reconnect: EMPTY_RECONNECT,
      screenExperiment: "codec=h264 (overridden)",
      screenTrace: [dirty],
      screenViews: [{ elapsedMs: 1, layout: "grid<script>", fullscreen: false, focusedScreen: 1, devicePixelRatio: 1, trackSid: "TR_x" } as never],
      secrets: [],
    },
    true,
  );
  const parsed = JSON.parse(json ?? "{}");
  assert.equal("sdp" in parsed.screenTrace[0], false);
  assert.equal("ip" in parsed.screenTrace[0], false);
  assert.equal(parsed.screenTrace[0].implementation, "libvpx img src=x ");
  assert.equal("trackSid" in parsed.screenViews[0], false);
  assert.equal(parsed.screenViews[0].layout, "");
  assert.equal(parsed.screenExperiment, "codec=h264 (overridden)");
});

test("F17-07: a new RTP stream never yields a delta, and only the selected pair gives bandwidth", () => {
  const ctx = { direction: "send" as const, track: 0 };
  const first = screenTraceSample([toStatLike({ type: "outbound-rtp", id: "A", kind: "video", bytesSent: 100 })], { ...ctx, elapsedMs: 0, now: 0 }, null);
  const other = screenTraceSample(
    [toStatLike({ type: "outbound-rtp", id: "B", kind: "video", bytesSent: 900 })],
    { ...ctx, elapsedMs: 2_000, now: 2_000 },
    first.counter,
  );
  assert.equal(other.sample?.bitrateKbps, null);
  assert.equal(other.sample?.intervalMs, null);
  const same = screenTraceSample(
    [toStatLike({ type: "outbound-rtp", id: "B", kind: "video", bytesSent: 1_150 })],
    { ...ctx, elapsedMs: 4_500, now: 4_500 },
    other.counter,
  );
  assert.equal(same.sample?.intervalMs, 2_500);
  assert.equal(same.sample?.bitrateKbps, 1);
  const pairs = [
    toStatLike({ type: "outbound-rtp", id: "B", kind: "video" }),
    toStatLike({ type: "candidate-pair", nominated: false, state: "failed", availableOutgoingBitrate: 9_000_000 }),
    toStatLike({ type: "candidate-pair", nominated: true, state: "succeeded", availableOutgoingBitrate: 2_000_000 }),
  ];
  assert.equal(screenTraceSample(pairs, { ...ctx, elapsedMs: 0, now: 0 }, null).sample?.availableOutgoingBitrateKbps, 2_000);
});

test("F17-07: limited share divides by the real time covered", () => {
  const verdict = analyzeScreenTrace([
    sample({ direction: "send", intervalMs: 4_000, cpuLimitedMsDelta: 2_000 }),
    sample({ direction: "send", intervalMs: null, cpuLimitedMsDelta: 2_000 }),
  ]);
  assert.equal(verdict.cpuLimitedShare, 0.5);
});

test("F17-07 second pass: secrets are redacted before labels are cleaned, legacy traces give no NaN, selected pair wins", () => {
  const base = {
    exportedAt: "x",
    phase: "connected",
    disconnectReason: null,
    appVersion: null,
    userAgent: null,
    stats: emptyStats(),
    events: [],
    reconnect: EMPTY_RECONNECT,
  };
  const json =
    buildDiagnosticExport(
      { ...base, screenExperiment: "codec=sample/key", screenTrace: [sample({ implementation: "x sample/key" })], secrets: ["sample/key"] },
      true,
    ) ?? "";
  assert.equal(json.includes("samplekey"), false);
  assert.equal(json.includes("sample/key"), false);
  const legacy = { ...sample({ direction: "send", cpuLimitedMsDelta: 1_000 }) } as Partial<ScreenTraceSample>;
  delete legacy.intervalMs;
  assert.equal(analyzeScreenTrace([legacy as ScreenTraceSample]).cpuLimitedShare, null);
  const stats = [
    toStatLike({ type: "outbound-rtp", id: "R", kind: "video" }),
    toStatLike({ type: "transport", selectedCandidatePairId: "P2" }),
    toStatLike({ type: "candidate-pair", id: "P1", nominated: true, state: "succeeded", availableOutgoingBitrate: 9_000_000 }),
    toStatLike({ type: "candidate-pair", id: "P2", nominated: true, state: "succeeded", availableOutgoingBitrate: 1_000_000 }),
  ];
  assert.equal(screenTraceSample(stats, { direction: "send", track: 0, elapsedMs: 0, now: 0 }, null).sample?.availableOutgoingBitrateKbps, 1_000);
});
