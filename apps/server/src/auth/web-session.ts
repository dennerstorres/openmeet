import type { FastifyReply, FastifyRequest } from "fastify";
import type { AppEnv } from "../poc-join.js";
import { ACCESS_TOKEN_TTL_SECONDS } from "./tokens.js";
import { AuthError, type SessionBody } from "./service.js";

// ADR 0014: the web client keeps its session in two HttpOnly cookies. The .exe keeps using Bearer.
export const ACCESS_COOKIE = "om_access";
export const REFRESH_COOKIE = "om_refresh";
const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;
const ACCESS_PATH = "/api";
const REFRESH_PATH = "/api/v1/auth";
const WEB_HEADER = "x-openmeet-web";
const DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const SAFE_METHODS = new Set(["GET", "HEAD"]);

type Headers = FastifyRequest["headers"];

// The page origin is https://{API_DOMAIN}. WEB_ORIGIN replaces it only with another https origin or loopback http, for local development.
export function webOrigin(env: AppEnv): string | undefined {
  const explicit = (env.WEB_ORIGIN ?? "").trim();
  if (explicit !== "") {
    try {
      const url = new URL(explicit);
      const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost";
      if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) return undefined;
      if (url.origin !== explicit) return undefined;
      return url.origin;
    } catch {
      return undefined;
    }
  }
  const domain = (env.API_DOMAIN ?? "").trim().toLowerCase();
  return DOMAIN.test(domain) ? `https://${domain}` : undefined;
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? undefined : value;
}

export function readCookie(headers: Headers, name: string): string | undefined {
  const header = single(headers.cookie);
  if (!header) return undefined;
  let found: string | undefined;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() !== name) continue;
    // Two cookies with the same name are ambiguous; neither authenticates.
    if (found !== undefined) return undefined;
    found = part.slice(index + 1).trim();
  }
  return found !== undefined && found.length > 0 ? found : undefined;
}

export type WebMode = "web" | "native" | "rejected";

// Web requests carry X-OpenMeet-Web: 1. A request that changes state also needs Origin equal to the page origin.
// A safe method may omit Origin (browsers do on same-origin GET), but a different Origin is still rejected.
export function webMode(request: { method: string; headers: Headers }, env: AppEnv): WebMode {
  const flag = single(request.headers[WEB_HEADER]);
  if (flag === undefined) return "native";
  const expected = webOrigin(env);
  if (flag !== "1" || !expected) return "rejected";
  const origin = single(request.headers.origin);
  if (origin === undefined) return SAFE_METHODS.has(request.method) ? "web" : "rejected";
  return origin === expected ? "web" : "rejected";
}

function bearer(header: string | string[] | undefined): string | undefined {
  const value = single(header);
  if (!value?.startsWith("Bearer ")) return undefined;
  const token = value.slice("Bearer ".length).trim();
  return token.length > 0 ? token : undefined;
}

// Bearer or the cookie, never both. The cookie only counts on a web request.
export function accessToken(request: { method: string; headers: Headers }, env: AppEnv): string | undefined {
  const header = bearer(request.headers.authorization);
  const cookie = readCookie(request.headers, ACCESS_COOKIE);
  if (header !== undefined && cookie !== undefined) return undefined;
  if (header !== undefined) return header;
  if (cookie === undefined || webMode(request, env) !== "web") return undefined;
  return cookie;
}

// The token a protected route uses. A web request from another origin is 403, not 401, so the page does not loop on refresh.
export function requireAccessToken(request: { method: string; headers: Headers }, env: AppEnv): string {
  const token = accessToken(request, env);
  if (token !== undefined) return token;
  if (bearer(request.headers.authorization) === undefined) rejectForeignWeb(request, env);
  throw new AuthError("unauthorized");
}

function cookie(name: string, value: string, path: string, maxAge: number): string {
  return `${name}=${value}; Path=${path}; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;
}

export function setSessionCookies(reply: FastifyReply, session: SessionBody): Omit<SessionBody, "accessToken" | "refreshToken"> {
  reply.header("set-cookie", [
    cookie(ACCESS_COOKIE, session.accessToken, ACCESS_PATH, ACCESS_TOKEN_TTL_SECONDS),
    cookie(REFRESH_COOKIE, session.refreshToken, REFRESH_PATH, REFRESH_TTL_SECONDS),
  ]);
  return { expiresIn: session.expiresIn, user: session.user };
}

export function clearSessionCookies(reply: FastifyReply): void {
  reply.header("set-cookie", [cookie(ACCESS_COOKIE, "", ACCESS_PATH, 0), cookie(REFRESH_COOKIE, "", REFRESH_PATH, 0)]);
}

// Sends a session: cookies and a body without tokens for the web client, the body as before for the .exe.
export function sendSession(request: FastifyRequest, reply: FastifyReply, env: AppEnv, status: number, session: SessionBody): FastifyReply {
  reply.code(status).header("cache-control", "no-store");
  if (webMode(request, env) === "web") return reply.send(setSessionCookies(reply, session));
  return reply.send(session);
}

export function rejectForeignWeb(request: { method: string; headers: Headers }, env: AppEnv): void {
  if (webMode(request, env) === "rejected") throw new AuthError("origin_rejected");
}
