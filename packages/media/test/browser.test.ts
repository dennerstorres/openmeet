import assert from "node:assert/strict";
import test from "node:test";
import { Room } from "livekit-client";
import { browserLabel, detectBrowserMedia } from "../src/browser.js";
import { buildDiagnosticExport } from "../src/report.js";
import { LiveKitPocSession } from "../src/session.js";

const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const EDGE = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.3537.57";
const FIREFOX = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0) Gecko/20100101 Firefox/144.0";
const SAFARI = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Safari/605.1.15";

test("Chrome and Edge give the output selector and screen audio", () => {
  const chrome = detectBrowserMedia({ userAgent: CHROME, setSinkId: true, getDisplayMedia: true });
  assert.deepEqual(chrome, { name: "chrome", version: "141", outputSelection: true, screenAudio: true });
  const edge = detectBrowserMedia({ userAgent: EDGE, setSinkId: true, getDisplayMedia: true });
  assert.deepEqual(edge, { name: "edge", version: "141", outputSelection: true, screenAudio: true });
  assert.equal(browserLabel(edge), "edge 141");
});

test("Firefox hides screen audio, and the output selector follows setSinkId", () => {
  const old = detectBrowserMedia({ userAgent: FIREFOX, setSinkId: false, getDisplayMedia: true });
  assert.deepEqual(old, { name: "firefox", version: "144", outputSelection: false, screenAudio: false });
  const recent = detectBrowserMedia({ userAgent: FIREFOX, setSinkId: true, getDisplayMedia: true });
  assert.equal(recent.outputSelection, true);
  assert.equal(recent.screenAudio, false);
  const safari = detectBrowserMedia({ userAgent: SAFARI, setSinkId: false, getDisplayMedia: true });
  assert.deepEqual(safari, { name: "safari", version: "18", outputSelection: false, screenAudio: false });
  assert.equal(detectBrowserMedia({ userAgent: CHROME, setSinkId: true, getDisplayMedia: false }).screenAudio, false);
  assert.equal(browserLabel(detectBrowserMedia({ userAgent: "curl/8", setSinkId: false, getDisplayMedia: false })), "other");
});

test("a browser without screen audio never asks for it, even when the mark is on", async () => {
  const room = new Room();
  const asked: unknown[] = [];
  const local = room.localParticipant as unknown as Record<string, unknown>;
  local.setScreenShareEnabled = async (_enabled: boolean, options: unknown) => {
    asked.push(options);
    return undefined;
  };
  local.getTrackPublication = () => undefined;
  const firefox = detectBrowserMedia({ userAgent: FIREFOX, setSinkId: false, getDisplayMedia: true });
  const session = new LiveKitPocSession({ room, browser: firefox, client: "web" });
  await session.setScreenShare(true, true);
  assert.deepEqual(asked, [{ audio: false }]);
  assert.equal(session.snapshot().screenAudio, "off");
  assert.equal(
    session.snapshot().diagnostics.some((event) => event.message.includes("screen audio missing")),
    false,
  );
  const report = JSON.parse(session.exportDiagnostic(true, "2026-10-19T12:00:00.000Z") ?? "{}") as { client: string; browser: string };
  assert.equal(report.client, "web");
  assert.equal(report.browser, "firefox 144");
});

test("the diagnostic keeps the browser, and an old caller without it exports null", () => {
  const body = buildDiagnosticExport(
    {
      exportedAt: "x",
      phase: "idle",
      disconnectReason: null,
      appVersion: null,
      userAgent: null,
      stats: {
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
      },
      events: [],
      reconnect: { attempts: 0, recovered: 0, fatal: 0, open: false, lastDurationMs: null },
      secrets: [],
    },
    true,
  );
  const report = JSON.parse(body ?? "{}") as { client: unknown; browser: unknown };
  assert.equal(report.client, null);
  assert.equal(report.browser, null);
});
