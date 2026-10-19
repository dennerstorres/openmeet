import assert from "node:assert/strict";
import test from "node:test";
import { arrangeTiles, localScreenSurface, screenCaption, screenShareAction, screenSourceLabel } from "../src/layout.js";

const camera = { id: "cam", source: "camera", media: "video", local: false };
const localCamera = { id: "self", source: "camera", media: "video", local: true };
const remoteScreen = { id: "remote-screen", source: "screen", media: "video", local: false, surface: "monitor" };
const localScreen = { id: "local-screen", source: "screen", media: "video", local: true, surface: "window" };
const voice = { id: "mic", source: "microphone", media: "audio", local: false };

test("five cameras stay visible together", () => {
  const cameras = ["a", "b", "c", "d", "e"].map((id) => ({ id, source: "camera", media: "video", local: id === "a" }));
  assert.deepEqual(arrangeTiles(cameras), { stageId: null, gridIds: ["a", "b", "c", "d", "e"] });
});

test("cameras stay in the grid until someone shares a screen", () => {
  assert.deepEqual(arrangeTiles([camera, localCamera, voice]), { stageId: null, gridIds: ["cam", "self"] });
});

test("a remote screen takes the stage and the local screen stays in the grid", () => {
  assert.deepEqual(arrangeTiles([localCamera, localScreen, remoteScreen, voice]), {
    stageId: "remote-screen",
    gridIds: ["self", "local-screen"],
  });
});

test("the local screen is featured when nobody else is sharing", () => {
  assert.deepEqual(arrangeTiles([localScreen, camera]), { stageId: "local-screen", gridIds: ["cam"] });
});

test("sharing starts from the picker and stops instead of replacing the source", () => {
  assert.equal(screenShareAction(false), "start");
  assert.equal(screenShareAction(true), "stop");
});

test("the caption names the chosen monitor or window and disappears when sharing stops", () => {
  assert.equal(screenSourceLabel("monitor"), "monitor");
  assert.equal(screenSourceLabel("window"), "janela");
  assert.equal(screenSourceLabel("browser"), "guia");
  assert.equal(screenSourceLabel(null), "tela");
  assert.equal(localScreenSurface([camera, localScreen]), "window");
  assert.equal(screenCaption("monitor", true), "Compartilhando monitor");
  assert.equal(screenCaption("window", false), null);
});
