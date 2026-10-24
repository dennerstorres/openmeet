import assert from "node:assert/strict";
import test from "node:test";
import { headsetKey, isHandsFree, playbackOutput, type AudioDevice } from "../src/bluetooth-output.js";
import { buildDeviceList } from "../src/session.js";

const devices: AudioDevice[] = [
  { deviceId: "default", label: "Padrão - Fone de ouvido (WH-1000XM4 Hands-Free)", kind: "audiooutput", groupId: "bt" },
  { deviceId: "bt-hf-out", label: "Fone de ouvido (WH-1000XM4 Hands-Free)", kind: "audiooutput", groupId: "bt" },
  { deviceId: "bt-stereo", label: "Fones de ouvido (WH-1000XM4 Stereo)", kind: "audiooutput", groupId: "bt" },
  { deviceId: "speakers", label: "Alto-falantes (Realtek(R) Audio)", kind: "audiooutput", groupId: "realtek" },
  { deviceId: "bt-mic", label: "Headset (WH-1000XM4 Hands-Free AG Audio)", kind: "audioinput", groupId: "bt" },
  { deviceId: "p2-mic", label: "Microfone (Realtek(R) Audio)", kind: "audioinput", groupId: "realtek" },
];

test("Hands-Free endpoints of one headset share a name", () => {
  assert.equal(isHandsFree("Fone de ouvido (WH-1000XM4 Hands-Free)"), true);
  assert.equal(isHandsFree("Fones de ouvido (WH-1000XM4 Stereo)"), false);
  assert.equal(headsetKey("Headset (WH-1000XM4 Hands-Free AG Audio)"), "wh-1000xm4");
  assert.equal(headsetKey("Padrão - Fones de ouvido (WH-1000XM4 Stereo)"), "wh-1000xm4");
});

test("Hands-Free output with another microphone plays on the stereo output", () => {
  assert.equal(playbackOutput(devices, "bt-hf-out", "p2-mic"), "bt-stereo");
  assert.equal(playbackOutput(devices, "default", "p2-mic"), "bt-stereo");
  assert.equal(playbackOutput(devices, "bt-hf-out", undefined), "bt-stereo");
});

test("Hands-Free output stays when the headset microphone is in use", () => {
  assert.equal(playbackOutput(devices, "bt-hf-out", "bt-mic"), "bt-hf-out");
});

test("other outputs are never replaced", () => {
  assert.equal(playbackOutput(devices, "bt-stereo", "p2-mic"), "bt-stereo");
  assert.equal(playbackOutput(devices, "speakers", "bt-mic"), "speakers");
  assert.equal(playbackOutput(devices, "missing", "p2-mic"), "missing");
});

test("Hands-Free without a stereo sibling keeps the pick", () => {
  const only = devices.filter((device) => device.deviceId !== "bt-stereo");
  assert.equal(playbackOutput(only, "bt-hf-out", "p2-mic"), "bt-hf-out");
});

test("headsets without groupId still match by name", () => {
  const bare = devices.map((device): AudioDevice => ({ deviceId: device.deviceId, label: device.label, kind: device.kind }));
  assert.equal(playbackOutput(bare, "bt-hf-out", "p2-mic"), "bt-stereo");
  assert.equal(playbackOutput(bare, "bt-hf-out", "bt-mic"), "bt-hf-out");
});

test("the output list warns that Hands-Free needs the headset microphone", () => {
  const list = buildDeviceList(devices, { audiooutput: "bt-stereo" });
  assert.match(list.find((device) => device.deviceId === "bt-hf-out")?.label ?? "", /só com o microfone do fone$/);
  assert.equal(list.find((device) => device.deviceId === "bt-mic")?.label, "Headset (WH-1000XM4 Hands-Free AG Audio)");
  assert.equal(list.find((device) => device.deviceId === "bt-stereo")?.active, true);
});
