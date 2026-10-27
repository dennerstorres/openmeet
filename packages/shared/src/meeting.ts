import { PocInputError } from "./poc.js";
import { inviteHost, inviteLink, parseInvite, type InviteLink } from "./invite.js";
import { parseOwnSounds, parseSoundLibrary, type OwnSound, type SoundSummary } from "./sound.js";
import {
  canonicalInstanceUrl,
  hasControlCharacter,
  parseAccountSession,
  parseBrokeredSession,
  parseGoogleStart,
  parseInstanceCard,
  parseRoomJoin,
  parsePresence,
  parseRoomList,
  parseServer,
  parseServerList,
  parseServerPresence,
  readErrorCode,
  type BrokeredSession,
  type RoomOccupant,
  type RoomSummary,
  type ServerSummary,
  type ServerPresenceView,
} from "./instance.js";

export interface ApiResult {
  status: number;
  body: unknown;
}

export interface InstanceApi {
  request(origin: string, method: "GET" | "POST", path: string, body: unknown, accessToken: string | null): Promise<ApiResult>;
}

export interface MeetingMedia {
  connect(url: string, token: string): Promise<void>;
  disconnect(): Promise<void>;
}

/**
 * S-05: who holds the refresh token. In the desktop it is the native process and the page never sees it;
 * in a plain browser it is `vaultSessionBroker`. Answers carry the session without its refresh.
 */
export interface SessionBroker {
  start(origin: string, kind: "login" | "bootstrap" | "google", body: Record<string, string>): Promise<ApiResult>;
  /** `null` when nothing is stored for this instance. */
  refresh(origin: string): Promise<ApiResult | null>;
  /** Logs out with the stored refresh. The store forgets it only once the server is done (S-18). */
  logout(origin: string): Promise<ApiResult>;
}

export interface SessionVault {
  load(origin: string): Promise<string | null>;
  save(origin: string, refreshToken: string): Promise<void>;
  clear(origin: string): Promise<void>;
}

export interface AccountInput {
  mode: "login" | "bootstrap";
  username: string;
  password: string;
  displayName: string;
  token: string;
}

export interface ShellSnapshot {
  step: "instance" | "account" | "rooms" | "meeting";
  origin: string | null;
  instanceName: string | null;
  bootstrapOpen: boolean;
  googleLogin: boolean;
  /** The system browser is open on Google and the app is waiting for the session. */
  googleWaiting: boolean;
  userLabel: string | null;
  role: string | null;
  /** The instance admin creates servers. */
  canCreateServer: boolean;
  /** Owner and moderator of the selected server create rooms in it. */
  canCreate: boolean;
  servers: readonly ServerSummary[];
  selectedServerId: string | null;
  /** Rooms of the selected server. The call may belong to another server. */
  rooms: readonly RoomSummary[];
  activeRoomId: string | null;
  activeRoomName: string | null;
  activeServerId: string | null;
  /** An invite waiting for the person to confirm. The code itself is never in the snapshot. */
  inviteOffer: { host: string; sameInstance: boolean } | null;
  /** Host of a confirmed invite that is accepted right after login. */
  inviteWaiting: string | null;
  /** The last link created here, for the person to copy. */
  createdInvite: string | null;
  /** People in each room of the selected server, or null when the SFU could not be asked. */
  presence: Readonly<Record<string, readonly RoomOccupant[]>> | null;
  /** Every member of the selected server and their platform presence. */
  serverPresence: ServerPresenceView | null;
  error: string | null;
  pending: boolean;
}

const INVITE_MINUTES = 1440;
const GOOGLE_POLL_MS = 2000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
const INVITE_USES = 10;

const idleMedia: MeetingMedia = {
  async connect() {},
  async disconnect() {},
};

export class MemorySessionVault implements SessionVault {
  private readonly secrets = new Map<string, string>();

  async load(origin: string): Promise<string | null> {
    return this.secrets.get(canonicalInstanceUrl(origin)) ?? null;
  }

  async save(origin: string, refreshToken: string): Promise<void> {
    this.secrets.set(canonicalInstanceUrl(origin), refreshToken);
  }

  async clear(origin: string): Promise<void> {
    this.secrets.delete(canonicalInstanceUrl(origin));
  }
}

const START_PATH = { login: "/api/v1/auth/login", bootstrap: "/api/v1/auth/bootstrap", google: "/api/v1/auth/google/poll" } as const;

function withoutRefresh(body: unknown): unknown {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return body;
  return Object.fromEntries(Object.entries(body).filter(([key]) => key !== "refreshToken"));
}

/** The browser and test broker: same contract as the native one, with the refresh in a SessionVault. */
export function vaultSessionBroker(api: InstanceApi, vault: SessionVault): SessionBroker {
  return {
    async start(origin, kind, body) {
      const result = await api.request(origin, "POST", START_PATH[kind], body, null);
      if (result.status !== 200 && result.status !== 201) return { status: result.status, body: withoutRefresh(result.body) };
      await vault.save(origin, parseAccountSession(result.body).refreshToken);
      return { status: result.status, body: withoutRefresh(result.body) };
    },
    async refresh(origin) {
      const refreshToken = await vault.load(origin);
      if (refreshToken === null) return null;
      const result = await api.request(origin, "POST", "/api/v1/auth/refresh", { refreshToken }, null);
      if (result.status === 200) await vault.save(origin, parseAccountSession(result.body).refreshToken);
      return { status: result.status, body: withoutRefresh(result.body) };
    },
    async logout(origin) {
      const refreshToken = await vault.load(origin);
      if (refreshToken === null) return { status: 204, body: null };
      const result = await api.request(origin, "POST", "/api/v1/auth/logout", { refreshToken }, null);
      // A later sign-in on the same instance may have saved a new token; that one stays.
      if (result.status < 500 && (await vault.load(origin)) === refreshToken) await vault.clear(origin);
      return result;
    },
  };
}

function isBroker(store: SessionVault | SessionBroker): store is SessionBroker {
  return "start" in store && "logout" in store;
}

export class MeetingModel {
  private generation = 0;
  private step: ShellSnapshot["step"] = "instance";
  private origin: string | null = null;
  private instanceName: string | null = null;
  private bootstrapOpen = false;
  private googleLogin = false;
  private googleWaiting = false;
  private accessToken: string | null = null;
  private sessionEpoch = 0;
  private readonly broker: SessionBroker;
  private userLabel: string | null = null;
  private role: string | null = null;
  private servers: ServerSummary[] = [];
  private selectedServerId: string | null = null;
  private rooms: RoomSummary[] = [];
  private activeRoom: { id: string; name: string; serverId: string } | null = null;
  private inviteOffer: { origin: string; code: string } | null = null;
  private pendingInvite: { origin: string; code: string } | null = null;
  private createdInvite: string | null = null;
  private presence: Record<string, RoomOccupant[]> | null = null;
  private presenceAsk = 0;
  private serverPresence: ServerPresenceView | null = null;
  private serverPresenceAsk = 0;
  private error: string | null = null;
  private pending = false;
  private readonly listeners = new Set<(snapshot: ShellSnapshot) => void>();

  constructor(
    private readonly api: InstanceApi,
    private readonly media: MeetingMedia = idleMedia,
    store: SessionVault | SessionBroker = new MemorySessionVault(),
    private readonly wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    /** The link a created invite is shared as: openmeet:// in the .exe, the https page on the web (ADR 0014). */
    private readonly shareLink: (origin: string, code: string) => string = inviteLink,
  ) {
    this.broker = isBroker(store) ? store : vaultSessionBroker(api, store);
  }

  snapshot(): ShellSnapshot {
    const role = this.role;
    const selected = this.servers.find((server) => server.id === this.selectedServerId);
    return {
      step: this.step,
      origin: this.origin,
      instanceName: this.instanceName,
      bootstrapOpen: this.bootstrapOpen,
      googleLogin: this.googleLogin,
      googleWaiting: this.googleWaiting,
      userLabel: this.userLabel,
      role,
      canCreateServer: role === "admin",
      canCreate: selected !== undefined && (selected.role === "owner" || selected.role === "moderator"),
      servers: this.servers.map((server) => ({ ...server })),
      selectedServerId: this.selectedServerId,
      rooms: this.rooms.map((room) => ({ ...room })),
      activeRoomId: this.activeRoom?.id ?? null,
      activeRoomName: this.activeRoom?.name ?? null,
      activeServerId: this.activeRoom?.serverId ?? null,
      inviteOffer: this.inviteOffer === null ? null : { host: inviteHost(this.inviteOffer.origin), sameInstance: this.inviteOffer.origin === this.origin },
      inviteWaiting: this.pendingInvite === null ? null : inviteHost(this.pendingInvite.origin),
      createdInvite: this.createdInvite,
      presence:
        this.presence === null
          ? null
          : Object.fromEntries(Object.entries(this.presence).map(([room, people]) => [room, people.map((person) => ({ ...person }))])),
      serverPresence: this.serverPresence === null ? null : { ...this.serverPresence, members: this.serverPresence.members.map((member) => ({ ...member })) },
      error: this.error,
      pending: this.pending,
    };
  }

  subscribe(listener: (snapshot: ShellSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async confirmInstance(raw: string): Promise<void> {
    await this.run(async (generation) => {
      const origin = canonicalInstanceUrl(raw);
      const result = await this.api.request(origin, "GET", "/api/v1/instance", null, null);
      if (generation !== this.generation) return;
      if (result.status !== 200) {
        this.error = readErrorCode(result.body);
        return;
      }
      const card = parseInstanceCard(result.body);
      this.origin = origin;
      this.instanceName = card.name;
      this.bootstrapOpen = card.bootstrapOpen;
      this.googleLogin = card.googleLogin;
      if (await this.restore(origin, generation)) return;
      if (generation !== this.generation) return;
      this.step = "account";
    });
  }

  async submitAccount(input: AccountInput): Promise<void> {
    await this.run(async (generation) => {
      const origin = this.pinned();
      if (origin === null) {
        this.error = "invalid_api_base";
        return;
      }
      const payload =
        input.mode === "bootstrap"
          ? { token: input.token, username: input.username, password: input.password, displayName: input.displayName }
          : { username: input.username, password: input.password };
      const result = await this.broker.start(origin, input.mode, payload);
      if (generation !== this.generation) return;
      if (result.status !== 200 && result.status !== 201) {
        this.error = readErrorCode(result.body);
        return;
      }
      await this.acceptSession(origin, parseBrokeredSession(result.body), generation);
    });
  }

  /**
   * ADR 0010. Opens Google in the system browser, then asks the API for the session until it is
   * ready. The poll secret never goes to the browser. Another action, or cancelGoogle, stops the wait.
   */
  async loginWithGoogle(openUrl: (url: string) => Promise<void>, wait: (ms: number) => Promise<void> = sleep): Promise<void> {
    await this.run(async (generation) => {
      const origin = this.pinned();
      if (origin === null || !this.googleLogin) {
        this.error = "google_unconfigured";
        return;
      }
      const started = await this.api.request(origin, "POST", "/api/v1/auth/google/start", {}, null);
      if (generation !== this.generation) return;
      if (started.status !== 201) {
        this.error = readErrorCode(started.body);
        return;
      }
      const { authUrl, poll, expiresIn } = parseGoogleStart(started.body);
      await openUrl(authUrl);
      if (generation !== this.generation) return;
      this.googleWaiting = true;
      this.publish();
      try {
        const deadline = Date.now() + expiresIn * 1000;
        while (Date.now() < deadline) {
          await wait(GOOGLE_POLL_MS);
          if (generation !== this.generation) return;
          const result = await this.broker.start(origin, "google", { poll });
          if (generation !== this.generation) return;
          if (result.status === 202) continue;
          if (result.status !== 200) {
            this.error = readErrorCode(result.body);
            return;
          }
          await this.acceptSession(origin, parseBrokeredSession(result.body), generation);
          return;
        }
        this.error = "google_expired";
      } finally {
        this.googleWaiting = false;
      }
    });
  }

  cancelGoogle(): void {
    if (!this.googleWaiting) return;
    this.generation += 1;
    this.googleWaiting = false;
    this.pending = false;
    this.publish();
  }

  async createRoom(name: string, slug: string, kind: string): Promise<void> {
    await this.run(async (generation) => {
      const origin = this.pinned();
      const accessToken = this.accessToken;
      if (origin === null || accessToken === null) {
        await this.dropExpiredSession(generation);
        return;
      }
      const server = this.servers.find((item) => item.id === this.selectedServerId);
      if (server === undefined || (server.role !== "owner" && server.role !== "moderator")) {
        this.error = "forbidden";
        return;
      }
      if (kind !== "persistent" && kind !== "temporary") {
        this.error = "invalid_body";
        return;
      }
      const result = await this.api.request(origin, "POST", `/api/v1/servers/${server.id}/rooms`, { name, slug, kind }, accessToken);
      if (generation !== this.generation) return;
      if (result.status !== 201) {
        if (await this.dropIfUnauthorized(generation, result.body)) return;
        this.error = readErrorCode(result.body);
        return;
      }
      await this.loadRooms(generation);
    });
  }

  async createServer(name: string): Promise<void> {
    await this.run(async (generation) => {
      const origin = this.pinned();
      const accessToken = this.accessToken;
      if (origin === null || accessToken === null) {
        await this.dropExpiredSession(generation);
        return;
      }
      if (this.role !== "admin") {
        this.error = "forbidden";
        return;
      }
      const trimmed = name.trim();
      if (trimmed.length < 1 || trimmed.length > 80 || hasControlCharacter(trimmed)) {
        this.error = "invalid_body";
        return;
      }
      const result = await this.api.request(origin, "POST", "/api/v1/servers", { name: trimmed }, accessToken);
      if (generation !== this.generation) return;
      if (result.status !== 201) {
        if (await this.dropIfUnauthorized(generation, result.body)) return;
        this.error = readErrorCode(result.body);
        return;
      }
      this.selectedServerId = parseServer(result.body).id;
      await this.loadServers(generation);
    });
  }

  /** ADR 0023. A manager removes a room of the selected server; a call in it is closed by the server. */
  async deleteRoom(roomId: string): Promise<void> {
    await this.run(async (generation) => {
      const origin = this.pinned();
      const accessToken = this.accessToken;
      if (origin === null || accessToken === null) {
        await this.dropExpiredSession(generation);
        return;
      }
      const server = this.servers.find((item) => item.id === this.selectedServerId);
      if (server === undefined || (server.role !== "owner" && server.role !== "moderator")) {
        this.error = "forbidden";
        return;
      }
      const result = await this.api.request(origin, "POST", `/api/v1/rooms/${roomId}/delete`, {}, accessToken);
      if (generation !== this.generation) return;
      if (result.status !== 204) {
        if (await this.dropIfUnauthorized(generation, result.body)) return;
        this.error = readErrorCode(result.body);
        return;
      }
      await this.loadRooms(generation);
    });
  }

  /** ADR 0023. Only the owner removes a server; every room in it ends. */
  async deleteServer(serverId: string): Promise<void> {
    await this.run(async (generation) => {
      const origin = this.pinned();
      const accessToken = this.accessToken;
      if (origin === null || accessToken === null) {
        await this.dropExpiredSession(generation);
        return;
      }
      const server = this.servers.find((item) => item.id === serverId);
      if (server === undefined || server.role !== "owner") {
        this.error = "forbidden";
        return;
      }
      const result = await this.api.request(origin, "POST", `/api/v1/servers/${serverId}/delete`, {}, accessToken);
      if (generation !== this.generation) return;
      if (result.status !== 204) {
        if (await this.dropIfUnauthorized(generation, result.body)) return;
        this.error = readErrorCode(result.body);
        return;
      }
      if (this.selectedServerId === serverId) this.selectedServerId = null;
      await this.loadServers(generation);
    });
  }

  /** Shows the rooms of another server. The call, if any, keeps running. */
  async selectServer(serverId: string): Promise<void> {
    if (!this.servers.some((server) => server.id === serverId)) return;
    await this.run(async (generation) => {
      this.selectedServerId = serverId;
      this.rooms = [];
      this.presence = null;
      this.presenceAsk += 1;
      this.serverPresence = null;
      this.serverPresenceAsk += 1;
      await this.loadRooms(generation);
    });
  }

  /**
   * Holds an invite from a link, the browser page, or a pasted code until the person confirms it.
   * Nothing is sent here: a link from another instance must not move the session on its own.
   */
  offerInvite(raw: string): void {
    const parsed: InviteLink | null = parseInvite(raw);
    this.error = null;
    if (parsed === null) {
      this.error = "invalid_invite";
    } else if (parsed.origin === null && this.origin === null) {
      this.error = "invalid_api_base";
    } else {
      this.inviteOffer = { origin: parsed.origin ?? this.origin ?? "", code: parsed.code };
    }
    this.publish();
  }

  declineInvite(): void {
    this.inviteOffer = null;
    this.publish();
  }

  async acceptInvite(): Promise<void> {
    const offer = this.inviteOffer;
    if (offer === null) return;
    this.inviteOffer = null;
    if (offer.origin !== this.origin) {
      await this.run(async (generation) => {
        await this.endSession();
        if (generation !== this.generation) return;
        this.origin = null;
        this.instanceName = null;
        this.bootstrapOpen = false;
        this.step = "instance";
      });
      this.pendingInvite = offer;
      await this.confirmInstance(offer.origin);
      return;
    }
    this.pendingInvite = offer;
    if (this.accessToken === null) {
      this.publish();
      return;
    }
    await this.run(async (generation) => {
      await this.redeemPendingInvite(generation);
      if (generation !== this.generation) return;
      await this.loadServers(generation);
    });
  }

  async createInvite(): Promise<void> {
    await this.run(async (generation) => {
      const origin = this.pinned();
      const accessToken = this.accessToken;
      if (origin === null || accessToken === null) {
        await this.dropExpiredSession(generation);
        return;
      }
      const server = this.servers.find((item) => item.id === this.selectedServerId);
      if (server === undefined || (server.role !== "owner" && server.role !== "moderator")) {
        this.error = "forbidden";
        return;
      }
      this.createdInvite = null;
      const result = await this.api.request(
        origin,
        "POST",
        `/api/v1/servers/${server.id}/invites`,
        { expiresInMinutes: INVITE_MINUTES, maxUses: INVITE_USES },
        accessToken,
      );
      if (generation !== this.generation) return;
      if (result.status !== 201) {
        if (await this.dropIfUnauthorized(generation, result.body)) return;
        this.error = readErrorCode(result.body);
        return;
      }
      const code = typeof result.body === "object" && result.body !== null && "code" in result.body ? result.body.code : undefined;
      if (typeof code !== "string") {
        this.error = "invalid_instance";
        return;
      }
      try {
        this.createdInvite = this.shareLink(origin, code);
      } catch {
        this.error = "invalid_instance";
      }
    });
  }

  clearCreatedInvite(): void {
    this.createdInvite = null;
    this.publish();
  }

  /**
   * Asks who is in the rooms of the selected server. It runs beside other work: no pending flag,
   * no generation bump, and a failure only hides the names.
   */
  async refreshPresence(): Promise<void> {
    const origin = this.origin;
    const accessToken = this.accessToken;
    const serverId = this.selectedServerId;
    if (origin === null || accessToken === null || serverId === null) return;
    const ask = ++this.presenceAsk;
    let next: Record<string, RoomOccupant[]> | null = null;
    try {
      const result = await this.api.request(origin, "GET", `/api/v1/servers/${serverId}/presence`, null, accessToken);
      if (result.status === 200) next = parsePresence(result.body);
    } catch {
      next = null;
    }
    if (ask !== this.presenceAsk || serverId !== this.selectedServerId || accessToken !== this.accessToken) return;
    this.presence = next;
    this.publish();
  }

  async refreshServerPresence(activity: "online" | "away"): Promise<void> {
    const origin = this.origin;
    const accessToken = this.accessToken;
    const selectedServerId = this.selectedServerId;
    if (origin === null || accessToken === null || selectedServerId === null) return;
    const ask = ++this.serverPresenceAsk;
    try {
      await Promise.all(
        this.servers.map((server) => this.api.request(origin, "POST", `/api/v1/servers/${server.id}/presence/heartbeat`, { state: activity }, accessToken)),
      );
      const result = await this.api.request(origin, "GET", `/api/v1/servers/${selectedServerId}/members`, null, accessToken);
      if (ask !== this.serverPresenceAsk || selectedServerId !== this.selectedServerId || accessToken !== this.accessToken) return;
      this.serverPresence = result.status === 200 ? parseServerPresence(result.body) : null;
    } catch {
      if (ask !== this.serverPresenceAsk) return;
      this.serverPresence = null;
    }
    this.publish();
  }

  async setPresenceMode(mode: "visible" | "invisible"): Promise<void> {
    const origin = this.origin;
    const accessToken = this.accessToken;
    const serverId = this.selectedServerId;
    if (origin === null || accessToken === null || serverId === null) return;
    const result = await this.api.request(origin, "POST", `/api/v1/servers/${serverId}/presence/mode`, { mode }, accessToken);
    if (result.status !== 204) {
      this.error = readErrorCode(result.body);
      this.publish();
      return;
    }
    await this.refreshServerPresence("online");
  }

  async setPresencePolicy(allowInvisible: boolean, managersSeeInvisible: boolean): Promise<void> {
    const origin = this.origin;
    const accessToken = this.accessToken;
    const serverId = this.selectedServerId;
    if (origin === null || accessToken === null || serverId === null) return;
    const result = await this.api.request(origin, "POST", `/api/v1/servers/${serverId}/presence/policy`, { allowInvisible, managersSeeInvisible }, accessToken);
    if (result.status !== 204) {
      this.error = readErrorCode(result.body);
      this.publish();
      return;
    }
    await this.refreshServerPresence("online");
  }

  /** ADR 0019: `image` is base64 PNG, JPEG or WebP; null removes it. Only the owner gets a 200. */
  async setServerIcon(image: string | null): Promise<boolean> {
    const serverId = this.selectedServerId;
    if (serverId === null) return false;
    const done = await this.profileCall(`/api/v1/servers/${serverId}/icon`, { image });
    if (done) await this.run((generation) => this.loadServers(generation));
    return done;
  }

  async setAccountAvatar(image: string | null): Promise<boolean> {
    const done = await this.profileCall("/api/v1/profile/avatar", { image });
    if (done) await this.refreshServerPresence("online");
    return done;
  }

  /** Nickname and avatar in the selected server. A missing key keeps the value; null goes back to the account. */
  async setServerProfile(change: { nickname?: string | null; avatar?: string | null }): Promise<boolean> {
    const serverId = this.selectedServerId;
    if (serverId === null) return false;
    const done = await this.profileCall(`/api/v1/servers/${serverId}/profile`, change);
    if (done) await this.refreshServerPresence("online");
    return done;
  }

  /** ADR 0021: one server library, or null when it could not be read. The call's server, not the browsed one. */
  async listSounds(serverId: string): Promise<SoundSummary[] | null> {
    const body = await this.soundCall("GET", `/api/v1/servers/${serverId}/sounds`, null);
    return body === null ? null : parseSoundLibrary(body);
  }

  /** `sound` is base64 of the canonical WAV; the API judges it again. */
  async uploadSound(serverId: string, name: string, sound: string): Promise<boolean> {
    return (await this.soundCall("POST", `/api/v1/servers/${serverId}/sounds`, { name, sound }, 201)) !== null;
  }

  async removeSound(serverId: string, soundId: string): Promise<boolean> {
    return (await this.soundCall("POST", `/api/v1/servers/${serverId}/sounds/${soundId}/remove`, {})) !== null;
  }

  async importSound(serverId: string, soundId: string): Promise<boolean> {
    return (await this.soundCall("POST", `/api/v1/servers/${serverId}/sounds/${soundId}/import`, {})) !== null;
  }

  async listOwnSounds(): Promise<OwnSound[] | null> {
    const body = await this.soundCall("GET", "/api/v1/sounds/mine", null);
    return body === null ? null : parseOwnSounds(body);
  }

  async renameSound(soundId: string, name: string): Promise<boolean> {
    return (await this.soundCall("POST", `/api/v1/sounds/${soundId}/rename`, { name })) !== null;
  }

  async deleteSound(soundId: string): Promise<boolean> {
    return (await this.soundCall("POST", `/api/v1/sounds/${soundId}/delete`, {})) !== null;
  }

  private async soundCall(method: "GET" | "POST", path: string, body: unknown, ok = 200): Promise<unknown> {
    const origin = this.origin;
    const accessToken = this.accessToken;
    if (origin === null || accessToken === null) return null;
    const result = await this.api.request(origin, method, path, body, accessToken);
    if (result.status !== ok) {
      this.error = readErrorCode(result.body);
      this.publish();
      return null;
    }
    return result.body ?? {};
  }

  private async profileCall(path: string, body: unknown): Promise<boolean> {
    const origin = this.origin;
    const accessToken = this.accessToken;
    if (origin === null || accessToken === null) return false;
    const result = await this.api.request(origin, "POST", path, body, accessToken);
    if (result.status !== 200) {
      this.error = readErrorCode(result.body);
      this.publish();
      return false;
    }
    return true;
  }

  async enterRoom(roomId: string, code: string): Promise<void> {
    await this.run(async (generation) => {
      const origin = this.pinned();
      const accessToken = this.accessToken;
      if (origin === null || accessToken === null) {
        await this.dropExpiredSession(generation);
        return;
      }
      const room = this.rooms.find((item) => item.id === roomId);
      const serverId = this.selectedServerId;
      if (room === undefined || serverId === null) {
        this.error = "room_not_found";
        return;
      }
      const invite = code.trim();
      if (invite.length > 256 || hasControlCharacter(invite)) {
        this.error = "invalid_body";
        return;
      }
      await this.media.disconnect();
      if (generation !== this.generation) return;
      const result = await this.api.request(origin, "POST", `/api/v1/rooms/${roomId}/join`, invite.length === 0 ? {} : { code: invite }, accessToken);
      if (generation !== this.generation) return;
      if (result.status !== 200) {
        if (await this.dropIfUnauthorized(generation, result.body)) return;
        this.error = readErrorCode(result.body);
        return;
      }
      const join = parseRoomJoin(result.body);
      try {
        await this.media.connect(join.url, join.token);
      } catch {
        if (generation !== this.generation) return;
        this.error = "connect_failed";
        return;
      }
      if (generation !== this.generation) {
        await this.media.disconnect();
        return;
      }
      this.activeRoom = { id: room.id, name: room.name, serverId };
      this.step = "meeting";
    });
  }

  async kickParticipant(roomId: string, userId: string): Promise<void> {
    await this.run(async (generation) => {
      const origin = this.pinned();
      const accessToken = this.accessToken;
      if (origin === null || accessToken === null) return;
      const result = await this.api.request(origin, "POST", `/api/v1/rooms/${roomId}/participants/${userId}/kick`, {}, accessToken);
      if (generation !== this.generation) return;
      if (result.status !== 204) {
        if (await this.dropIfUnauthorized(generation, result.body)) return;
        this.error = readErrorCode(result.body);
        return;
      }
      await this.refreshPresence();
    });
  }

  leaveRoom(): void {
    this.generation += 1;
    this.pending = false;
    this.activeRoom = null;
    this.error = null;
    if (this.accessToken !== null) this.step = "rooms";
    this.publish();
    void this.media.disconnect().catch(() => undefined);
  }

  async reloadRooms(): Promise<void> {
    await this.run(async (generation) => {
      await this.loadServers(generation);
    });
  }

  async signOut(): Promise<void> {
    this.pendingInvite = null;
    await this.run(async (generation) => {
      await this.endSession();
      if (generation !== this.generation) return;
      this.step = this.origin === null ? "instance" : "account";
    });
  }

  async changeInstance(): Promise<void> {
    this.pendingInvite = null;
    await this.run(async (generation) => {
      await this.endSession();
      if (generation !== this.generation) return;
      this.origin = null;
      this.instanceName = null;
      this.bootstrapOpen = false;
      this.step = "instance";
    });
  }

  private pinned(): string | null {
    return this.origin;
  }

  private async restore(origin: string, generation: number): Promise<boolean> {
    const result = await this.broker.refresh(origin);
    if (result === null) return false;
    if (generation !== this.generation) return true;
    if (result.status === 401) {
      // A cut from an earlier logout may still be pending on the server. Finish it before forgetting the token.
      await this.finishLogout(origin);
      return false;
    }
    if (result.status !== 200) return false;
    await this.acceptSession(origin, parseBrokeredSession(result.body), generation);
    return true;
  }

  private async acceptSession(origin: string, session: BrokeredSession, generation: number): Promise<void> {
    this.sessionEpoch += 1;
    this.accessToken = session.accessToken;
    this.userLabel = session.user.displayName;
    this.role = session.user.role;
    this.step = "rooms";
    await this.redeemPendingInvite(generation);
    if (generation !== this.generation) return;
    await this.loadServers(generation);
  }

  private async redeemPendingInvite(generation: number): Promise<void> {
    const pending = this.pendingInvite;
    const origin = this.origin;
    const accessToken = this.accessToken;
    if (pending === null || origin === null || accessToken === null) return;
    if (pending.origin !== origin) {
      this.pendingInvite = null;
      return;
    }
    this.pendingInvite = null;
    const result = await this.api.request(origin, "POST", "/api/v1/invites/accept", { code: pending.code }, accessToken);
    if (generation !== this.generation) return;
    if (result.status !== 200) {
      if (await this.dropIfUnauthorized(generation, result.body)) return;
      this.error = readErrorCode(result.body);
      return;
    }
    try {
      this.selectedServerId = parseServer(result.body).id;
    } catch {
      this.error = "invalid_instance";
    }
  }

  private async loadServers(generation: number): Promise<void> {
    const origin = this.origin;
    const accessToken = this.accessToken;
    if (origin === null || accessToken === null) return;
    const result = await this.api.request(origin, "GET", "/api/v1/servers", null, accessToken);
    if (generation !== this.generation) return;
    if (result.status !== 200) {
      if (await this.dropIfUnauthorized(generation, result.body)) return;
      this.error = readErrorCode(result.body);
      return;
    }
    this.servers = parseServerList(result.body);
    if (!this.servers.some((server) => server.id === this.selectedServerId)) {
      const live = this.servers.find((server) => server.id === this.activeRoom?.serverId);
      this.selectedServerId = live?.id ?? this.servers[0]?.id ?? null;
    }
    if (this.selectedServerId === null) {
      this.rooms = [];
      if (this.step !== "meeting") this.step = "rooms";
      return;
    }
    await this.loadRooms(generation);
  }

  private async loadRooms(generation: number): Promise<void> {
    const origin = this.origin;
    const accessToken = this.accessToken;
    const serverId = this.selectedServerId;
    if (origin === null || accessToken === null || serverId === null) return;
    const result = await this.api.request(origin, "GET", `/api/v1/servers/${serverId}/rooms`, null, accessToken);
    if (generation !== this.generation) return;
    if (result.status !== 200) {
      if (await this.dropIfUnauthorized(generation, result.body)) return;
      this.error = readErrorCode(result.body);
      return;
    }
    this.rooms = parseRoomList(result.body);
    if (this.step !== "meeting") this.step = "rooms";
  }

  private async dropIfUnauthorized(generation: number, body: unknown): Promise<boolean> {
    if (readErrorCode(body) !== "unauthorized") return false;
    await this.dropExpiredSession(generation);
    return true;
  }

  private async dropExpiredSession(generation: number): Promise<void> {
    await this.endSession();
    if (generation !== this.generation) return;
    this.error = "unauthorized";
    this.step = this.origin === null ? "instance" : "account";
  }

  private async endSession(): Promise<void> {
    await this.media.disconnect();
    const origin = this.origin;
    const signedIn = this.accessToken !== null;
    const accessToken = this.accessToken;
    if (origin !== null && accessToken !== null) {
      await Promise.allSettled(
        this.servers.map((server) => this.api.request(origin, "POST", `/api/v1/servers/${server.id}/presence/heartbeat`, { state: "offline" }, accessToken)),
      );
    }
    this.accessToken = null;
    this.userLabel = null;
    this.role = null;
    this.servers = [];
    this.selectedServerId = null;
    this.rooms = [];
    this.activeRoom = null;
    this.createdInvite = null;
    this.presence = null;
    this.presenceAsk += 1;
    this.serverPresence = null;
    this.serverPresenceAsk += 1;
    if (origin === null || !signedIn) return;
    await this.finishLogout(origin);
  }

  /**
   * S-18: the store keeps the refresh until the server answers 204. A 502 or a network failure means the
   * call cut is still pending; the logout is repeated in the background with a growing wait, with no limit.
   * A new sign-in stops the repeats, so they never log out the session that came after.
   */
  private async finishLogout(origin: string): Promise<void> {
    const epoch = this.sessionEpoch;
    if (await this.tryLogout(origin)) return;
    void (async () => {
      for (let attempt = 0; ; attempt += 1) {
        await this.wait(Math.min(1000 * 2 ** attempt, 60_000));
        if (epoch !== this.sessionEpoch) return;
        if (await this.tryLogout(origin)) return;
      }
    })();
  }

  private async tryLogout(origin: string): Promise<boolean> {
    let status: number;
    try {
      status = (await this.broker.logout(origin)).status;
    } catch {
      status = 0;
    }
    return status !== 0 && status < 500;
  }

  private async run(work: (generation: number) => Promise<void>): Promise<void> {
    const generation = ++this.generation;
    this.error = null;
    this.pending = true;
    this.publish();
    try {
      await work(generation);
    } catch (error) {
      if (generation !== this.generation) return;
      this.error = error instanceof PocInputError ? error.code : "request_failed";
    } finally {
      if (generation === this.generation) {
        this.pending = false;
        this.publish();
      }
    }
  }

  private publish(): void {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }
}
