import {
  DisconnectReason,
  LocalAudioTrack,
  LocalVideoTrack,
  Room,
  RoomEvent,
  Track,
  type LocalTrack,
  type LocalTrackPublication,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
  type TrackPublication,
} from "livekit-client";
import { describeMediaError, mediaActionError, sanitizeDiagnostic, type DiagnosticEvent } from "./diagnostics.js";
import { HANDS_FREE_HINT, isHandsFree, playbackOutput, type AudioDevice } from "./bluetooth-output.js";
import { InputGain } from "./input-gain.js";
import { isRadio, radioCapture, radioPublish } from "./radio.js";
import { readAudioWorkletSupport, voiceEffectsFor, type VoiceEffect } from "./voice-effects.js";
import { VideoBackground, type VideoBackgroundOptions } from "./video-background.js";
import { browserLabel, readBrowserMedia, type BrowserMedia } from "./browser.js";
import { buildDiagnosticExport, dropOpenReconnect, pushReconnect, summarizeReconnect, type ReconnectMark, type ReconnectSummary } from "./report.js";
import { screenAudioState, type ScreenAudioState } from "./layout.js";
import { classifyDisconnect, nextPhase, type ConnectionPhase } from "./phase.js";
import { collectTrackReports, emptyStats, readDisplaySurface, readUserAgent, summarizeRtcStats, type RtcSnapshot } from "./stats.js";

export type DeviceKind = "audioinput" | "audiooutput" | "videoinput";

export interface DeviceOption {
  deviceId: string;
  label: string;
  kind: DeviceKind;
  active: boolean;
}

export function buildDeviceList(found: AudioDevice[], activeIds: Partial<Record<DeviceKind, string | undefined>>): DeviceOption[] {
  return found.map((device) => ({
    deviceId: device.deviceId,
    label:
      device.label.length === 0
        ? "permissão pendente"
        : device.kind === "audiooutput" && isHandsFree(device.label)
          ? `${device.label} · ${HANDS_FREE_HINT}`
          : device.label,
    kind: device.kind,
    active: device.deviceId.length > 0 && activeIds[device.kind] === device.deviceId,
  }));
}

export function shouldAttachPlayback(tile: Pick<TrackTile, "media" | "local">): boolean {
  return tile.media !== "audio" || !tile.local;
}

export function shouldShowLiveVideo(tile: Pick<TrackTile, "media" | "muted">): boolean {
  return tile.media === "video" && !tile.muted;
}

const PARTICIPANT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function participantLabel(name: string, local: boolean): string {
  const trimmed = name.trim();
  if (trimmed.length === 0 || PARTICIPANT_UUID.test(trimmed)) return local ? "Você" : "Participante";
  return trimmed;
}

export interface RoomPerson {
  identity: string;
  label: string;
  local: boolean;
}

export interface TrackTile {
  id: string;
  identity: string;
  label: string;
  source: "microphone" | "camera" | "screen" | "screen-audio" | "radio" | "unknown";
  media: "audio" | "video";
  local: boolean;
  muted: boolean;
  surface?: string | null;
  attach: (element: HTMLMediaElement) => void;
  detach: (element: HTMLMediaElement) => void;
}

export interface PocSnapshot {
  phase: ConnectionPhase;
  disconnectReason: string | null;
  tiles: TrackTile[];
  participants: RoomPerson[];
  diagnostics: DiagnosticEvent[];
  devices: DeviceOption[];
  stats: RtcSnapshot;
  reconnect: ReconnectSummary;
  microphone: boolean;
  camera: boolean;
  screen: boolean;
  /** PC audio of the local share: not asked, published, or asked and absent. */
  screenAudio: ScreenAudioState;
  audioPlayback: boolean;
  /** Identities the SFU reports as speaking now, loudest first. */
  speakers: string[];
  backgroundBlurSupported: boolean;
  backgroundBlur: boolean;
  backgroundBlurRadius: number;
  /** ADR 0020: effects this client can run, the one in use and the local monitor. */
  voiceEffects: VoiceEffect[];
  voiceEffect: VoiceEffect;
  voiceMonitor: boolean;
  /** ADR 0021: id of the library sound playing now, and the panel volume (0–1). */
  soundPlaying: string | null;
  soundVolume: number;
  /** ADR 0022: this participant's radio is on, and the input it takes (never sent anywhere). */
  radio: boolean;
  radioDevice: string | null;
}

type Listener = (snapshot: PocSnapshot) => void;

function sourceName(source: Track.Source): TrackTile["source"] {
  switch (source) {
    case Track.Source.Microphone:
      return "microphone";
    case Track.Source.Camera:
      return "camera";
    case Track.Source.ScreenShare:
      return "screen";
    case Track.Source.ScreenShareAudio:
      return "screen-audio";
    default:
      return "unknown";
  }
}

function readTrackDisplaySurface(track: Track): string | null {
  if (track.source !== Track.Source.ScreenShare) {
    return null;
  }
  try {
    return readDisplaySurface(track.mediaStreamTrack.getSettings());
  } catch {
    return null;
  }
}

export class LiveKitPocSession {
  private readonly inputGain = new InputGain();
  private readonly videoBackground: VideoBackground;
  private readonly room: Room;
  private readonly tiles = new Map<string, TrackTile>();
  private readonly listeners = new Set<Listener>();
  private readonly diagnostics: DiagnosticEvent[] = [];
  private readonly secrets: string[] = [];
  private readonly appVersion: string | null;
  private readonly client: "desktop" | "web" | null;
  /** ADR 0014: what this browser gives; the screen hides what is missing. */
  readonly browser: BrowserMedia;
  private readonly audioWorklet: boolean;
  private phase: ConnectionPhase = "idle";
  private disconnectReason: string | null = null;
  private explicitLeave = false;
  private devices: DeviceOption[] = [];
  private found: AudioDevice[] = [];
  /** Output the user picked; the one in use may be its stereo sibling. */
  private requestedOutput: string | undefined;
  private audioPlayback = true;
  private speakers: string[] = [];
  private screenAudioRequested = false;
  private soundId: string | null = null;
  /** The input the radio was turned on with; it stays set while a screen share stop takes the track away. */
  private radioDevice: string | null = null;
  private readonly createRadioTrack: (options: ReturnType<typeof radioCapture>) => Promise<LocalTrack>;
  /** The microphone was muted and only opened for the sound; it closes again when the sound ends. */
  private soundOpenedMic = false;
  private stats: RtcSnapshot;
  private marks: ReconnectMark[] = [];

  constructor(options?: {
    appVersion?: string;
    room?: Room;
    client?: "desktop" | "web";
    browser?: BrowserMedia;
    videoBackground?: VideoBackgroundOptions;
    audioWorklet?: boolean;
    createRadioTrack?: (options: ReturnType<typeof radioCapture>) => Promise<LocalTrack>;
  }) {
    this.room = options?.room ?? new Room();
    this.videoBackground = new VideoBackground(options?.videoBackground);
    this.appVersion = options?.appVersion ?? null;
    this.client = options?.client ?? null;
    this.browser = options?.browser ?? readBrowserMedia();
    this.audioWorklet = options?.audioWorklet ?? readAudioWorkletSupport();
    this.createRadioTrack =
      options?.createRadioTrack ??
      (async (capture) => {
        const [track] = await this.room.localParticipant.createTracks({ audio: capture, video: false });
        if (!track) throw new Error("Radio input unavailable");
        return track;
      });
    this.stats = { ...emptyStats(), userAgent: readUserAgent(), appVersion: this.appVersion };
    this.room.on(RoomEvent.Reconnecting, () => {
      this.phase = nextPhase(this.phase, "reconnecting");
      this.marks = pushReconnect(this.marks, "start", Date.now());
      this.note("info", "reconnecting");
    });
    this.room.on(RoomEvent.SignalReconnecting, () => {
      this.phase = nextPhase(this.phase, "reconnecting");
      this.marks = pushReconnect(this.marks, "start", Date.now());
      this.note("info", "signal reconnecting");
    });
    this.room.on(RoomEvent.Reconnected, () => {
      this.phase = nextPhase(this.phase, "reconnected");
      this.disconnectReason = null;
      this.marks = pushReconnect(this.marks, "recovered", Date.now());
      this.note("info", "reconnected");
    });
    this.room.on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
      const explicitLeave = this.explicitLeave;
      const outcome = classifyDisconnect(reason, explicitLeave);
      this.explicitLeave = false;
      this.marks = explicitLeave ? dropOpenReconnect(this.marks) : pushReconnect(this.marks, "fatal", Date.now());
      this.phase = nextPhase(this.phase, outcome.event);
      this.disconnectReason = outcome.reason;
      this.tiles.clear();
      this.radioDevice = null;
      this.speakers = [];
      // ADR 0020: every room entry starts with the plain voice.
      this.inputGain.setMonitor(false);
      this.inputGain.stopSound();
      this.inputGain.setVoiceOpen(true);
      this.soundId = null;
      this.soundOpenedMic = false;
      void this.inputGain.setEffect("off").catch(() => undefined);
      this.note("info", `disconnected: ${outcome.reason}`);
    });
    this.room.on(RoomEvent.MediaDevicesError, (error: Error) => {
      this.note("error", describeMediaError(error));
    });
    this.room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, publication: RemoteTrackPublication, participant: RemoteParticipant) => {
      this.rememberTrack(
        track,
        publication.trackSid,
        participant.identity,
        participantLabel(participant.name || participant.identity, false),
        false,
        publication.trackName,
      );
    });
    this.room.on(RoomEvent.TrackUnsubscribed, (_track: RemoteTrack, publication: RemoteTrackPublication) => {
      this.tiles.delete(publication.trackSid);
      this.emit();
    });
    this.room.on(RoomEvent.TrackMuted, (publication: TrackPublication) => {
      this.setTrackMuted(publication.trackSid, true);
    });
    this.room.on(RoomEvent.TrackUnmuted, (publication: TrackPublication) => {
      this.setTrackMuted(publication.trackSid, false);
    });
    this.room.on(RoomEvent.LocalTrackPublished, (publication: LocalTrackPublication) => {
      if (publication.track) {
        this.rememberTrack(
          publication.track,
          publication.trackSid,
          this.room.localParticipant.identity,
          participantLabel(this.room.localParticipant.name || this.room.localParticipant.identity, true),
          true,
          publication.trackName,
        );
      }
    });
    this.room.on(RoomEvent.LocalTrackUnpublished, (publication: LocalTrackPublication) => {
      this.tiles.delete(publication.trackSid);
      this.note("info", `local track stopped: ${sourceName(publication.source)}`);
    });
    this.room.on(RoomEvent.ActiveSpeakersChanged, (speakers: { identity: string }[]) => {
      this.speakers = speakers.map((person) => person.identity).filter((identity) => identity.length > 0);
      this.emit();
    });
    this.room.on(RoomEvent.ParticipantConnected, () => {
      this.emit();
    });
    this.room.on(RoomEvent.ParticipantDisconnected, () => {
      this.emit();
    });
    this.room.on(RoomEvent.AudioPlaybackStatusChanged, (enabled: boolean) => {
      this.audioPlayback = enabled;
      this.emit();
    });
    this.room.on(RoomEvent.MediaDevicesChanged, () => {
      void this.refreshDevices().catch((error: unknown) => {
        this.note("error", describeMediaError(error));
      });
    });
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  snapshot(): PocSnapshot {
    const local = this.room.localParticipant;
    return {
      phase: this.phase,
      disconnectReason: this.disconnectReason,
      tiles: [...this.tiles.values()],
      participants: [local, ...this.room.remoteParticipants.values()]
        .filter((person) => person.identity.length > 0)
        .map((person) => ({
          identity: person.identity,
          label: participantLabel(person.name || person.identity, person === local),
          local: person === local,
        })),
      diagnostics: [...this.diagnostics],
      devices: [...this.devices],
      stats: this.stats,
      reconnect: summarizeReconnect(this.marks),
      microphone: local.isMicrophoneEnabled,
      camera: local.isCameraEnabled,
      screen: local.isScreenShareEnabled,
      screenAudio: screenAudioState(local.isScreenShareEnabled, this.screenAudioRequested, this.screenAudioPublication() !== undefined),
      audioPlayback: this.audioPlayback,
      speakers: [...this.speakers],
      backgroundBlurSupported: this.videoBackground.isSupported,
      backgroundBlur: this.videoBackground.isEnabled,
      backgroundBlurRadius: this.videoBackground.blurRadius,
      voiceEffects: voiceEffectsFor(this.audioWorklet),
      voiceEffect: this.inputGain.effect,
      voiceMonitor: this.inputGain.monitor,
      soundPlaying: this.soundId,
      soundVolume: this.inputGain.soundVolume,
      radio: this.radioPublication() !== undefined,
      radioDevice: this.radioDevice,
    };
  }

  exportDiagnostic(consent: boolean, exportedAt: string): string | null {
    const snapshot = this.snapshot();
    return buildDiagnosticExport(
      {
        exportedAt,
        phase: snapshot.phase,
        disconnectReason: snapshot.disconnectReason,
        appVersion: snapshot.stats.appVersion,
        userAgent: snapshot.stats.userAgent,
        client: this.client,
        browser: browserLabel(this.browser),
        stats: snapshot.stats,
        events: snapshot.diagnostics,
        reconnect: snapshot.reconnect,
        secrets: this.secrets,
      },
      consent,
    );
  }

  async connect(url: string, token: string): Promise<void> {
    this.secrets.push(token);
    this.marks = [];
    this.explicitLeave = false;
    this.disconnectReason = null;
    this.phase = nextPhase(this.phase, "connect_started");
    this.emit();
    try {
      await this.room.connect(url, token);
      this.phase = nextPhase(this.phase, "connected");
      this.note("info", "connected");
    } catch (error) {
      this.phase = nextPhase(this.phase, "fatal");
      this.note("error", describeMediaError(error));
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    this.explicitLeave = true;
    await this.room.disconnect(true);
  }

  async startRemoteAudio(): Promise<void> {
    await this.room.startAudio();
    this.audioPlayback = this.room.canPlaybackAudio;
    this.emit();
  }

  async setMicrophone(enabled: boolean): Promise<void> {
    // A choice made while a sound holds the microphone open wins over the automatic close.
    if (this.soundOpenedMic) {
      this.soundOpenedMic = false;
      this.inputGain.setVoiceOpen(true);
      if (!enabled) this.inputGain.stopSound();
    }
    await this.toggle(async () => {
      const local = this.room.localParticipant;
      const existing = local.getTrackPublication(Track.Source.Microphone)?.track;
      if (enabled && !existing) {
        // createTracks assigns the room AudioContext. Capture options apply processors too early
        // in this SDK version, before that context exists. Process before publishing instead.
        const tracks = await local.createTracks({ audio: true, video: false });
        try {
          const track = tracks.find((candidate) => candidate instanceof LocalAudioTrack);
          const audioTrack: unknown = track;
          if (!track || !(audioTrack instanceof LocalAudioTrack)) throw new Error("Microphone unavailable");
          await audioTrack.setProcessor(this.inputGain);
          await local.publishTrack(track);
        } catch (error) {
          for (const track of tracks) track.stop();
          throw error;
        }
      } else {
        if (enabled && existing instanceof LocalAudioTrack && existing.getProcessor() !== this.inputGain) {
          await existing.setProcessor(this.inputGain);
        }
        await local.setMicrophoneEnabled(enabled);
      }
    }, "microphone");
    await this.refreshDevices();
    await this.alignOutput();
  }

  setMicrophoneVolume(value: number): void {
    this.inputGain.setVolume(value);
  }

  /** Switches the effect in the live graph without republishing; on failure the voice goes out plain. */
  async setVoiceEffect(effect: VoiceEffect): Promise<void> {
    try {
      await this.inputGain.setEffect(effect);
    } catch (error) {
      this.note("error", `voice effect unavailable: ${describeMediaError(error)}`);
      throw error;
    } finally {
      this.emit();
    }
  }

  /**
   * ADR 0022: publishes the chosen input as the radio, or turns it off with `null`. Changing the input
   * republishes. Turning it on drops the PC audio of a running share.
   */
  async setRadio(deviceId: string | null): Promise<void> {
    const local = this.room.localParticipant;
    const current = this.radioPublication();
    if (current?.track) await local.unpublishTrack(current.track, true);
    this.radioDevice = null;
    if (deviceId === null) {
      if (current) this.note("info", "radio off");
      else this.emit();
      return;
    }
    const shared = this.screenAudioPublication();
    if (shared?.track) {
      await local.unpublishTrack(shared.track, true);
      this.screenAudioRequested = false;
      this.note("info", "screen audio off: radio on");
    }
    const track = await this.createRadioTrack(radioCapture(deviceId));
    try {
      await local.publishTrack(track, radioPublish());
    } catch (error) {
      track.stop();
      this.emit();
      throw error;
    }
    this.radioDevice = deviceId;
    this.note("info", "radio on");
  }

  private radioPublication(): LocalTrackPublication | undefined {
    return [...this.room.localParticipant.audioTrackPublications.values()].find((publication) => isRadio(publication));
  }

  private screenAudioPublication(): LocalTrackPublication | undefined {
    return [...this.room.localParticipant.audioTrackPublications.values()].find(
      (publication) => publication.source === Track.Source.ScreenShareAudio && !isRadio(publication),
    );
  }

  /**
   * ADR 0021: plays a library sound to the room through the microphone track. With the microphone muted,
   * the track opens only for the sound, with the voice at zero, and mutes again when it ends or stops.
   */
  async playSound(id: string, bytes: Uint8Array): Promise<void> {
    const local = this.room.localParticipant;
    const track = local.getTrackPublication(Track.Source.Microphone)?.track;
    if (!(track instanceof LocalAudioTrack) || track.getProcessor() !== this.inputGain) throw new Error("microphone_unavailable");
    const buffer = await this.inputGain.decodeSound(bytes);
    if (!local.isMicrophoneEnabled && !this.soundOpenedMic) {
      this.inputGain.setVoiceOpen(false);
      this.soundOpenedMic = true;
      await track.unmute();
    }
    this.soundId = id;
    this.note("info", "sound played");
    const ended = this.inputGain.playSound(buffer);
    void ended.then(() => this.afterSound(id, track));
  }

  stopSound(): void {
    this.inputGain.stopSound();
  }

  setSoundVolume(value: number): void {
    this.inputGain.setSoundVolume(value);
    this.emit();
  }

  private async afterSound(id: string, track: LocalAudioTrack): Promise<void> {
    if (this.soundId !== id) return;
    this.soundId = null;
    if (this.soundOpenedMic) {
      this.soundOpenedMic = false;
      try {
        await track.mute();
      } finally {
        this.inputGain.setVoiceOpen(true);
      }
    }
    this.emit();
  }

  setVoiceMonitor(enabled: boolean): void {
    this.inputGain.setMonitor(enabled);
    this.emit();
  }

  async setCamera(enabled: boolean): Promise<void> {
    await this.toggle(() => this.room.localParticipant.setCameraEnabled(enabled), "camera");
    if (enabled) {
      const track = this.room.localParticipant.getTrackPublication(Track.Source.Camera)?.track;
      if (track instanceof LocalVideoTrack) await this.videoBackground.apply(track);
    }
    await this.refreshDevices();
  }

  async setBackgroundBlur(enabled: boolean): Promise<void> {
    const track = this.room.localParticipant.getTrackPublication(Track.Source.Camera)?.track;
    await this.videoBackground.setEnabled(track instanceof LocalVideoTrack ? track : undefined, enabled);
    this.emit();
  }

  async setBackgroundBlurRadius(radius: number): Promise<void> {
    await this.videoBackground.setBlurRadius(radius);
    this.emit();
  }

  /** The image and, only when asked, the PC audio in the same picker. Stopping ends both. */
  async setScreenShare(enabled: boolean, requestAudio = false): Promise<void> {
    // A browser without screen audio is never asked for it (ADR 0014).
    const withAudio = requestAudio && this.browser.screenAudio;
    this.screenAudioRequested = enabled && withAudio;
    const options = enabled && withAudio ? { audio: true, systemAudio: "include" as const } : { audio: false };
    // ADR 0022: the radio and the PC audio of a share are never on together.
    const radio = this.radioDevice;
    if (enabled && withAudio && radio !== null) {
      await this.setRadio(null);
      this.note("info", "radio off: screen audio on");
    }
    await this.toggle(() => this.room.localParticipant.setScreenShareEnabled(enabled, options), "screen");
    if (enabled && withAudio && this.screenAudioPublication() === undefined) {
      this.note("error", "screen audio missing: the source gave no PC audio");
    }
    // Stopping a share unpublishes the first screen-audio track, which can be the radio. Bring it back.
    const kept = this.radioDevice;
    if (!enabled && kept !== null && this.radioPublication() === undefined) {
      await this.setRadio(kept).catch((error: unknown) => {
        this.note("error", `radio lost: ${describeMediaError(error)}`);
      });
    }
  }

  applyDeviceList(found: AudioDevice[], activeIds: Partial<Record<DeviceKind, string | undefined>>): DeviceOption[] {
    this.found = found;
    this.devices = buildDeviceList(found, activeIds);
    this.emit();
    return this.devices;
  }

  async refreshDevices(): Promise<DeviceOption[]> {
    const kinds: DeviceKind[] = ["audioinput", "audiooutput", "videoinput"];
    const found: AudioDevice[] = [];
    const activeIds: Partial<Record<DeviceKind, string | undefined>> = {};
    for (const kind of kinds) {
      activeIds[kind] = this.room.getActiveDevice(kind);
      const listed = await Room.getLocalDevices(kind, false);
      for (const device of listed) {
        found.push({ deviceId: device.deviceId, label: device.label, kind, groupId: device.groupId });
      }
    }
    return this.applyDeviceList(found, activeIds);
  }

  async selectDevice(kind: DeviceKind, deviceId: string): Promise<void> {
    try {
      if (kind === "audiooutput") this.requestedOutput = deviceId;
      const target = kind === "audiooutput" ? playbackOutput(this.found, deviceId, this.room.getActiveDevice("audioinput")) : deviceId;
      const switched = await this.room.switchActiveDevice(kind, target);
      this.note(switched ? "info" : "error", switched ? `device selected: ${kind}` : `device switch failed: ${kind}`);
      if (target !== deviceId) this.note("info", "hands-free output replaced by stereo: microphone is not the headset");
      if (switched) {
        await this.refreshDevices();
        if (kind === "audioinput") await this.alignOutput();
      }
    } catch (error) {
      this.note("error", describeMediaError(error));
      throw error;
    }
  }

  /** A new microphone may turn a Hands-Free output silent, or make it usable again. */
  private async alignOutput(): Promise<void> {
    const current = this.room.getActiveDevice("audiooutput");
    const requested = this.requestedOutput ?? current;
    if (!requested) return;
    const target = playbackOutput(this.found, requested, this.room.getActiveDevice("audioinput"));
    if (target === current) return;
    await this.room.switchActiveDevice("audiooutput", target);
    this.note("info", target === requested ? "output returned to the picked device" : "hands-free output replaced by stereo: microphone is not the headset");
    await this.refreshDevices();
  }

  async refreshStats(): Promise<RtcSnapshot> {
    const tracks = this.statsTracks();
    let displaySurface: string | null = null;
    for (const track of tracks) {
      const surface = readTrackDisplaySurface(track);
      if (surface) {
        displaySurface = surface;
      }
    }
    const context = { displaySurface, userAgent: readUserAgent(), appVersion: this.appVersion };
    try {
      const stats = await collectTrackReports(tracks);
      this.stats = summarizeRtcStats(stats, context);
    } catch {
      this.stats = { ...emptyStats(), ...context };
    }
    this.emit();
    return this.stats;
  }

  private statsTracks(): Track[] {
    const tracks: Track[] = [];
    for (const publication of this.room.localParticipant.getTrackPublications()) {
      if (publication.track) {
        tracks.push(publication.track);
      }
    }
    for (const participant of this.room.remoteParticipants.values()) {
      for (const publication of participant.getTrackPublications()) {
        if (publication.track) {
          tracks.push(publication.track);
        }
      }
    }
    return tracks;
  }

  private async toggle(action: () => Promise<unknown>, label: string): Promise<void> {
    try {
      await action();
      this.note("info", `${label} updated`);
    } catch (error) {
      this.note("error", mediaActionError(label, error));
      throw error;
    }
  }

  upsertTile(tile: TrackTile): void {
    const previous = this.tiles.get(tile.id);
    this.tiles.set(tile.id, tile);
    const previousSurface = previous?.source === "screen" ? previous.surface : null;
    if (previousSurface && tile.surface && previousSurface !== tile.surface) {
      this.note("info", `screen source changed: ${previousSurface} -> ${tile.surface}`);
      return;
    }
    this.emit();
  }

  setTrackMuted(trackSid: string, muted: boolean): void {
    const current = this.tiles.get(trackSid);
    if (!current) {
      return;
    }
    this.tiles.set(trackSid, { ...current, muted });
    this.emit();
  }

  private rememberTrack(track: Track, id: string, identity: string, label: string, local: boolean, name = ""): void {
    if (track.kind !== Track.Kind.Audio && track.kind !== Track.Kind.Video) {
      return;
    }
    const media = track.kind === Track.Kind.Audio ? "audio" : "video";
    this.upsertTile({
      id,
      identity,
      label,
      source: isRadio({ source: track.source, trackName: name }) ? "radio" : sourceName(track.source),
      media,
      local,
      muted: track.isMuted,
      surface: readTrackDisplaySurface(track),
      attach: (element) => {
        track.attach(element);
      },
      detach: (element) => {
        track.detach(element);
      },
    });
  }

  private emit(): void {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }

  private note(level: DiagnosticEvent["level"], message: string): void {
    this.diagnostics.push({
      at: new Date().toISOString(),
      level,
      message: sanitizeDiagnostic(message, this.secrets),
    });
    if (this.diagnostics.length > 40) {
      this.diagnostics.shift();
    }
    this.emit();
  }
}
