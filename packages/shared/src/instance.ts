import { PocInputError, parseApiBase, parseJoinResponse, type PocJoinResponse } from "./poc.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ERROR_CODE = /^[a-z_]{1,64}$/;
const ROLES = new Set(["admin", "moderator", "participant"]);

export interface InstanceCard {
  name: string;
  apiVersion: "v1";
  bootstrapOpen: boolean;
  /** ADR 0010: the server holds both Google keys. Older servers omit it. */
  googleLogin: boolean;
}

export interface AccountUser {
  id: string;
  username: string;
  displayName: string;
  role: string;
}

export interface AccountSession {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: AccountUser;
}

export interface RoomSummary {
  id: string;
  name: string;
  slug: string;
  kind: "persistent" | "temporary";
  ended: boolean;
}

export interface ServerSummary {
  id: string;
  name: string;
  role: "owner" | "moderator" | "participant";
  /** ADR 0019: the server icon, or null. Older servers omit it. */
  iconId: string | null;
}

export interface RoomOccupant {
  id: string;
  label: string;
}

export type PlatformPresenceStatus = "online" | "away" | "offline" | "invisible";

export interface ServerPresenceMember {
  id: string;
  label: string;
  role: "owner" | "moderator" | "participant";
  status: PlatformPresenceStatus;
  activity: "online" | "away" | null;
  self: boolean;
  /** ADR 0019: server avatar, else account avatar, else null. */
  avatarId: string | null;
  /** The account name behind a server nickname; equal to label when there is none. */
  globalName: string;
}

/** ADR 0019: what the caller set for themself, to fill the profile form. */
export interface SelfProfile {
  nickname: string | null;
  avatarId: string | null;
  globalAvatarId: string | null;
}

export interface ServerPresenceView {
  allowInvisible: boolean;
  managersSeeInvisible: boolean;
  selfMode: "visible" | "invisible";
  members: ServerPresenceMember[];
  selfProfile: SelfProfile;
}

function imageId(value: unknown): string | null {
  return typeof value === "string" && UUID.test(value) ? value.toLowerCase() : null;
}

function safeLabel(value: unknown): string | undefined {
  const label = text(value);
  return label === undefined || label.length > 80 || hasControlCharacter(label) ? undefined : label;
}

export function parseServerPresence(value: unknown): ServerPresenceView {
  const record = objectRecord(value, "invalid_instance", "Server presence is not an object");
  const policy = objectRecord(record.policy, "invalid_instance", "Presence policy is not an object");
  if (typeof policy.allowInvisible !== "boolean" || typeof policy.managersSeeInvisible !== "boolean") {
    throw new PocInputError("invalid_instance", "Presence policy is incomplete");
  }
  if (record.selfMode !== "visible" && record.selfMode !== "invisible") throw new PocInputError("invalid_instance", "Presence mode is invalid");
  if (!Array.isArray(record.members)) throw new PocInputError("invalid_instance", "Server members are not an array");
  const members = record.members.map((item): ServerPresenceMember => {
    const member = objectRecord(item, "invalid_instance", "Server member is not an object");
    const id = text(member.id);
    const label = text(member.displayName);
    const role = member.role;
    const status = member.status;
    const activity = member.activity === "online" || member.activity === "away" ? member.activity : null;
    if (
      id === undefined ||
      !UUID.test(id) ||
      label === undefined ||
      label.length > 80 ||
      hasControlCharacter(label) ||
      (role !== "owner" && role !== "moderator" && role !== "participant") ||
      (status !== "online" && status !== "away" && status !== "offline" && status !== "invisible") ||
      typeof member.self !== "boolean"
    ) {
      throw new PocInputError("invalid_instance", "Server member is incomplete");
    }
    const globalName = safeLabel(member.globalName) ?? label;
    return { id, label, role, status, activity, self: member.self, avatarId: imageId(member.avatarId), globalName };
  });
  const own = typeof record.selfProfile === "object" && record.selfProfile !== null ? (record.selfProfile as Record<string, unknown>) : {};
  return {
    allowInvisible: policy.allowInvisible,
    managersSeeInvisible: policy.managersSeeInvisible,
    selfMode: record.selfMode,
    members,
    selfProfile: { nickname: safeLabel(own.nickname) ?? null, avatarId: imageId(own.avatarId), globalAvatarId: imageId(own.globalAvatarId) },
  };
}

/** Room id to the people in it. Unknown shapes are dropped; a bad name becomes "Participante". */
export function parsePresence(value: unknown): Record<string, RoomOccupant[]> {
  const record = objectRecord(value, "invalid_instance", "Presence is not an object");
  const presence: Record<string, RoomOccupant[]> = {};
  for (const [roomId, list] of Object.entries(record)) {
    if (!UUID.test(roomId) || !Array.isArray(list)) continue;
    const seen = new Set<string>();
    presence[roomId] = list.flatMap((item: unknown) => {
      if (typeof item !== "object" || item === null) return [];
      const entry = item as Record<string, unknown>;
      const id = text(entry.id);
      if (id === undefined || id.length > 128 || seen.has(id)) return [];
      seen.add(id);
      const name = text(entry.displayName);
      const label = name === undefined || name.length > 80 || hasControlCharacter(name) || UUID.test(name) ? "Participante" : name;
      return [{ id, label }];
    });
  }
  return presence;
}

export interface PreparedRequest {
  url: string;
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: string;
}

export function canonicalInstanceUrl(value: string): string {
  const url = parseApiBase(value.trim());
  if (url.username !== "" || url.password !== "") {
    throw new PocInputError("invalid_api_base", "API base must not include credentials");
  }
  if (url.pathname !== "/" || url.search !== "" || url.hash !== "") {
    throw new PocInputError("invalid_api_base", "API base must be an origin");
  }
  return url.origin;
}

export function parseInstanceCard(value: unknown): InstanceCard {
  const record = objectRecord(value, "invalid_instance", "Instance metadata is not an object");
  const name = text(record.name);
  if (name === undefined || name.length > 80 || record.apiVersion !== "v1" || typeof record.bootstrapOpen !== "boolean") {
    throw new PocInputError("invalid_instance", "Instance metadata is incomplete");
  }
  if (hasControlCharacter(name)) {
    throw new PocInputError("invalid_instance", "Instance metadata is incomplete");
  }
  return { name, apiVersion: "v1", bootstrapOpen: record.bootstrapOpen, googleLogin: record.googleLogin === true };
}

/** S-05: what the page holds of a session. The refresh stays with the session broker. */
export interface BrokeredSession {
  accessToken: string;
  expiresIn: number;
  user: AccountUser;
}

export function parseBrokeredSession(value: unknown): BrokeredSession {
  const record = objectRecord(value, "invalid_session", "Session response is not an object");
  const accessToken = secret(record.accessToken);
  const expiresIn = record.expiresIn;
  if (accessToken === undefined || typeof expiresIn !== "number" || !Number.isInteger(expiresIn) || expiresIn < 1) {
    throw new PocInputError("invalid_session", "Session response is incomplete");
  }
  return { accessToken, expiresIn, user: parseUser(record.user) };
}

export function parseAccountSession(value: unknown): AccountSession {
  const record = objectRecord(value, "invalid_session", "Session response is not an object");
  const accessToken = secret(record.accessToken);
  const refreshToken = secret(record.refreshToken);
  const expiresIn = record.expiresIn;
  if (accessToken === undefined || refreshToken === undefined || typeof expiresIn !== "number" || !Number.isInteger(expiresIn) || expiresIn < 1) {
    throw new PocInputError("invalid_session", "Session response is incomplete");
  }
  return { accessToken, refreshToken, expiresIn, user: parseUser(record.user) };
}

export function parseRoomList(value: unknown): RoomSummary[] {
  if (!Array.isArray(value)) {
    throw new PocInputError("invalid_instance", "Room list is not an array");
  }
  return value.map(parseRoom);
}

export function parseServerList(value: unknown): ServerSummary[] {
  if (!Array.isArray(value)) {
    throw new PocInputError("invalid_instance", "Server list is not an array");
  }
  return value.map(parseServer);
}

export function parseServer(value: unknown): ServerSummary {
  const record = objectRecord(value, "invalid_instance", "Server is not an object");
  const id = text(record.id);
  const name = text(record.name);
  const role = record.role;
  if (
    id === undefined ||
    !UUID.test(id) ||
    name === undefined ||
    name.length > 80 ||
    hasControlCharacter(name) ||
    (role !== "owner" && role !== "moderator" && role !== "participant")
  ) {
    throw new PocInputError("invalid_instance", "Server is incomplete");
  }
  return { id, name, role, iconId: imageId(record.iconId) };
}

const GOOGLE_AUTHORIZE = "https://accounts.google.com/o/oauth2/v2/auth";
const POLL = /^[A-Za-z0-9_-]{43}$/;

/** The instance chooses nothing about where the browser goes: only Google's own sign-in page. */
export function parseGoogleStart(value: unknown): { authUrl: string; poll: string; expiresIn: number } {
  const record = objectRecord(value, "invalid_instance", "Google start is not an object");
  const authUrl = text(record.authUrl);
  const poll = text(record.poll);
  const expiresIn = record.expiresIn;
  let url: URL | undefined;
  try {
    url = authUrl === undefined ? undefined : new URL(authUrl);
  } catch {
    url = undefined;
  }
  if (
    url === undefined ||
    url.origin + url.pathname !== GOOGLE_AUTHORIZE ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== "" ||
    poll === undefined ||
    !POLL.test(poll) ||
    typeof expiresIn !== "number" ||
    !Number.isInteger(expiresIn) ||
    expiresIn < 1 ||
    expiresIn > 3600
  ) {
    throw new PocInputError("invalid_instance", "Google start is incomplete");
  }
  return { authUrl: url.toString(), poll, expiresIn };
}

export function parseRoomJoin(value: unknown): PocJoinResponse {
  return parseJoinResponse(value);
}

export function readErrorCode(value: unknown): string {
  if (typeof value === "object" && value !== null && "error" in value) {
    const code = value.error;
    if (typeof code === "string" && ERROR_CODE.test(code)) return code;
    // The API answers an unknown route this way. The instance is older than this app, not offline.
    if ("statusCode" in value && value.statusCode === 404 && "message" in value && typeof value.message === "string" && value.message.startsWith("Route ")) {
      return "instance_outdated";
    }
  }
  return "request_failed";
}

export function prepareInstanceRequest(
  pinnedOrigin: string,
  origin: string,
  method: "GET" | "POST",
  path: string,
  body: unknown,
  accessToken: string | null,
): PreparedRequest {
  const pinned = canonicalInstanceUrl(pinnedOrigin);
  if (pinned !== canonicalInstanceUrl(origin)) {
    throw new PocInputError("invalid_api_base", "Request stays on the pinned instance");
  }
  const headers: Record<string, string> = { accept: "application/json" };
  if (accessToken !== null) {
    const token = secret(accessToken);
    if (token === undefined) throw new PocInputError("invalid_session", "Access token is empty");
    headers.authorization = `Bearer ${token}`;
  }
  const prepared: PreparedRequest = { url: `${pinned}${instancePath(path)}`, method, headers };
  if (method === "POST") {
    headers["content-type"] = "application/json";
    prepared.body = JSON.stringify(body ?? {});
  }
  return prepared;
}

function instancePath(path: string): string {
  if (
    path === "/api/v1/instance" ||
    path === "/api/v1/auth/login" ||
    path === "/api/v1/auth/bootstrap" ||
    path === "/api/v1/auth/refresh" ||
    path === "/api/v1/auth/logout" ||
    path === "/api/v1/rooms" ||
    path === "/api/v1/servers" ||
    path === "/api/v1/invites/accept" ||
    path === "/api/v1/auth/google/start" ||
    path === "/api/v1/auth/google/poll" ||
    path === "/api/v1/profile/avatar" ||
    path === "/api/v1/sounds/mine"
  ) {
    return path;
  }
  const join = /^\/api\/v1\/rooms\/([0-9a-f-]{36})\/(?:join|delete)$/i.exec(path);
  if (join?.[1] !== undefined && UUID.test(join[1])) return path;
  const kick = /^\/api\/v1\/rooms\/([0-9a-f-]{36})\/participants\/([0-9a-f-]{36})\/kick$/i.exec(path);
  if (kick?.[1] !== undefined && kick[2] !== undefined && UUID.test(kick[1]) && UUID.test(kick[2])) return path;
  const serverRooms = /^\/api\/v1\/servers\/([0-9a-f-]{36})\/(?:rooms|invites|presence|members|icon|profile|delete)$/i.exec(path);
  if (serverRooms?.[1] !== undefined && UUID.test(serverRooms[1])) return path;
  const serverPresenceAction = /^\/api\/v1\/servers\/([0-9a-f-]{36})\/presence\/(?:heartbeat|mode|policy)$/i.exec(path);
  if (serverPresenceAction?.[1] !== undefined && UUID.test(serverPresenceAction[1])) return path;
  // ADR 0021: a server library, one sound in it, and the caller's own sound.
  const library = /^\/api\/v1\/servers\/([0-9a-f-]{36})\/sounds(?:\/([0-9a-f-]{36})\/(?:import|remove))?$/i.exec(path);
  if (library?.[1] !== undefined && UUID.test(library[1]) && (library[2] === undefined || UUID.test(library[2]))) return path;
  const sound = /^\/api\/v1\/sounds\/([0-9a-f-]{36})(?:\/(?:rename|delete))?$/i.exec(path);
  if (sound?.[1] !== undefined && UUID.test(sound[1])) return path;
  const image = /^\/api\/v1\/images\/([0-9a-f-]{36})$/i.exec(path);
  if (image?.[1] !== undefined && UUID.test(image[1])) return path;
  throw new PocInputError("invalid_api_base", "Request path is not part of the instance API");
}

function parseRoom(value: unknown): RoomSummary {
  const record = objectRecord(value, "invalid_instance", "Room is not an object");
  const id = text(record.id);
  const name = text(record.name);
  const slug = text(record.slug);
  const kind = record.kind;
  if (
    id === undefined ||
    !UUID.test(id) ||
    name === undefined ||
    name.length > 80 ||
    hasControlCharacter(name) ||
    slug === undefined ||
    (kind !== "persistent" && kind !== "temporary") ||
    typeof record.ended !== "boolean"
  ) {
    throw new PocInputError("invalid_instance", "Room is incomplete");
  }
  return { id, name, slug, kind, ended: record.ended };
}

function parseUser(value: unknown): AccountUser {
  const record = objectRecord(value, "invalid_session", "Session user is not an object");
  const id = text(record.id);
  const username = text(record.username);
  const displayName = text(record.displayName);
  const role = text(record.role);
  if (
    id === undefined ||
    !UUID.test(id) ||
    username === undefined ||
    displayName === undefined ||
    displayName.length > 80 ||
    role === undefined ||
    !ROLES.has(role)
  ) {
    throw new PocInputError("invalid_session", "Session user is incomplete");
  }
  return { id, username, displayName, role };
}

function objectRecord(value: unknown, code: "invalid_instance" | "invalid_session", message: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new PocInputError(code, message);
  }
  return Object.fromEntries(Object.entries(value));
}

/** S-21: C0, DEL, C1, line and paragraph separators, and bidi controls never reach a label. */
export function isHiddenCharacter(code: number): boolean {
  return (
    code <= 0x1f ||
    (code >= 0x7f && code <= 0x9f) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0x061c ||
    code === 0x200e ||
    code === 0x200f ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069)
  );
}

export function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (isHiddenCharacter(value.charCodeAt(index))) return true;
  }
  return false;
}

/** A display, room or server name: trimmed, 1 to 80 characters, nothing hidden. Never cleaned in silence. */
export function parseLabel(value: string): string | undefined {
  // Checked before trim: a trailing line break is refused, not cut.
  if (hasControlCharacter(value)) return undefined;
  const name = value.trim();
  if (name.length < 1 || name.length > 80) return undefined;
  return name;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function secret(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length < 1 || value.length > 4096 || /\s/.test(value)) return undefined;
  return value;
}
