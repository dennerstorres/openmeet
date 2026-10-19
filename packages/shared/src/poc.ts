export type PocErrorCode =
  | "invalid_room"
  | "invalid_identity"
  | "invalid_api_base"
  | "invalid_signal_url"
  | "invalid_join_response"
  | "invalid_instance"
  | "invalid_session"
  | "poc_disabled"
  | "poc_unconfigured";

export class PocInputError extends Error {
  readonly code: PocErrorCode;

  constructor(code: PocErrorCode, message: string) {
    super(message);
    this.name = "PocInputError";
    this.code = code;
  }
}

const NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function parseRoomName(value: string): string {
  const room = value.trim();
  if (!NAME_PATTERN.test(room)) {
    throw new PocInputError("invalid_room", "Room name must be 1-64 characters: letters, digits, _ or -");
  }
  return room;
}

export function parseIdentity(value: string): string {
  const identity = value.trim();
  if (!NAME_PATTERN.test(identity)) {
    throw new PocInputError("invalid_identity", "Identity must be 1-64 characters: letters, digits, _ or -");
  }
  return identity;
}

function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export function parseApiBase(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new PocInputError("invalid_api_base", "API base is not a URL");
  }
  if (isLoopback(url.hostname) && url.protocol === "http:") {
    return url;
  }
  if (url.protocol === "https:") {
    return url;
  }
  throw new PocInputError("invalid_api_base", "API base must be loopback HTTP or HTTPS");
}

export function parseSignalUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new PocInputError("invalid_signal_url", "Signal URL is not a URL");
  }
  if (isLoopback(url.hostname) && (url.protocol === "ws:" || url.protocol === "http:")) {
    if (url.protocol === "http:") {
      url.protocol = "ws:";
    }
    return url;
  }
  if (url.protocol === "wss:") {
    return url;
  }
  throw new PocInputError("invalid_signal_url", "Signal URL must be loopback ws or wss");
}

export interface PocJoinResponse {
  url: string;
  token: string;
}

export function parsePastedJoin(url: string, token: string): PocJoinResponse {
  return parseJoinResponse({ url: url.trim(), token: token.trim() });
}

export function parseJoinResponse(value: unknown): PocJoinResponse {
  if (typeof value !== "object" || value === null) {
    throw new PocInputError("invalid_join_response", "Join response is not an object");
  }
  if (!("url" in value) || typeof value.url !== "string" || !("token" in value) || typeof value.token !== "string") {
    throw new PocInputError("invalid_join_response", "Join response is missing url or token");
  }
  const url = parseSignalUrl(value.url).toString();
  if (value.token.split(".").length !== 3) {
    throw new PocInputError("invalid_join_response", "Join token is not a JWT");
  }
  return { url, token: value.token };
}
