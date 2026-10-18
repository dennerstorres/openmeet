import assert from "node:assert/strict";
import test from "node:test";
import { describeMediaError, sanitizeDiagnostic } from "../src/diagnostics.js";
import { shouldAttachPlayback } from "../src/session.js";
import { nextPhase } from "../src/phase.js";
import { summarizeRtcStats } from "../src/stats.js";

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

test("stats summary reads loss, jitter and nominated RTT", () => {
  const summary = summarizeRtcStats([
    { type: "inbound-rtp", packetsLost: 2, jitter: 0.02 },
    { type: "inbound-rtp", packetsLost: 3, jitter: 0.01 },
    { type: "candidate-pair", nominated: false, currentRoundTripTime: 0.9 },
    { type: "candidate-pair", nominated: true, currentRoundTripTime: 0.04 },
  ]);
  assert.deepEqual(summary, { available: true, packetsLost: 5, jitterMs: 10, rttMs: 40 });
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

test("media errors keep name and message only", () => {
  assert.equal(describeMediaError({ name: "NotAllowedError", message: "Permission denied" }), "NotAllowedError: Permission denied");
  assert.equal(describeMediaError("nope"), "unknown media error");
});
