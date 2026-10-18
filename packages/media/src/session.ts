import { Room, RoomEvent, Track, type LocalTrackPublication, type RemoteParticipant, type RemoteTrack, type RemoteTrackPublication } from "livekit-client";
import { describeMediaError, sanitizeDiagnostic, type DiagnosticEvent } from "./diagnostics.js";
import { nextPhase, type ConnectionPhase } from "./phase.js";
import { emptyStats, summarizeRtcStats, type RtcSnapshot, type StatLike } from "./stats.js";

export type DeviceKind = "audioinput" | "audiooutput" | "videoinput";

export interface DeviceOption {
  deviceId: string;
  label: string;
  kind: DeviceKind;
}

export function shouldAttachPlayback(tile: Pick<TrackTile, "media" | "local">): boolean {
  return tile.media !== "audio" || !tile.local;
}

export interface TrackTile {
  id: string;
  identity: string;
  source: "microphone" | "camera" | "screen" | "screen-audio" | "unknown";
  media: "audio" | "video";
  local: boolean;
  attach: (element: HTMLMediaElement) => void;
  detach: (element: HTMLMediaElement) => void;
}

export interface PocSnapshot {
  phase: ConnectionPhase;
  tiles: TrackTile[];
  participants: string[];
  diagnostics: DiagnosticEvent[];
  stats: RtcSnapshot;
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

function toStatLike(stat: RTCStats): StatLike {
  const record = stat as RTCStats & {
    packetsLost?: number;
    jitter?: number;
    currentRoundTripTime?: number;
    nominated?: boolean;
    state?: string;
  };
  const like: StatLike = { type: stat.type };
  if (typeof record.packetsLost === "number") {
    like.packetsLost = record.packetsLost;
  }
  if (typeof record.jitter === "number") {
    like.jitter = record.jitter;
  }
  if (typeof record.currentRoundTripTime === "number") {
    like.currentRoundTripTime = record.currentRoundTripTime;
  }
  if (typeof record.nominated === "boolean") {
    like.nominated = record.nominated;
  }
  if (typeof record.state === "string") {
    like.state = record.state;
  }
  return like;
}

export class LiveKitPocSession {
  private readonly room = new Room();
  private readonly tiles = new Map<string, TrackTile>();
  private readonly listeners = new Set<Listener>();
  private readonly diagnostics: DiagnosticEvent[] = [];
  private readonly secrets: string[] = [];
  private phase: ConnectionPhase = "idle";
  private stats: RtcSnapshot = emptyStats();

  constructor() {
    this.room.on(RoomEvent.Reconnecting, () => {
      this.phase = nextPhase(this.phase, "reconnecting");
      this.note("info", "reconnecting");
    });
    this.room.on(RoomEvent.SignalReconnecting, () => {
      this.phase = nextPhase(this.phase, "reconnecting");
      this.note("info", "signal reconnecting");
    });
    this.room.on(RoomEvent.Reconnected, () => {
      this.phase = nextPhase(this.phase, "reconnected");
      this.note("info", "reconnected");
    });
    this.room.on(RoomEvent.Disconnected, () => {
      this.phase = nextPhase(this.phase, "disconnected");
      this.tiles.clear();
      this.note("info", "disconnected");
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
      tiles: [...this.tiles.values()],
      participants: [local.identity, ...[...this.room.remoteParticipants.values()].map((participant) => participant.identity)].filter(
        (identity) => identity.length > 0,
      ),
      diagnostics: [...this.diagnostics],
      stats: this.stats,
      microphone: local.isMicrophoneEnabled,
      camera: local.isCameraEnabled,
      screen: local.isScreenShareEnabled,
    };
  }

  async connect(url: string, token: string): Promise<void> {
    this.secrets.push(token);
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
    await this.room.disconnect(true);
  }

  async setMicrophone(enabled: boolean): Promise<void> {
    await this.toggle(() => this.room.localParticipant.setMicrophoneEnabled(enabled), "microphone");
  }

  async setCamera(enabled: boolean): Promise<void> {
    await this.toggle(() => this.room.localParticipant.setCameraEnabled(enabled), "camera");
  }

  async setScreenShare(enabled: boolean): Promise<void> {
    await this.toggle(() => this.room.localParticipant.setScreenShareEnabled(enabled, { audio: false }), "screen");
  }

  async listDevices(): Promise<DeviceOption[]> {
    const kinds: DeviceKind[] = ["audioinput", "audiooutput", "videoinput"];
    const devices: DeviceOption[] = [];
    for (const kind of kinds) {
      const found = await Room.getLocalDevices(kind, false);
      for (const device of found) {
        devices.push({
          deviceId: device.deviceId,
          label: device.label.length > 0 ? device.label : device.deviceId,
          kind,
        });
      }
    }
    return devices;
  }

  async selectDevice(kind: DeviceKind, deviceId: string): Promise<void> {
    try {
      const switched = await this.room.switchActiveDevice(kind, deviceId);
      this.note(switched ? "info" : "error", switched ? `device selected: ${kind}` : `device switch failed: ${kind}`);
    } catch (error) {
      this.note("error", describeMediaError(error));
      throw error;
    }
  }

  async refreshStats(): Promise<RtcSnapshot> {
    const manager = this.room.engine.pcManager;
    if (!manager) {
      this.stats = emptyStats();
      this.emit();
      return this.stats;
    }
    const reports = await Promise.all([manager.publisher.getStats(), manager.subscriber?.getStats()]);
    const stats: StatLike[] = [];
    for (const report of reports) {
      report?.forEach((item) => {
        stats.push(toStatLike(item));
      });
    }
    this.stats = summarizeRtcStats(stats);
    this.emit();
    return this.stats;
  }

  private async toggle(action: () => Promise<unknown>, label: string): Promise<void> {
    try {
      await action();
      this.note("info", `${label} updated`);
    } catch (error) {
      this.note("error", describeMediaError(error));
      throw error;
    }
  }

  private rememberTrack(track: Track, id: string, identity: string, local: boolean): void {
    if (track.kind !== Track.Kind.Audio && track.kind !== Track.Kind.Video) {
      return;
    }
    const media = track.kind === Track.Kind.Audio ? "audio" : "video";
    this.tiles.set(id, {
      id,
      identity,
      source: sourceName(track.source),
      media,
      local,
      attach: (element) => {
        track.attach(element);
      },
      detach: (element) => {
        track.detach(element);
      },
    });
    this.emit();
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
