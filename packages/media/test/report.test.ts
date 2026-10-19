import assert from "node:assert/strict";
import test from "node:test";
import { DisconnectReason, Room, RoomEvent } from "livekit-client";
import { emptyStats } from "../src/stats.js";
import { LiveKitPocSession } from "../src/session.js";
import { buildDiagnosticExport, dropOpenReconnect, pushReconnect, summarizeReconnect } from "../src/report.js";

test("reconnect duration closes once and ignores a second start", () => {
  const started = pushReconnect([], "start", 1_000);
  const again = pushReconnect(started, "start", 1_100);
  assert.equal(again.length, 1);
  const recovered = pushReconnect(again, "recovered", 2_400);
  const summary = summarizeReconnect(recovered);
  assert.equal(summary.attempts, 1);
  assert.equal(summary.recovered, 1);
  assert.equal(summary.fatal, 0);
  assert.equal(summary.open, false);
  assert.equal(summary.lastDurationMs, 1_400);
  assert.equal(summarizeReconnect(pushReconnect(recovered, "fatal", 3_000)).fatal, 0);
});

test("a fatal close is not a recovery and leaving drops the open attempt", () => {
  const fatal = summarizeReconnect(pushReconnect(pushReconnect([], "start", 10), "fatal", 40));
  assert.equal(fatal.recovered, 0);
  assert.equal(fatal.fatal, 1);
  assert.equal(fatal.lastDurationMs, 30);
  assert.deepEqual(dropOpenReconnect(pushReconnect([], "start", 10)), []);
});

test("export needs consent and strips tokens, mail and bearer values", () => {
  const stats = { ...emptyStats(), packetsLost: 2, jitterMs: 4, rttMs: 15, candidateType: "relay" as const, userAgent: "Agent", appVersion: "0.1.0" };
  const input = {
    exportedAt: "2026-10-18T00:00:00.000Z",
    phase: "connected",
    disconnectReason: null,
    appVersion: "0.1.0",
    userAgent: "Agent",
    stats,
    reconnect: summarizeReconnect(pushReconnect(pushReconnect([], "start", 0), "recovered", 1500)),
    secrets: ["unit-test-token"],
    events: [
      { at: "2026-10-18T00:00:00.000Z", level: "info" as const, message: "joined unit-test-token as ada@example.com Bearer abc.def" },
      { at: "2026-10-18T00:00:01.000Z", level: "error" as const, message: "eyJhbGci.eyJzdWI.sig" },
    ],
  };
  assert.equal(buildDiagnosticExport(input, false), null);
  const body = buildDiagnosticExport(input, true);
  assert.equal(body?.includes("unit-test-token"), false);
  assert.equal(body?.includes("ada@example.com"), false);
  assert.equal(body?.includes("abc.def"), false);
  assert.equal(body?.includes("eyJhbGci"), false);
  assert.match(body ?? "", /"lastDurationMs":1500/);
  assert.match(body ?? "", /"candidateType":"relay"/);
  assert.equal(body?.includes("identity"), false);
});

test("the session records one recovery and does not export the join token", async () => {
  const room = new Room();
  room.connect = (async () => undefined) as Room["connect"];
  const session = new LiveKitPocSession({ room, appVersion: "0.1.0" });
  await session.connect("ws://127.0.0.1:7880", "unit-test-token");
  room.emit(RoomEvent.Reconnecting);
  room.emit(RoomEvent.SignalReconnecting);
  assert.equal(session.snapshot().reconnect.open, true);
  assert.equal(session.snapshot().reconnect.attempts, 1);
  room.emit(RoomEvent.Reconnected);
  const summary = session.snapshot().reconnect;
  assert.equal(summary.recovered, 1);
  assert.equal(summary.open, false);
  assert.equal(typeof summary.lastDurationMs, "number");
  const body = session.exportDiagnostic(true, "2026-10-18T00:00:00.000Z");
  assert.equal(body?.includes("unit-test-token"), false);
  assert.equal(session.exportDiagnostic(false, "2026-10-18T00:00:00.000Z"), null);

  room.emit(RoomEvent.Reconnecting);
  room.disconnect = (async () => {
    room.emit(RoomEvent.Disconnected, DisconnectReason.CLIENT_INITIATED);
  }) as Room["disconnect"];
  await session.disconnect();
  assert.equal(session.snapshot().reconnect.open, false);
  assert.equal(session.snapshot().reconnect.attempts, 1);
});
