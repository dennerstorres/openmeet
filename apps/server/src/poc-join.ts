import { parseIdentity, parseRoomName, parseSignalUrl, PocInputError } from "@openmeet/shared";
import { AccessToken } from "livekit-server-sdk";
import type { FastifyInstance } from "fastify";

export type AppEnv = Record<string, string | undefined>;

const TOKEN_TTL = "10m";

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
  tokenBuilder.addGrant({
    roomJoin: true,
    room,
    canPublish: true,
    canSubscribe: true,
    canPublishData: false,
  });
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
  app.post("/api/v1/poc/join", async (request, reply) => {
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
