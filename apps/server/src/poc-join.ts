import { parseIdentity, parseRoomName, parseSignalUrl, PocInputError } from "@openmeet/shared";
import { AccessToken } from "livekit-server-sdk";
import { roomGrant } from "./rooms/grant.js";
import type { FastifyInstance } from "fastify";

export type AppEnv = Record<string, string | undefined>;

const TOKEN_TTL = "10m";

export function assertPocBind(env: AppEnv): void {
  if (env.POC_JOIN !== "1") {
    return;
  }
  if (!isLoopbackBind(env.HOST ?? "127.0.0.1")) {
    throw new Error("POC_JOIN requires a loopback HOST");
  }
}

export function isLoopbackPocRequest(ip: string | undefined, hostHeader: string | undefined): boolean {
  return isLoopbackIp(ip) && isLoopbackHostHeader(hostHeader);
}

function isLoopbackBind(host: string): boolean {
  const value = host.trim().toLowerCase();
  const bare = value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
  return bare === "127.0.0.1" || bare === "localhost" || bare === "::1";
}

function isLoopbackIp(ip: string | undefined): boolean {
  if (!ip) {
    return false;
  }
  const value = ip.trim().toLowerCase();
  if (value.startsWith("::ffff:")) {
    return isLoopbackIp(value.slice("::ffff:".length));
  }
  return value === "127.0.0.1" || value === "::1";
}

function isLoopbackHostHeader(hostHeader: string | undefined): boolean {
  if (!hostHeader) {
    return false;
  }
  const value = hostHeader.trim().toLowerCase();
  if (value.startsWith("[")) {
    const end = value.indexOf("]");
    return end > 1 && isLoopbackBind(value.slice(1, end));
  }
  const colon = value.lastIndexOf(":");
  const hostname = colon > -1 && value.indexOf(":") === colon ? value.slice(0, colon) : value;
  return isLoopbackBind(hostname);
}

export async function issuePocJoin(env: AppEnv, roomInput: string, identityInput: string): Promise<{ url: string; token: string }> {
  if (env.POC_JOIN !== "1") {
    throw new PocInputError("poc_disabled", "POC join is disabled");
  }
  const apiKey = env.LIVEKIT_API_KEY;
  const apiSecret = env.LIVEKIT_API_SECRET;
  const signalUrl = env.LIVEKIT_URL;
  if (!apiKey || !apiSecret || !signalUrl) {
    throw new PocInputError("poc_unconfigured", "POC join is missing local LiveKit settings");
  }
  const url = parseSignalUrl(signalUrl);
  const room = parseRoomName(roomInput);
  const identity = parseIdentity(identityInput);
  const tokenBuilder = new AccessToken(apiKey, apiSecret, { identity, ttl: TOKEN_TTL });
  tokenBuilder.addGrant(roomGrant(room));
  const token = await tokenBuilder.toJwt();
  return { url: url.toString(), token };
}

export function pocStatus(code: PocInputError["code"]): number {
  if (code === "poc_disabled") {
    return 404;
  }
  if (code === "poc_unconfigured") {
    return 503;
  }
  return 400;
}

export function registerPocJoin(app: FastifyInstance, env: AppEnv): void {
  if (env.POC_JOIN !== "1") {
    return;
  }
  assertPocBind(env);
  app.post("/api/v1/poc/join", async (request, reply) => {
    if (!isLoopbackPocRequest(request.ip, request.headers.host)) {
      return reply.code(404).send({ error: "poc_disabled" });
    }
    const body = request.body;
    const room = typeof body === "object" && body !== null && "room" in body && typeof body.room === "string" ? body.room : "";
    const identity = typeof body === "object" && body !== null && "identity" in body && typeof body.identity === "string" ? body.identity : "";
    try {
      const issued = await issuePocJoin(env, room, identity);
      return reply.code(200).header("cache-control", "no-store").send(issued);
    } catch (error) {
      if (error instanceof PocInputError) {
        return reply.code(pocStatus(error.code)).send({ error: error.code });
      }
      request.log.error("poc join failed");
      return reply.code(500).send({ error: "poc_failed" });
    }
  });
}
