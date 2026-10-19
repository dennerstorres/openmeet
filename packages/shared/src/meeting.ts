import { PocInputError } from "./poc.js";
import {
  canonicalInstanceUrl,
  hasControlCharacter,
  parseAccountSession,
  parseInstanceCard,
  parseRoomJoin,
  parseRoomList,
  readErrorCode,
  type AccountSession,
  type RoomSummary,
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
  canCreate: boolean;
  rooms: readonly RoomSummary[];
  activeRoomId: string | null;
  error: string | null;
  pending: boolean;
}

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
  private rooms: RoomSummary[] = [];
  private activeRoomId: string | null = null;
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
    return {
      step: this.step,
      origin: this.origin,
      instanceName: this.instanceName,
      bootstrapOpen: this.bootstrapOpen,
      userLabel: this.userLabel,
      role,
      canCreate: role === "admin" || role === "moderator",
      rooms: this.rooms.map((room) => ({ ...room })),
      activeRoomId: this.activeRoomId,
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
        this.error = "unauthorized";
        return;
      }
      if (this.role !== "admin" && this.role !== "moderator") {
        this.error = "forbidden";
        return;
      }
      if (kind !== "persistent" && kind !== "temporary") {
        this.error = "invalid_body";
        return;
      }
      const result = await this.api.request(origin, "POST", "/api/v1/rooms", { name, slug, kind }, accessToken);
      if (generation !== this.generation) return;
      if (result.status !== 201) {
        this.error = readErrorCode(result.body);
        return;
      }
      await this.loadRooms(generation);
    });
  }

  async enterRoom(roomId: string, code: string): Promise<void> {
    await this.run(async (generation) => {
      const origin = this.pinned();
      const accessToken = this.accessToken;
      if (origin === null || accessToken === null) {
        this.error = "unauthorized";
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
      this.activeRoomId = roomId;
      this.step = "meeting";
    });
  }

  leaveRoom(): void {
    this.generation += 1;
    this.pending = false;
    this.activeRoomId = null;
    this.error = null;
    if (this.accessToken !== null) this.step = "rooms";
    this.publish();
    void this.media.disconnect().catch(() => undefined);
  }

  async reloadRooms(): Promise<void> {
    await this.run(async (generation) => {
      await this.loadRooms(generation);
    });
  }

  async signOut(): Promise<void> {
    await this.run(async (generation) => {
      await this.endSession();
      if (generation !== this.generation) return;
      this.step = this.origin === null ? "instance" : "account";
    });
  }

  async changeInstance(): Promise<void> {
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
    await this.loadRooms(generation);
  }

  private async loadRooms(generation: number): Promise<void> {
    const origin = this.origin;
    const accessToken = this.accessToken;
    if (origin === null || accessToken === null) return;
    const result = await this.api.request(origin, "GET", "/api/v1/rooms", null, accessToken);
    if (generation !== this.generation) return;
    if (result.status !== 200) {
      this.error = readErrorCode(result.body);
      return;
    }
    this.rooms = parseRoomList(result.body);
    this.activeRoomId = null;
    this.step = "rooms";
  }

  private async endSession(): Promise<void> {
    await this.media.disconnect();
    const origin = this.origin;
    const refreshToken = this.refreshToken;
    this.accessToken = null;
    this.refreshToken = null;
    this.userLabel = null;
    this.role = null;
    this.rooms = [];
    this.activeRoomId = null;
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
