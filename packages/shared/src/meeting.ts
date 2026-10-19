import { PocInputError } from "./poc.js";
import { inviteHost, inviteLink, parseInvite, type InviteLink } from "./invite.js";
import {
  canonicalInstanceUrl,
  hasControlCharacter,
  parseAccountSession,
  parseInstanceCard,
  parseRoomJoin,
  parseRoomList,
  parseServer,
  parseServerList,
  readErrorCode,
  type AccountSession,
  type RoomSummary,
  type ServerSummary,
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
  error: string | null;
  pending: boolean;
}

const INVITE_MINUTES = 1440;
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

export class MeetingModel {
  private generation = 0;
  private step: ShellSnapshot["step"] = "instance";
  private origin: string | null = null;
  private instanceName: string | null = null;
  private bootstrapOpen = false;
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private userLabel: string | null = null;
  private role: string | null = null;
  private servers: ServerSummary[] = [];
  private selectedServerId: string | null = null;
  private rooms: RoomSummary[] = [];
  private activeRoom: { id: string; name: string; serverId: string } | null = null;
  private inviteOffer: { origin: string; code: string } | null = null;
  private pendingInvite: { origin: string; code: string } | null = null;
  private createdInvite: string | null = null;
  private error: string | null = null;
  private pending = false;
  private readonly listeners = new Set<(snapshot: ShellSnapshot) => void>();

  constructor(
    private readonly api: InstanceApi,
    private readonly media: MeetingMedia = idleMedia,
    private readonly vault: SessionVault = new MemorySessionVault(),
  ) {}

  snapshot(): ShellSnapshot {
    const role = this.role;
    const selected = this.servers.find((server) => server.id === this.selectedServerId);
    return {
      step: this.step,
      origin: this.origin,
      instanceName: this.instanceName,
      bootstrapOpen: this.bootstrapOpen,
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
      const path = input.mode === "bootstrap" ? "/api/v1/auth/bootstrap" : "/api/v1/auth/login";
      const payload =
        input.mode === "bootstrap"
          ? { token: input.token, username: input.username, password: input.password, displayName: input.displayName }
          : { username: input.username, password: input.password };
      const result = await this.api.request(origin, "POST", path, payload, null);
      if (generation !== this.generation) return;
      if (result.status !== 200 && result.status !== 201) {
        this.error = readErrorCode(result.body);
        return;
      }
      await this.acceptSession(origin, parseAccountSession(result.body), generation);
    });
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

  /** Shows the rooms of another server. The call, if any, keeps running. */
  async selectServer(serverId: string): Promise<void> {
    if (!this.servers.some((server) => server.id === serverId)) return;
    await this.run(async (generation) => {
      this.selectedServerId = serverId;
      this.rooms = [];
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
        this.createdInvite = inviteLink(origin, code);
      } catch {
        this.error = "invalid_instance";
      }
    });
  }

  clearCreatedInvite(): void {
    this.createdInvite = null;
    this.publish();
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
    const refreshToken = await this.vault.load(origin);
    if (refreshToken === null) return false;
    const result = await this.api.request(origin, "POST", "/api/v1/auth/refresh", { refreshToken }, null);
    if (generation !== this.generation) return true;
    if (result.status !== 200) {
      await this.vault.clear(origin);
      return false;
    }
    await this.acceptSession(origin, parseAccountSession(result.body), generation);
    return true;
  }

  private async acceptSession(origin: string, session: AccountSession, generation: number): Promise<void> {
    this.accessToken = session.accessToken;
    this.refreshToken = session.refreshToken;
    this.userLabel = session.user.displayName;
    this.role = session.user.role;
    this.step = "rooms";
    await this.vault.save(origin, session.refreshToken);
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
      this.selectedServerId = this.activeRoom?.serverId ?? this.servers[0]?.id ?? null;
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
    const refreshToken = this.refreshToken;
    this.accessToken = null;
    this.refreshToken = null;
    this.userLabel = null;
    this.role = null;
    this.servers = [];
    this.selectedServerId = null;
    this.rooms = [];
    this.activeRoom = null;
    this.createdInvite = null;
    if (origin === null || refreshToken === null) return;
    await this.vault.clear(origin);
    try {
      await this.api.request(origin, "POST", "/api/v1/auth/logout", { refreshToken }, null);
    } catch {
      // The local session is already gone.
    }
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
