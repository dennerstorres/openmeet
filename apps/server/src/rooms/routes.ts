import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { AuthError, type AuthErrorCode, currentUser, type PublicUser } from "../auth/service.js";
import { readAccessToken } from "../auth/tokens.js";
import { requireAccessToken } from "../auth/web-session.js";
import type { MigrationClient } from "../db/migrate.js";
import type { AppEnv } from "../poc-join.js";
import {
  acceptInviteCode,
  acceptServerInvite,
  createAccount,
  disableAccount,
  enableAccount,
  listAccounts,
  resetAccountPassword,
  createInvite,
  createRoom,
  createServer,
  createServerInvite,
  endRoom,
  getRoom,
  getServer,
  joinRoom,
  listRooms,
  listServerRooms,
  listServers,
  listServerPresence,
  removeMember,
  kickParticipant,
  removeServerMember,
  revokeInvite,
  revokeServerInvite,
  serverPresence,
  heartbeatServerPresence,
  setServerPresenceMode,
  setServerPresencePolicy,
  RoomError,
  type RoomErrorCode,
} from "./service.js";
import type { RoomMedia } from "./media.js";
import { PlatformPresence } from "./platform-presence.js";

const AUTH_STATUS: Record<AuthErrorCode, number> = {
  auth_unconfigured: 503,
  invalid_body: 400,
  invalid_username: 400,
  invalid_display_name: 400,
  weak_password: 400,
  bootstrap_rejected: 401,
  bootstrap_closed: 404,
  invalid_credentials: 401,
  invalid_session: 401,
  unauthorized: 401,
  rate_limited: 429,
  media_disconnect_failed: 502,
  proxy_rejected: 503,
  origin_rejected: 403,
};

const ROOM_STATUS: Record<RoomErrorCode, number> = {
  invalid_body: 400,
  invalid_username: 400,
  invalid_display_name: 400,
  weak_password: 400,
  forbidden: 403,
  room_not_found: 404,
  server_not_found: 404,
  invalid_invite: 403,
  room_ended: 403,
  conflict: 409,
  room_unconfigured: 503,
  media_disconnect_failed: 502,
  presence_unavailable: 503,
  user_not_found: 404,
};

function configuredSecret(env: AppEnv): string | undefined {
  const secret = env.AUTH_SECRET ?? "";
  return secret.length >= 32 ? secret : undefined;
}

function textField(body: unknown, key: string): string | undefined {
  if (typeof body !== "object" || body === null || Array.isArray(body) || !(key in body)) return undefined;
  const value = (body as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

function requiredText(body: unknown, key: string): string {
  const value = textField(body, key);
  if (value === undefined) throw new RoomError("invalid_body");
  return value;
}

function numberField(body: unknown, key: string, fallback: number | undefined): number {
  if (typeof body !== "object" || body === null || Array.isArray(body) || !(key in body)) {
    if (fallback === undefined) throw new RoomError("invalid_body");
    return fallback;
  }
  const value = (body as Record<string, unknown>)[key];
  if (typeof value !== "number") throw new RoomError("invalid_body");
  return value;
}

function booleanField(body: unknown, key: string): boolean {
  if (typeof body !== "object" || body === null || Array.isArray(body) || !(key in body)) throw new RoomError("invalid_body");
  const value = (body as Record<string, unknown>)[key];
  if (typeof value !== "boolean") throw new RoomError("invalid_body");
  return value;
}

function param(request: FastifyRequest, key: string): string {
  if (typeof request.params !== "object" || request.params === null) return "";
  const value = (request.params as Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
}

export function registerRooms(app: FastifyInstance, env: AppEnv, db: MigrationClient | undefined, media: RoomMedia | undefined): void {
  const platformPresence = new PlatformPresence();
  async function caller(request: FastifyRequest): Promise<PublicUser> {
    const secret = configuredSecret(env);
    if (!db || !secret) throw new AuthError("auth_unconfigured");
    return currentUser(db, secret, requireAccessToken(request, env));
  }

  app.post("/api/v1/admin/users", async (request, reply) => {
    try {
      const actor = await caller(request);
      if (!db) throw new AuthError("auth_unconfigured");
      const user = await createAccount(db, actor, {
        username: requiredText(request.body, "username"),
        password: requiredText(request.body, "password"),
        displayName: requiredText(request.body, "displayName"),
        role: requiredText(request.body, "role"),
      });
      return reply.code(201).header("cache-control", "no-store").send(user);
    } catch (error) {
      return sendError(request, reply, error);
    }
  });

  app.get("/api/v1/admin/users", async (request, reply) => {
    try {
      const actor = await caller(request);
      if (!db) throw new AuthError("auth_unconfigured");
      return reply
        .code(200)
        .header("cache-control", "no-store")
        .send(await listAccounts(db, actor));
    } catch (error) {
      return sendError(request, reply, error);
    }
  });

  app.post("/api/v1/admin/users/:id/password", async (request, reply) => {
    try {
      const actor = await caller(request);
      if (!db) throw new AuthError("auth_unconfigured");
      await resetAccountPassword(db, actor, param(request, "id"), requiredText(request.body, "password"));
      return reply.code(204).header("cache-control", "no-store").send();
    } catch (error) {
      return sendError(request, reply, error);
    }
  });

  app.post("/api/v1/admin/users/:id/disable", async (request, reply) => {
    try {
      const actor = await caller(request);
      if (!db) throw new AuthError("auth_unconfigured");
      await disableAccount(db, actor, param(request, "id"), media);
      return reply.code(204).header("cache-control", "no-store").send();
    } catch (error) {
      return sendError(request, reply, error);
    }
  });

  app.post("/api/v1/admin/users/:id/enable", async (request, reply) => {
    try {
      const actor = await caller(request);
      if (!db) throw new AuthError("auth_unconfigured");
      await enableAccount(db, actor, param(request, "id"));
      return reply.code(204).header("cache-control", "no-store").send();
    } catch (error) {
      return sendError(request, reply, error);
    }
  });

  app.post("/api/v1/rooms", async (request, reply) => {
    try {
      const actor = await caller(request);
      if (!db) throw new AuthError("auth_unconfigured");
      const room = await createRoom(db, actor, {
        serverId: textField(request.body, "serverId"),
        name: requiredText(request.body, "name"),
        slug: requiredText(request.body, "slug"),
        kind: requiredText(request.body, "kind"),
      });
      return reply.code(201).header("cache-control", "no-store").send(room);
    } catch (error) {
      return sendError(request, reply, error);
    }
  });

  app.post("/api/v1/servers", async (request, reply) => {
    try {
      const actor = await caller(request);
      if (!db) throw new AuthError("auth_unconfigured");
      const server = await createServer(db, actor, { name: requiredText(request.body, "name") });
      return reply.code(201).header("cache-control", "no-store").send(server);
    } catch (error) {
      return sendError(request, reply, error);
    }
  });

  app.get("/api/v1/servers", async (request, reply) => {
    try {
      const actor = await caller(request);
      if (!db) throw new AuthError("auth_unconfigured");
      return reply
        .code(200)
        .header("cache-control", "no-store")
        .send(await listServers(db, actor));
    } catch (error) {
      return sendError(request, reply, error);
    }
  });

  app.get("/api/v1/servers/:id", async (request, reply) => {
    try {
      const actor = await caller(request);
      if (!db) throw new AuthError("auth_unconfigured");
      return reply
        .code(200)
        .header("cache-control", "no-store")
        .send(await getServer(db, actor, param(request, "id")));
    } catch (error) {
      return sendError(request, reply, error);
    }
  });

  app.get("/api/v1/servers/:id/rooms", async (request, reply) => {
    try {
      const actor = await caller(request);
      if (!db) throw new AuthError("auth_unconfigured");
      return reply
        .code(200)
        .header("cache-control", "no-store")
        .send(await listServerRooms(db, actor, param(request, "id")));
    } catch (error) {
      return sendError(request, reply, error);
    }
  });

  app.post("/api/v1/servers/:id/rooms", async (request, reply) => {
    try {
      const actor = await caller(request);
      if (!db) throw new AuthError("auth_unconfigured");
      const room = await createRoom(db, actor, {
        serverId: param(request, "id"),
        name: requiredText(request.body, "name"),
        slug: requiredText(request.body, "slug"),
        kind: requiredText(request.body, "kind"),
      });
      return reply.code(201).header("cache-control", "no-store").send(room);
    } catch (error) {
      return sendError(request, reply, error);
    }
  });

  app.get("/api/v1/servers/:id/presence", async (request, reply) => {
    try {
      const actor = await caller(request);
      if (!db) throw new AuthError("auth_unconfigured");
      return reply
        .code(200)
        .header("cache-control", "no-store")
        .send(await serverPresence(db, actor, param(request, "id"), media));
    } catch (error) {
      return sendError(request, reply, error);
    }
  });

  app.get("/api/v1/servers/:id/members", async (request, reply) => {
    try {
      const actor = await caller(request);
      if (!db) throw new AuthError("auth_unconfigured");
      return reply
        .code(200)
        .header("cache-control", "no-store")
        .send(await listServerPresence(db, actor, param(request, "id"), platformPresence));
    } catch (error) {
      return sendError(request, reply, error);
    }
  });

  app.post("/api/v1/servers/:id/presence/heartbeat", async (request, reply) => {
    try {
      const actor = await caller(request);
      if (!db) throw new AuthError("auth_unconfigured");
      await heartbeatServerPresence(db, actor, param(request, "id"), requiredText(request.body, "state"), platformPresence);
      return reply.code(204).header("cache-control", "no-store").send();
    } catch (error) {
      return sendError(request, reply, error);
    }
  });

  app.post("/api/v1/servers/:id/presence/mode", async (request, reply) => {
    try {
      const actor = await caller(request);
      if (!db) throw new AuthError("auth_unconfigured");
      await setServerPresenceMode(db, actor, param(request, "id"), requiredText(request.body, "mode"));
      return reply.code(204).header("cache-control", "no-store").send();
    } catch (error) {
      return sendError(request, reply, error);
    }
  });

  app.post("/api/v1/servers/:id/presence/policy", async (request, reply) => {
    try {
      const actor = await caller(request);
      if (!db) throw new AuthError("auth_unconfigured");
      await setServerPresencePolicy(db, actor, param(request, "id"), {
        allowInvisible: booleanField(request.body, "allowInvisible"),
        managersSeeInvisible: booleanField(request.body, "managersSeeInvisible"),
      });
      return reply.code(204).header("cache-control", "no-store").send();
    } catch (error) {
      return sendError(request, reply, error);
    }
  });

  app.post("/api/v1/servers/:id/invites", async (request, reply) => {
    try {
      const actor = await caller(request);
      if (!db) throw new AuthError("auth_unconfigured");
      const invite = await createServerInvite(db, actor, param(request, "id"), {
        expiresInMinutes: numberField(request.body, "expiresInMinutes", undefined),
        maxUses: numberField(request.body, "maxUses", 1),
      });
      return reply.code(201).header("cache-control", "no-store").send(invite);
    } catch (error) {
      return sendError(request, reply, error);
    }
  });

  app.delete("/api/v1/servers/:id/invites/:inviteId", async (request, reply) => {
    try {
      const actor = await caller(request);
      if (!db) throw new AuthError("auth_unconfigured");
      await revokeServerInvite(db, actor, param(request, "id"), param(request, "inviteId"));
      return reply.code(204).header("cache-control", "no-store").send();
    } catch (error) {
      return sendError(request, reply, error);
    }
  });

  app.post("/api/v1/servers/:id/join", async (request, reply) => {
    try {
      const actor = await caller(request);
      if (!db) throw new AuthError("auth_unconfigured");
      const joined = await acceptServerInvite(db, actor, param(request, "id"), requiredText(request.body, "code"));
      return reply.code(200).header("cache-control", "no-store").send(joined);
    } catch (error) {
      return sendError(request, reply, error);
    }
  });

  app.post("/api/v1/invites/accept", async (request, reply) => {
    try {
      const actor = await caller(request);
      if (!db) throw new AuthError("auth_unconfigured");
      const joined = await acceptInviteCode(db, actor, requiredText(request.body, "code"));
      return reply.code(200).header("cache-control", "no-store").send(joined);
    } catch (error) {
      return sendError(request, reply, error);
    }
  });

  app.delete("/api/v1/servers/:id/members/:userId", async (request, reply) => {
    try {
      const actor = await caller(request);
      if (!db) throw new AuthError("auth_unconfigured");
      await removeServerMember(db, actor, param(request, "id"), param(request, "userId"), media);
      return reply.code(204).header("cache-control", "no-store").send();
    } catch (error) {
      return sendError(request, reply, error);
    }
  });

  app.get("/api/v1/rooms", async (request, reply) => {
    try {
      const actor = await caller(request);
      if (!db) throw new AuthError("auth_unconfigured");
      return reply
        .code(200)
        .header("cache-control", "no-store")
        .send(await listRooms(db, actor));
    } catch (error) {
      return sendError(request, reply, error);
    }
  });

  app.get("/api/v1/rooms/:id", async (request, reply) => {
    try {
      const actor = await caller(request);
      if (!db) throw new AuthError("auth_unconfigured");
      return reply
        .code(200)
        .header("cache-control", "no-store")
        .send(await getRoom(db, actor, param(request, "id")));
    } catch (error) {
      return sendError(request, reply, error);
    }
  });

  app.patch("/api/v1/rooms/:id", async (request, reply) => {
    try {
      const actor = await caller(request);
      if (!db) throw new AuthError("auth_unconfigured");
      if (typeof request.body !== "object" || request.body === null || !("ended" in request.body) || request.body.ended !== true) {
        throw new RoomError("invalid_body");
      }
      await endRoom(db, actor, param(request, "id"), media);
      return reply.code(204).header("cache-control", "no-store").send();
    } catch (error) {
      return sendError(request, reply, error);
    }
  });

  app.post("/api/v1/rooms/:id/participants/:userId/kick", async (request, reply) => {
    try {
      const actor = await caller(request);
      if (!db) throw new AuthError("auth_unconfigured");
      await kickParticipant(db, actor, param(request, "id"), param(request, "userId"), media);
      return reply.code(204).header("cache-control", "no-store").send();
    } catch (error) {
      return sendError(request, reply, error);
    }
  });

  app.delete("/api/v1/rooms/:id/members/:userId", async (request, reply) => {
    try {
      const actor = await caller(request);
      if (!db) throw new AuthError("auth_unconfigured");
      await removeMember(db, actor, param(request, "id"), param(request, "userId"), media);
      return reply.code(204).header("cache-control", "no-store").send();
    } catch (error) {
      return sendError(request, reply, error);
    }
  });

  app.post("/api/v1/rooms/:id/invites", async (request, reply) => {
    try {
      const actor = await caller(request);
      if (!db) throw new AuthError("auth_unconfigured");
      const invite = await createInvite(db, actor, param(request, "id"), {
        expiresInMinutes: numberField(request.body, "expiresInMinutes", undefined),
        maxUses: numberField(request.body, "maxUses", 1),
      });
      return reply.code(201).header("cache-control", "no-store").send(invite);
    } catch (error) {
      return sendError(request, reply, error);
    }
  });

  app.delete("/api/v1/rooms/:id/invites/:inviteId", async (request, reply) => {
    try {
      const actor = await caller(request);
      if (!db) throw new AuthError("auth_unconfigured");
      await revokeInvite(db, actor, param(request, "id"), param(request, "inviteId"));
      return reply.code(204).header("cache-control", "no-store").send();
    } catch (error) {
      return sendError(request, reply, error);
    }
  });

  app.post("/api/v1/rooms/:id/join", async (request, reply) => {
    try {
      const actor = await caller(request);
      if (!db) throw new AuthError("auth_unconfigured");
      const code = textField(request.body, "code");
      const secret = configuredSecret(env);
      const sessionId = secret ? readAccessToken(secret, requireAccessToken(request, env))?.sessionId : undefined;
      const joined = await joinRoom(db, env, actor, param(request, "id"), code, sessionId);
      return reply.code(200).header("cache-control", "no-store").send(joined);
    } catch (error) {
      return sendError(request, reply, error);
    }
  });
}

function sendError(request: FastifyRequest, reply: FastifyReply, error: unknown): unknown {
  if (error instanceof AuthError) return reply.code(AUTH_STATUS[error.code]).send({ error: error.code });
  if (error instanceof RoomError) return reply.code(ROOM_STATUS[error.code]).send({ error: error.code });
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "error";
  request.log.error({ code }, "room request failed");
  return reply.code(500).send({ error: "room_failed" });
}
