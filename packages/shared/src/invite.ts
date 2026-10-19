import { canonicalInstanceUrl } from "./instance.js";

// ADR 0012. The link names the instance and carries the invite code. Nothing else: no session, no server, no room.

const CODE = /^[A-Za-z0-9_-]{43}$/;
const HOST = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?::[0-9]{1,5})?$|^\[::1\](?::[0-9]{1,5})?$/;
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

export interface InviteLink {
  /** Canonical instance origin, or null when only the code was pasted. */
  origin: string | null;
  code: string;
}

export function isInviteCode(value: string): boolean {
  return CODE.test(value);
}

/** The host part of the link: the origin without the scheme. Plain HTTP only for this computer. */
export function inviteHost(origin: string): string {
  const url = new URL(canonicalInstanceUrl(origin));
  return url.host;
}

export function inviteLink(origin: string, code: string): string {
  if (!isInviteCode(code)) throw new Error("invalid invite code");
  return `openmeet://convite?host=${encodeURIComponent(inviteHost(origin))}&code=${code}`;
}

export function hostOrigin(host: string): string {
  const lower = host.toLowerCase();
  if (!HOST.test(lower)) throw new Error("invalid host");
  const name = lower.startsWith("[") ? lower.slice(0, lower.indexOf("]") + 1) : lower.split(":")[0];
  const scheme = name !== undefined && LOOPBACK.has(name) ? "http" : "https";
  return canonicalInstanceUrl(`${scheme}://${lower}`);
}

/**
 * Accepts the app link, the browser page of the same invite, or the bare code.
 * Returns null for anything else. Never throws on user input.
 */
export function parseInvite(raw: string): InviteLink | null {
  const text = raw.trim();
  if (text.length === 0 || text.length > 512) return null;
  if (isInviteCode(text)) return { origin: null, code: text };
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.username !== "" || url.password !== "" || url.hash !== "") return null;
  try {
    if (url.protocol === "openmeet:") {
      // `openmeet://convite?...` parses with "convite" as the host.
      if (url.hostname !== "convite" || (url.pathname !== "" && url.pathname !== "/")) return null;
      const keys = [...url.searchParams.keys()];
      if (keys.length !== 2 || !keys.includes("host") || !keys.includes("code")) return null;
      const code = url.searchParams.get("code") ?? "";
      const host = url.searchParams.get("host") ?? "";
      if (!isInviteCode(code)) return null;
      return { origin: hostOrigin(host), code };
    }
    if (url.protocol === "https:" || url.protocol === "http:") {
      const match = /^\/convite\/([A-Za-z0-9_-]{43})$/.exec(url.pathname);
      if (!match?.[1] || url.search !== "") return null;
      return { origin: canonicalInstanceUrl(url.origin), code: match[1] };
    }
  } catch {
    return null;
  }
  return null;
}
