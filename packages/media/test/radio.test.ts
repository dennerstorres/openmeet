import assert from "node:assert/strict";
import test from "node:test";
import { AudioPresets, Room, Track, type LocalTrack } from "livekit-client";
import { buildCards, featuredCard, placeCards, type CardTile } from "../src/layout.js";
import { RADIO_TRACK_NAME, isRadio, radioCapture, radioPublish } from "../src/radio.js";
import { LiveKitPocSession } from "../src/session.js";

// ADR 0022. Publication bookkeeping with a fake participant; the real SFU and a real cable still need a call.

interface FakePublication {
  source: Track.Source;
  trackName: string;
  trackSid: string;
  track: LocalTrack;
}

function fakeTrack(label: string, log: string[]): LocalTrack {
  return {
    kind: Track.Kind.Audio,
    stop: () => log.push(`stop ${label}`),
  } as unknown as LocalTrack;
}

function radioRoom(options?: { failPublish?: boolean }) {
  const room = new Room();
  const log: string[] = [];
  const publications = new Map<string, FakePublication>();
  let sid = 0;
  const local = room.localParticipant as unknown as Record<string, unknown>;
  Object.defineProperty(local, "audioTrackPublications", { configurable: true, get: () => publications });
  local.getTrackPublication = (source: Track.Source) => [...publications.values()].find((item) => item.source === source);
  local.publishTrack = async (track: LocalTrack, publish: { name?: string; source?: Track.Source }) => {
    if (options?.failPublish) throw new Error("publish refused");
    const id = `TR_${++sid}`;
    publications.set(id, { source: publish.source ?? Track.Source.Unknown, trackName: publish.name ?? "", trackSid: id, track });
    log.push(`publish ${publish.name ?? ""}`);
  };
  local.unpublishTrack = async (track: LocalTrack, stop: boolean) => {
    for (const [id, item] of publications) if (item.track === track) publications.delete(id);
    if (stop) track.stop();
    log.push("unpublish");
  };
  // Like the SDK: stopping a share unpublishes the screen and the first screen-audio track it finds.
  local.setScreenShareEnabled = async (enabled: boolean, capture: { audio: boolean }) => {
    if (enabled) {
      publications.set("SCREEN", { source: Track.Source.ScreenShare, trackName: "screen", trackSid: "SCREEN", track: fakeTrack("screen", log) });
      if (capture.audio) {
        publications.set("PCAUDIO", { source: Track.Source.ScreenShareAudio, trackName: "pc", trackSid: "PCAUDIO", track: fakeTrack("pc", log) });
      }
      return;
    }
    publications.delete("SCREEN");
    const first = [...publications.entries()].find(([, item]) => item.source === Track.Source.ScreenShareAudio);
    if (first) publications.delete(first[0]);
  };
  const captured: unknown[] = [];
  const session = new LiveKitPocSession({
    room,
    audioWorklet: false,
    browser: { name: "edge", version: "141", outputSelection: true, screenAudio: true },
    createRadioTrack: async (capture) => {
      captured.push(capture);
      return fakeTrack(`radio${captured.length}`, log);
    },
  });
  return { room, session, log, publications, captured };
}

test("radio capture drops the voice filters and publishes as named screen audio with a music preset", () => {
  assert.deepEqual(radioCapture("cable"), {
    deviceId: { exact: "cable" },
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    channelCount: 2,
  });
  const publish = radioPublish();
  assert.equal(publish.name, RADIO_TRACK_NAME);
  assert.equal(publish.source, Track.Source.ScreenShareAudio);
  assert.equal(publish.audioPreset, AudioPresets.musicHighQualityStereo);
  assert.equal(publish.dtx, false);
  assert.equal(isRadio({ source: Track.Source.ScreenShareAudio, trackName: RADIO_TRACK_NAME }), true);
  assert.equal(isRadio({ source: Track.Source.ScreenShareAudio, trackName: "" }), false);
  assert.equal(isRadio({ source: Track.Source.Microphone, trackName: RADIO_TRACK_NAME }), false);
});

test("turning the radio on, switching its input and off publishes one track at a time", async () => {
  const { session, log, publications, captured } = radioRoom();
  await session.setRadio("cable-a");
  assert.deepEqual(captured, [radioCapture("cable-a")]);
  assert.equal(session.snapshot().radio, true);
  assert.equal(session.snapshot().radioDevice, "cable-a");
  await session.setRadio("cable-b");
  assert.equal(publications.size, 1, "switching replaces the track");
  assert.ok(log.includes("stop radio1"));
  await session.setRadio(null);
  assert.equal(publications.size, 0);
  assert.ok(log.includes("stop radio2"));
  assert.equal(session.snapshot().radio, false);
  assert.equal(session.snapshot().radioDevice, null);
  const events = session.snapshot().diagnostics.map((event) => event.message);
  assert.ok(events.includes("radio on") && events.includes("radio off"));
  assert.equal(
    events.some((message) => message.includes("cable")),
    false,
    "the input name never reaches the diagnostic",
  );
});

test("a refused publication stops the capture and leaves the radio off", async () => {
  const { session, log } = radioRoom({ failPublish: true });
  await assert.rejects(session.setRadio("cable"), /publish refused/);
  assert.ok(log.includes("stop radio1"));
  assert.equal(session.snapshot().radio, false);
  assert.equal(session.snapshot().radioDevice, null);
});

test("the radio and the PC audio of a share are never on together", async () => {
  const sharing = radioRoom();
  await sharing.session.setScreenShare(true, true);
  assert.equal(sharing.session.snapshot().screenAudio, "on");
  await sharing.session.setRadio("cable");
  assert.equal(sharing.publications.has("PCAUDIO"), false, "turning the radio on drops the PC audio");
  assert.equal(sharing.session.snapshot().radio, true);

  const playing = radioRoom();
  await playing.session.setRadio("cable");
  await playing.session.setScreenShare(true, true);
  assert.equal(playing.session.snapshot().radio, false, "asking for PC audio turns the radio off");
  assert.equal(playing.session.snapshot().screenAudio, "on");
});

test("stopping a share that took the radio away publishes it again", async () => {
  const { session, publications, captured } = radioRoom();
  await session.setRadio("cable");
  await session.setScreenShare(true, false);
  assert.equal(session.snapshot().screenAudio, "off", "the radio is not the PC audio of the share");
  await session.setScreenShare(false);
  assert.equal(session.snapshot().radio, true);
  assert.equal(captured.length, 2);
  assert.equal([...publications.values()].filter((item) => item.trackName === RADIO_TRACK_NAME).length, 1);
});

test("leaving the room forgets the radio", async () => {
  const { room, session } = radioRoom();
  await session.setRadio("cable");
  (room as unknown as { emit(event: string): boolean }).emit("disconnected");
  assert.equal(session.snapshot().radioDevice, null);
});

test("a radio track becomes its own card, after people, and is featured only when pinned", () => {
  const tiles: CardTile[] = [
    { id: "mic", identity: "ana", label: "Ana", source: "microphone", media: "audio", local: false },
    { id: "radio", identity: "ana", label: "Ana", source: "radio", media: "audio", local: false },
    { id: "pc", identity: "bia", label: "Bia", source: "screen-audio", media: "audio", local: false },
  ];
  const cards = buildCards(
    [
      { identity: "ana", label: "Ana" },
      { identity: "eu", label: "Eu", local: true },
    ],
    tiles,
  );
  const radio = cards.find((card) => card.kind === "radio");
  assert.deepEqual(radio, { id: "radio:radio", kind: "radio", identity: "ana", label: "Ana", local: false, videoId: null, audioIds: ["radio"] });
  assert.deepEqual(cards.find((card) => card.id === "person:ana")?.audioIds, ["mic"], "the radio is not part of Ana's voice");
  assert.equal(cards.at(-1)?.kind, "radio");
  assert.equal(featuredCard(cards, null), "person:ana");
  assert.equal(featuredCard([radio!, ...cards.filter((card) => card.local)], null), "person:eu");
  assert.equal(featuredCard(cards, "radio:radio"), "radio:radio");
  assert.equal(placeCards(cards, "grid", null).others.at(-1), "radio:radio");
});
