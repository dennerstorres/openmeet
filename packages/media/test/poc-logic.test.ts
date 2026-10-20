import assert from "node:assert/strict";
import test from "node:test";
import { DisconnectReason, Room, RoomEvent, Track } from "livekit-client";
import { screenAudioState } from "../src/layout.js";
import { describeMediaError, mediaActionError, sanitizeDiagnostic } from "../src/diagnostics.js";
import { LiveKitPocSession, participantLabel, shouldAttachPlayback, shouldShowLiveVideo } from "../src/session.js";
import { classifyDisconnect, nextPhase, type ConnectionPhase } from "../src/phase.js";
import { collectTrackReports, readDisplaySurface, summarizeRtcStats, toStatLike } from "../src/stats.js";

test("device list shows labels after permission, refreshes, and marks the active device", () => {
  const session = new LiveKitPocSession();
  assert.deepEqual(session.snapshot().devices, []);
  const hidden = session.applyDeviceList([{ deviceId: "mic-1", label: "", kind: "audioinput" }], { audioinput: "mic-1" });
  assert.equal(hidden[0]?.label, "permissão pendente");
  assert.equal(hidden[0]?.active, true);

  const refreshed = session.applyDeviceList(
    [
      { deviceId: "mic-1", label: "Microfone interno", kind: "audioinput" },
      { deviceId: "mic-2", label: "Headset", kind: "audioinput" },
    ],
    { audioinput: "mic-2" },
  );
  assert.equal(refreshed[0]?.label, "Microfone interno");
  assert.equal(refreshed[0]?.active, false);
  assert.equal(refreshed[1]?.label, "Headset");
  assert.equal(refreshed[1]?.active, true);
  assert.equal(session.snapshot().devices[1]?.active, true);
});

test("a muted remote camera is not left as a live frame", () => {
  const session = new LiveKitPocSession();
  assert.equal(session.snapshot().tiles.length, 0);
  const noop = () => undefined;
  session.upsertTile({
    id: "cam",
    identity: "win-b",
    label: "B",
    source: "camera",
    media: "video",
    local: false,
    muted: false,
    attach: noop,
    detach: noop,
  });
  assert.equal(shouldShowLiveVideo(session.snapshot().tiles[0]!), true);
  session.setTrackMuted("cam", true);
  assert.equal(session.snapshot().tiles[0]?.muted, true);
  assert.equal(shouldShowLiveVideo(session.snapshot().tiles[0]!), false);
  session.setTrackMuted("cam", false);
  assert.equal(session.snapshot().tiles[0]?.muted, false);
  assert.equal(shouldShowLiveVideo(session.snapshot().tiles[0]!), true);
});

test("a screen keeps its source until a different one is published", () => {
  const session = new LiveKitPocSession();
  const noop = () => undefined;
  const tile = {
    id: "screen",
    identity: "win-a",
    label: "A",
    source: "screen" as const,
    media: "video" as const,
    local: true,
    muted: false,
    surface: "monitor",
    attach: noop,
    detach: noop,
  };
  session.upsertTile(tile);
  session.upsertTile({ ...tile, surface: "monitor" });
  assert.equal(
    session.snapshot().diagnostics.some((event) => event.message.includes("screen source changed")),
    false,
  );
  session.upsertTile({ ...tile, surface: "window" });
  const note = session.snapshot().diagnostics.at(-1);
  assert.equal(note?.message, "screen source changed: monitor -> window");
});

test("local microphone is not played back on this PC", () => {
  assert.equal(shouldAttachPlayback({ media: "audio", local: true }), false);
  assert.equal(shouldAttachPlayback({ media: "audio", local: false }), true);
  assert.equal(shouldAttachPlayback({ media: "video", local: true }), true);
});

test("connection phase shows reconnect and latches fatal until a new attempt", () => {
  assert.equal(nextPhase("connected", "reconnecting"), "reconnecting");
  assert.equal(nextPhase("reconnecting", "reconnected"), "connected");
  assert.equal(nextPhase("connecting", "disconnected"), "fatal");
  assert.equal(nextPhase("fatal", "disconnected"), "fatal");
  assert.equal(nextPhase("fatal", "connect_started"), "connecting");
});

test("recoverable, fatal and leave stay distinct from the idle phase", async () => {
  let phase: ConnectionPhase = "idle";
  phase = nextPhase(phase, "connect_started");
  phase = nextPhase(phase, "connected");
  assert.equal(phase, "connected");
  assert.equal(nextPhase(phase, "reconnecting"), "reconnecting");

  const timedOut = classifyDisconnect(DisconnectReason.CONNECTION_TIMEOUT, false);
  const duplicate = classifyDisconnect(DisconnectReason.DUPLICATE_IDENTITY, false);
  const leave = classifyDisconnect(DisconnectReason.CLIENT_INITIATED, true);
  assert.equal(timedOut.reason, "CONNECTION_TIMEOUT");
  assert.equal(duplicate.reason, "DUPLICATE_IDENTITY");
  assert.equal(leave.reason, "CLIENT_INITIATED");
  assert.equal(nextPhase(phase, timedOut.event), "fatal");
  assert.equal(nextPhase(phase, duplicate.event), "fatal");
  assert.equal(nextPhase(phase, leave.event), "disconnected");

  async function connectedSession(): Promise<{ room: Room; session: LiveKitPocSession }> {
    const room = new Room();
    room.connect = (async () => undefined) as Room["connect"];
    const session = new LiveKitPocSession({ room });
    assert.equal(session.snapshot().phase, "idle");
    assert.equal(session.snapshot().disconnectReason, null);
    await session.connect("ws://127.0.0.1:7880", "unit-test-token");
    assert.equal(session.snapshot().phase, "connected");
    return { room, session };
  }

  const recoverable = await connectedSession();
  recoverable.room.emit(RoomEvent.Reconnecting);
  assert.equal(recoverable.session.snapshot().phase, "reconnecting");
  assert.equal(recoverable.session.snapshot().disconnectReason, null);

  const fatal = await connectedSession();
  fatal.room.emit(RoomEvent.Disconnected, DisconnectReason.CONNECTION_TIMEOUT);
  assert.equal(fatal.session.snapshot().phase, "fatal");
  assert.equal(fatal.session.snapshot().disconnectReason, "CONNECTION_TIMEOUT");

  const exited = await connectedSession();
  exited.room.disconnect = (async () => {
    exited.room.emit(RoomEvent.Disconnected, DisconnectReason.CLIENT_INITIATED);
  }) as Room["disconnect"];
  await exited.session.disconnect();
  assert.equal(exited.session.snapshot().phase, "disconnected");
  assert.equal(exited.session.snapshot().disconnectReason, "CLIENT_INITIATED");
});

test("participant labels hide raw ids", () => {
  assert.equal(participantLabel("Admin", true), "Admin");
  assert.equal(participantLabel("2ba4e473-a05c-4404-b393-4887ec60fe85", true), "Você");
  assert.equal(participantLabel("2ba4e473-a05c-4404-b393-4887ec60fe85", false), "Participante");
});

test("remote audio stays blocked until the listener unlocks it", async () => {
  const room = new Room();
  const session = new LiveKitPocSession({ room });
  assert.equal(session.snapshot().audioPlayback, true);
  room.emit(RoomEvent.AudioPlaybackStatusChanged, false);
  assert.equal(session.snapshot().audioPlayback, false);
  room.startAudio = (async () => {
    room.emit(RoomEvent.AudioPlaybackStatusChanged, true);
  }) as Room["startAudio"];
  await session.startRemoteAudio();
  assert.equal(session.snapshot().audioPlayback, true);
});

test("stats summary reads loss, jitter and nominated RTT", () => {
  const summary = summarizeRtcStats([
    { type: "inbound-rtp", packetsLost: 2, jitter: 0.02 },
    { type: "inbound-rtp", packetsLost: 3, jitter: 0.01 },
    { type: "candidate-pair", nominated: false, currentRoundTripTime: 0.9 },
    { type: "candidate-pair", nominated: true, currentRoundTripTime: 0.04 },
  ]);
  assert.equal(summary.available, true);
  assert.equal(summary.packetsLost, 5);
  assert.equal(summary.jitterMs, 20);
  assert.equal(summary.rttMs, 40);
  assert.equal(summary.candidateType, null);
});

test("stats summary reports the selected candidate, outbound video and client context", () => {
  const summary = summarizeRtcStats(
    [
      { type: "inbound-rtp", packetsLost: 1, jitter: 0.004 },
      { type: "inbound-rtp", packetsLost: 1, jitter: 0.051 },
      { type: "candidate-pair", nominated: true, currentRoundTripTime: 0.03, localCandidateId: "host-1" },
      { type: "local-candidate", id: "host-1", candidateType: "host" },
      { type: "candidate-pair", nominated: true, currentRoundTripTime: 0.18, localCandidateId: "relay-1" },
      { type: "local-candidate", id: "relay-1", candidateType: "relay" },
      { type: "candidate-pair", nominated: false, currentRoundTripTime: 0.9, localCandidateId: "srflx-ignored" },
      { type: "local-candidate", id: "srflx-ignored", candidateType: "srflx" },
      { type: "outbound-rtp", kind: "video", framesPerSecond: 15, frameWidth: 640, frameHeight: 360 },
      { type: "outbound-rtp", kind: "video", framesPerSecond: 24.2, frameWidth: 1280, frameHeight: 720 },
      { type: "outbound-rtp", kind: "audio", framesPerSecond: 50, frameWidth: 1, frameHeight: 1 },
    ],
    { displaySurface: "monitor", userAgent: "TestAgent/1", appVersion: "0.1.0" },
  );
  assert.equal(summary.jitterMs, 51);
  assert.equal(summary.rttMs, 180);
  assert.equal(summary.candidateType, "relay");
  assert.equal(summary.outboundFps, 24);
  assert.equal(summary.outboundWidth, 1280);
  assert.equal(summary.outboundHeight, 720);
  assert.equal(summary.displaySurface, "monitor");
  assert.equal(summary.userAgent, "TestAgent/1");
  assert.equal(summary.appVersion, "0.1.0");
});

test("stats summary reports host and srflx on the nominated pair", () => {
  for (const candidateType of ["host", "srflx"] as const) {
    const summary = summarizeRtcStats([
      { type: "candidate-pair", nominated: true, currentRoundTripTime: 0.02, localCandidateId: "local" },
      { type: "local-candidate", id: "local", candidateType },
    ]);
    assert.equal(summary.candidateType, candidateType);
    assert.equal(summary.rttMs, 20);
  }
});

test("display surface comes from the screen track settings", () => {
  assert.equal(readDisplaySurface({ displaySurface: "window" }), "window");
  assert.equal(readDisplaySurface({ displaySurface: "monitor" }), "monitor");
  assert.equal(readDisplaySurface({}), null);
});

test("track stats keep candidate and outbound fields", () => {
  const outbound = toStatLike({ type: "outbound-rtp", kind: "video", framesPerSecond: 30, frameWidth: 1920, frameHeight: 1080, id: "out" });
  assert.equal(outbound.framesPerSecond, 30);
  assert.equal(outbound.frameWidth, 1920);
  assert.equal(outbound.frameHeight, 1080);
  const pair = toStatLike({ type: "candidate-pair", nominated: true, currentRoundTripTime: 0.05, localCandidateId: "c1" });
  assert.equal(pair.nominated, true);
  assert.equal(pair.localCandidateId, "c1");
  assert.equal(toStatLike({ type: "local-candidate", id: "c1", candidateType: "srflx" }).candidateType, "srflx");
});

test("a closed track report does not reject the stats refresh", async () => {
  const report = new Map<string, { type: string; packetsLost: number; jitter: number }>([["in", { type: "inbound-rtp", packetsLost: 4, jitter: 0.03 }]]);
  const stats = await collectTrackReports([
    {
      getRTCStatsReport: async () => {
        throw new Error("pc closed");
      },
    },
    { getRTCStatsReport: async () => report },
  ]);
  const summary = summarizeRtcStats(stats, { displaySurface: "window", userAgent: "TestAgent/1", appVersion: "0.1.0" });
  assert.equal(summary.available, true);
  assert.equal(summary.packetsLost, 4);
  assert.equal(summary.jitterMs, 30);
  assert.equal(summary.displaySurface, "window");
  assert.equal(summary.appVersion, "0.1.0");
});

test("a new session refreshes stats from track reports", async () => {
  const session = new LiveKitPocSession({ appVersion: "0.1.0" });
  const stats = await session.refreshStats();
  assert.equal(stats.available, false);
  assert.equal(stats.appVersion, "0.1.0");
  assert.equal(stats.candidateType, null);
  assert.equal(stats.jitterMs, null);
});

test("stats stay unavailable when the report has no media fields", () => {
  assert.equal(summarizeRtcStats([{ type: "certificate" }]).available, false);
});

test("diagnostics drop JWTs and configured secrets", () => {
  const message = sanitizeDiagnostic("failed eyJhbGci.eyJzdWI.sig for unit-test-secret", ["unit-test-secret"]);
  assert.equal(message.includes("eyJ"), false);
  assert.equal(message.includes("unit-test-secret"), false);
  assert.match(message, /\[redacted-jwt\]/);
});

test("screen denial says the picker may have been cancelled", () => {
  const error = { name: "NotAllowedError", message: "Permission denied" };
  assert.equal(mediaActionError("screen", error), "NotAllowedError: permissão negada ou seleção cancelada");
  assert.equal(mediaActionError("microphone", error), "NotAllowedError: Permission denied");
});

test("media errors keep name and message only", () => {
  assert.equal(describeMediaError({ name: "NotAllowedError", message: "Permission denied" }), "NotAllowedError: Permission denied");
  assert.equal(describeMediaError("nope"), "unknown media error");
});

test("the active speakers come from the SFU and clear when the call drops", () => {
  const room = new Room();
  const session = new LiveKitPocSession({ room });
  assert.deepEqual(session.snapshot().speakers, []);
  room.emit(RoomEvent.ActiveSpeakersChanged, [{ identity: "ana" }, { identity: "" }, { identity: "bia" }] as never);
  assert.deepEqual(session.snapshot().speakers, ["ana", "bia"]);
  room.emit(RoomEvent.Disconnected, DisconnectReason.SERVER_SHUTDOWN);
  assert.deepEqual(session.snapshot().speakers, []);
});

test("PC audio is asked only when marked, and a share without it is reported as missing", async () => {
  assert.equal(screenAudioState(false, true, false), "off");
  assert.equal(screenAudioState(true, false, true), "off");
  assert.equal(screenAudioState(true, true, true), "on");
  assert.equal(screenAudioState(true, true, false), "missing");

  const room = new Room();
  const asked: unknown[] = [];
  let sharing = false;
  let audioPublished = false;
  const local = room.localParticipant as unknown as Record<string, unknown>;
  local.setScreenShareEnabled = async (enabled: boolean, options: unknown) => {
    asked.push(options);
    sharing = enabled;
    return undefined;
  };
  local.getTrackPublication = (source: Track.Source) => (source === Track.Source.ScreenShareAudio && audioPublished && sharing ? {} : undefined);
  Object.defineProperty(room.localParticipant, "isScreenShareEnabled", { get: () => sharing });
  const session = new LiveKitPocSession({ room, browser: { name: "edge", version: "141", outputSelection: true, screenAudio: true } });

  await session.setScreenShare(true);
  assert.deepEqual(asked.at(-1), { audio: false });
  assert.equal(session.snapshot().screenAudio, "off");

  await session.setScreenShare(true, true);
  assert.deepEqual(asked.at(-1), { audio: true, systemAudio: "include" });
  assert.equal(session.snapshot().screenAudio, "missing");
  assert.equal(
    session.snapshot().diagnostics.some((event) => event.message.includes("screen audio missing")),
    true,
  );

  audioPublished = true;
  await session.setScreenShare(true, true);
  assert.equal(session.snapshot().screenAudio, "on");

  await session.setScreenShare(false, true);
  assert.deepEqual(asked.at(-1), { audio: false });
  assert.equal(session.snapshot().screenAudio, "off");
});
