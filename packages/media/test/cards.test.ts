import assert from "node:assert/strict";
import test from "node:test";
import { buildCards, cardInitial, featuredCard, keepPin, placeCards } from "../src/layout.js";

const ana = { identity: "ana", label: "Ana" };
const bia = { identity: "bia", label: "Bia" };
const self = { identity: "eu", label: "Você", local: true };

function tile(id: string, identity: string, source: string, media: string, local = false) {
  return { id, identity, label: identity, source, media, local };
}

test("every person has a card, with or without a camera", () => {
  const cards = buildCards([self, ana, bia], [tile("ana-mic", "ana", "microphone", "audio"), tile("bia-cam", "bia", "camera", "video")]);
  assert.deepEqual(
    cards.map((card) => [card.id, card.videoId, card.audioIds]),
    [
      ["person:eu", null, []],
      ["person:ana", null, ["ana-mic"]],
      ["person:bia", "bia-cam", []],
    ],
  );
});

test("each share is its own card and carries its screen audio", () => {
  const cards = buildCards(
    [ana, bia],
    [
      tile("ana-cam", "ana", "camera", "video"),
      tile("ana-screen", "ana", "screen", "video"),
      tile("ana-screen-audio", "ana", "screen-audio", "audio"),
      tile("bia-screen", "bia", "screen", "video"),
    ],
  );
  assert.deepEqual(
    cards.map((card) => [card.id, card.kind]),
    [
      ["share:ana-screen", "share"],
      ["share:bia-screen", "share"],
      ["person:ana", "person"],
      ["person:bia", "person"],
    ],
  );
  assert.deepEqual(cards[0]?.audioIds, ["ana-screen-audio"]);
  assert.equal(cards[2]?.videoId, "ana-cam");
});

test("a track from someone not yet listed still gets a card", () => {
  const cards = buildCards([], [tile("late-mic", "late", "microphone", "audio")]);
  assert.deepEqual(
    cards.map((card) => card.id),
    ["person:late"],
  );
});

test("the spotlight prefers another share, then another camera, then the first card", () => {
  const local = buildCards([self, ana], [tile("my-screen", "eu", "screen", "video", true), tile("my-cam", "eu", "camera", "video", true)]);
  assert.equal(featuredCard(local, null), "share:my-screen");
  const remoteShare = buildCards([self, ana], [tile("my-screen", "eu", "screen", "video", true), tile("ana-screen", "ana", "screen", "video")]);
  assert.equal(featuredCard(remoteShare, null), "share:ana-screen");
  const cameras = buildCards([self, ana], [tile("my-cam", "eu", "camera", "video", true), tile("ana-cam", "ana", "camera", "video")]);
  assert.equal(featuredCard(cameras, null), "person:ana");
  assert.equal(featuredCard(buildCards([ana, bia], []), null), "person:ana");
  assert.equal(featuredCard(buildCards([self, ana], []), null), "person:ana");
  assert.equal(featuredCard(buildCards([self], []), null), "person:eu");
  assert.equal(featuredCard([], null), null);
});

test("a pin chooses the center until it is released or its card leaves", () => {
  const cards = buildCards([ana, bia], [tile("ana-screen", "ana", "screen", "video")]);
  assert.deepEqual(placeCards(cards, "spotlight", "person:bia"), { featuredId: "person:bia", others: ["share:ana-screen", "person:ana"] });
  assert.equal(keepPin(cards, "person:bia"), "person:bia");
  const gone = buildCards([ana], [tile("ana-screen", "ana", "screen", "video")]);
  assert.equal(keepPin(gone, "person:bia"), null);
  assert.equal(placeCards(gone, "spotlight", "person:bia").featuredId, "share:ana-screen");
});

test("the grid puts shares first and ignores the pin for size", () => {
  const cards = buildCards([ana, bia], [tile("bia-screen", "bia", "screen", "video")]);
  assert.deepEqual(placeCards(cards, "grid", "person:ana"), { featuredId: null, others: ["share:bia-screen", "person:ana", "person:bia"] });
});

test("the initial is the first letter of the name", () => {
  assert.equal(cardInitial("ana"), "A");
  assert.equal(cardInitial("  élio"), "É");
  assert.equal(cardInitial(""), "?");
});
