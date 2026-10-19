import { PocInputError, parseApiBase, parseJoinResponse, type PocJoinResponse } from "./poc.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ERROR_CODE = /^[a-z_]{1,64}$/;
const ROLES = new Set(["admin", "moderator", "participant"]);

export interface InstanceCard {
  name: string;
  apiVersion: "v1";
  bootstrapOpen: boolean;
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
}

export interface RoomOccupant {
  id: string;
  label: string;
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
  return { name, apiVersion: "v1", bootstrapOpen: record.bootstrapOpen };
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
  return { id, name, role };
}

export function parseRoomJoin(value: unknown): PocJoinResponse {
  return parseJoinResponse(value);
}

export function readErrorCode(value: unknown): string {
  if (typeof value === "object" && value !== null && "error" in value) {
    const code = value.error;
    if (typeof code === "string" && ERROR_CODE.test(code)) return code;
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
    path === "/api/v1/invites/accept"
  ) {
    return path;
  }
  const join = /^\/api\/v1\/rooms\/([0-9a-f-]{36})\/join$/i.exec(path);
  if (join?.[1] !== undefined && UUID.test(join[1])) return path;
  const serverRooms = /^\/api\/v1\/servers\/([0-9a-f-]{36})\/(?:rooms|invites|presence)$/i.exec(path);
  if (serverRooms?.[1] !== undefined && UUID.test(serverRooms[1])) return path;
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

export function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function secret(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length < 1 || value.length > 4096 || /\s/.test(value)) return undefined;
  return value;
}
