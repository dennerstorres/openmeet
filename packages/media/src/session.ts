import {
  DisconnectReason,
  Room,
  RoomEvent,
  Track,
  type LocalTrackPublication,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
  type TrackPublication,
} from "livekit-client";
import { describeMediaError, mediaActionError, sanitizeDiagnostic, type DiagnosticEvent } from "./diagnostics.js";
import { buildDiagnosticExport, dropOpenReconnect, pushReconnect, summarizeReconnect, type ReconnectMark, type ReconnectSummary } from "./report.js";
import { classifyDisconnect, nextPhase, type ConnectionPhase } from "./phase.js";
import { collectTrackReports, emptyStats, readDisplaySurface, readUserAgent, summarizeRtcStats, type RtcSnapshot } from "./stats.js";

export type DeviceKind = "audioinput" | "audiooutput" | "videoinput";

export interface DeviceOption {
  deviceId: string;
  label: string;
  kind: DeviceKind;
  active: boolean;
}

export function buildDeviceList(
  found: Array<{ deviceId: string; label: string; kind: DeviceKind }>,
  activeIds: Partial<Record<DeviceKind, string | undefined>>,
): DeviceOption[] {
  return found.map((device) => ({
    deviceId: device.deviceId,
    label: device.label.length > 0 ? device.label : "permissão pendente",
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

export interface TrackTile {
  id: string;
  identity: string;
  source: "microphone" | "camera" | "screen" | "screen-audio" | "unknown";
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
  participants: string[];
  diagnostics: DiagnosticEvent[];
  devices: DeviceOption[];
  stats: RtcSnapshot;
  reconnect: ReconnectSummary;
  microphone: boolean;
  camera: boolean;
  screen: boolean;
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
  private readonly room: Room;
  private readonly tiles = new Map<string, TrackTile>();
  private readonly listeners = new Set<Listener>();
  private readonly diagnostics: DiagnosticEvent[] = [];
  private readonly secrets: string[] = [];
  private readonly appVersion: string | null;
  private phase: ConnectionPhase = "idle";
  private disconnectReason: string | null = null;
  private explicitLeave = false;
  private devices: DeviceOption[] = [];
  private stats: RtcSnapshot;
  private marks: ReconnectMark[] = [];

  constructor(options?: { appVersion?: string; room?: Room }) {
    this.room = options?.room ?? new Room();
    this.appVersion = options?.appVersion ?? null;
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
      this.note("info", `disconnected: ${outcome.reason}`);
    });
    this.room.on(RoomEvent.MediaDevicesError, (error: Error) => {
      this.note("error", describeMediaError(error));
    });
    this.room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, publication: RemoteTrackPublication, participant: RemoteParticipant) => {
      this.rememberTrack(track, publication.trackSid, participant.identity, false);
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
        this.rememberTrack(publication.track, publication.trackSid, this.room.localParticipant.identity, true);
      }
    });
    this.room.on(RoomEvent.LocalTrackUnpublished, (publication: LocalTrackPublication) => {
      this.tiles.delete(publication.trackSid);
      this.note("info", `local track stopped: ${sourceName(publication.source)}`);
    });
    this.room.on(RoomEvent.ParticipantConnected, () => {
      this.emit();
    });
    this.room.on(RoomEvent.ParticipantDisconnected, () => {
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
      participants: [local.identity, ...[...this.room.remoteParticipants.values()].map((participant) => participant.identity)].filter(
        (identity) => identity.length > 0,
      ),
      diagnostics: [...this.diagnostics],
      devices: [...this.devices],
      stats: this.stats,
      reconnect: summarizeReconnect(this.marks),
      microphone: local.isMicrophoneEnabled,
      camera: local.isCameraEnabled,
      screen: local.isScreenShareEnabled,
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

  async setMicrophone(enabled: boolean): Promise<void> {
    await this.toggle(() => this.room.localParticipant.setMicrophoneEnabled(enabled), "microphone");
    await this.refreshDevices();
  }

  async setCamera(enabled: boolean): Promise<void> {
    await this.toggle(() => this.room.localParticipant.setCameraEnabled(enabled), "camera");
    await this.refreshDevices();
  }

  async setScreenShare(enabled: boolean): Promise<void> {
    await this.toggle(() => this.room.localParticipant.setScreenShareEnabled(enabled, { audio: false }), "screen");
  }

  applyDeviceList(
    found: Array<{ deviceId: string; label: string; kind: DeviceKind }>,
    activeIds: Partial<Record<DeviceKind, string | undefined>>,
  ): DeviceOption[] {
    this.devices = buildDeviceList(found, activeIds);
    this.emit();
    return this.devices;
  }

  async refreshDevices(): Promise<DeviceOption[]> {
    const kinds: DeviceKind[] = ["audioinput", "audiooutput", "videoinput"];
    const found: Array<{ deviceId: string; label: string; kind: DeviceKind }> = [];
    const activeIds: Partial<Record<DeviceKind, string | undefined>> = {};
    for (const kind of kinds) {
      activeIds[kind] = this.room.getActiveDevice(kind);
      const listed = await Room.getLocalDevices(kind, false);
      for (const device of listed) {
        found.push({ deviceId: device.deviceId, label: device.label, kind });
      }
    }
    return this.applyDeviceList(found, activeIds);
  }

  async selectDevice(kind: DeviceKind, deviceId: string): Promise<void> {
    try {
      const switched = await this.room.switchActiveDevice(kind, deviceId);
      this.note(switched ? "info" : "error", switched ? `device selected: ${kind}` : `device switch failed: ${kind}`);
      if (switched) {
        await this.refreshDevices();
      }
    } catch (error) {
      this.note("error", describeMediaError(error));
      throw error;
    }
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

  private rememberTrack(track: Track, id: string, identity: string, local: boolean): void {
    if (track.kind !== Track.Kind.Audio && track.kind !== Track.Kind.Video) {
      return;
    }
    const media = track.kind === Track.Kind.Audio ? "audio" : "video";
    this.upsertTile({
      id,
      identity,
      source: sourceName(track.source),
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
