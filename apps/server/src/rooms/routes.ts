import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { IMAGE_MAX_BYTES, SOUND_MAX_BYTES } from "@openmeet/shared";
import { createAttemptGate } from "../auth/limit.js";
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
  deleteRoom,
  deleteServer,
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
  readImage,
  setAccountAvatar,
  setServerIcon,
  setServerProfile,
  RoomError,
  type RoomErrorCode,
} from "./service.js";
import type { RoomMedia } from "./media.js";
import { PlatformPresence } from "./platform-presence.js";
import { ChatEvents, type ChatEventName } from "./events.js";
import {
  attachmentMaxBytes,
  contentDisposition,
  createUploadBudget,
  parseAttachmentIds,
  purgeOrphanAttachments,
  readAttachment,
  storeAttachment,
} from "./attachments.js";
import {
  deleteMessage,
  editMessage,
  listMessages,
  listPinned,
  pinMessage,
  publicMessage,
  reactMessage,
  searchMessages,
  sendMessage,
  typingRoom,
  type MessageView,
} from "./messages.js";
import { deleteSound, importSound, listLibrary, listOwnSounds, readSound, removeFromLibrary, renameSound, uploadSound } from "./sounds.js";

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
  invalid_image: 400,
  image_not_found: 404,
  invalid_sound: 400,
  sound_not_found: 404,
  text_room: 409,
  voice_room: 409,
  message_not_found: 404,
  invalid_message: 400,
  invalid_attachment: 400,
  attachment_too_large: 413,
  attachment_not_found: 404,
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

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const BASE64_MAX = Math.ceil(IMAGE_MAX_BYTES / 3) * 4;

/** ADR 0019: absent keeps, `null` removes, a base64 string replaces. The bytes are judged later by sniffImage. */
function imageField(body: unknown, key: string): Uint8Array | null | undefined {
  if (typeof body !== "object" || body === null || Array.isArray(body) || !(key in body)) return undefined;
  const value = (body as Record<string, unknown>)[key];
  if (value === null) return null;
  if (typeof value !== "string" || value.length === 0 || value.length > BASE64_MAX || value.length % 4 !== 0 || !BASE64.test(value)) {
    throw new RoomError("invalid_image");
  }
  return new Uint8Array(Buffer.from(value, "base64"));
}

function bodyField(body: unknown, key: string): unknown {
  return typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>)[key] : undefined;
}

function nullableText(body: unknown, key: string): string | null | undefined {
  if (typeof body !== "object" || body === null || Array.isArray(body) || !(key in body)) return undefined;
  const value = (body as Record<string, unknown>)[key];
  if (value === null || typeof value === "string") return value;
  throw new RoomError("invalid_body");
}

function queryText(request: FastifyRequest, key: string): string | undefined {
  if (typeof request.query !== "object" || request.query === null) return undefined;
  const value = (request.query as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

function param(request: FastifyRequest, key: string): string {
  if (typeof request.params !== "object" || request.params === null) return "";
  const value = (request.params as Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
}

export function registerRooms(app: FastifyInstance, env: AppEnv, db: MigrationClient | undefined, media: RoomMedia | undefined): void {
  const platformPresence = new PlatformPresence();
  const uploads = createAttemptGate(10, 60_000);
  function allowUpload(actor: PublicUser): void {
    if (!uploads.allow(actor.id, Date.now())) throw new AuthError("rate_limited");
  }
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
        channel: textField(request.body, "channel"),
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

  app.post("/api/v1/servers/:id/delete", async (request, reply) => {
    try {
      const actor = await caller(request);
      if (!db) throw new AuthError("auth_unconfigured");
      await deleteServer(db, actor, param(request, "id"), media);
      return reply.code(204).header("cache-control", "no-store").send();
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
        channel: textField(request.body, "channel"),
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

  app.post("/api/v1/profile/avatar", async (request, reply) => {
    try {
      const actor = await caller(request);
      if (!db) throw new AuthError("auth_unconfigured");
      const image = imageField(request.body, "image");
      if (image === undefined) throw new RoomError("invalid_body");
      allowUpload(actor);
      return reply
        .code(200)
        .header("cache-control", "no-store")
        .send(await setAccountAvatar(db, actor, image));
    } catch (error) {
      return sendError(request, reply, error);
    }
  });

  app.post("/api/v1/servers/:id/icon", async (request, reply) => {
    try {
      const actor = await caller(request);
      if (!db) throw new AuthError("auth_unconfigured");
      const image = imageField(request.body, "image");
      if (image === undefined) throw new RoomError("invalid_body");
      allowUpload(actor);
      return reply
        .code(200)
        .header("cache-control", "no-store")
        .send(await setServerIcon(db, actor, param(request, "id"), image));
    } catch (error) {
      return sendError(request, reply, error);
    }
  });

  app.post("/api/v1/servers/:id/profile", async (request, reply) => {
    try {
      const actor = await caller(request);
      if (!db) throw new AuthError("auth_unconfigured");
      const nickname = nullableText(request.body, "nickname");
      const avatar = imageField(request.body, "avatar");
      if (nickname === undefined && avatar === undefined) throw new RoomError("invalid_body");
      allowUpload(actor);
      return reply
        .code(200)
        .header("cache-control", "no-store")
        .send(await setServerProfile(db, actor, param(request, "id"), { nickname, avatar }));
    } catch (error) {
      return sendError(request, reply, error);
    }
  });

  // The id changes with every upload, so the bytes behind one id never change.
  // ADR 0021: server sound libraries. Uploads share the image gate's idea with their own budget.
  const soundUploads = createAttemptGate(20, 10 * 60_000);
  const SOUND_BASE64_MAX = Math.ceil(SOUND_MAX_BYTES / 3) * 4;
  const soundBody = { bodyLimit: SOUND_BASE64_MAX + 4096 };

  function soundField(body: unknown): Uint8Array {
    const value = typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>).sound : undefined;
    if (typeof value !== "string" || value.length === 0 || value.length > SOUND_BASE64_MAX || value.length % 4 !== 0 || !BASE64.test(value)) {
      throw new RoomError("invalid_sound");
    }
    return new Uint8Array(Buffer.from(value, "base64"));
  }

  function nameField(body: unknown): unknown {
    return typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>).name : undefined;
  }

  app.get("/api/v1/servers/:id/sounds", async (request, reply) => {
    try {
      const actor = await caller(request);
      if (!db) throw new AuthError("auth_unconfigured");
      return reply
        .code(200)
        .header("cache-control", "no-store")
        .send(await listLibrary(db, actor, param(request, "id")));
    } catch (error) {
      return sendError(request, reply, error);
    }
  });

  app.post("/api/v1/servers/:id/sounds", soundBody, async (request, reply) => {
    try {
      const actor = await caller(request);
      if (!db) throw new AuthError("auth_unconfigured");
      const bytes = soundField(request.body);
      if (!soundUploads.allow(actor.id, Date.now())) throw new AuthError("rate_limited");
      return reply
        .code(201)
        .header("cache-control", "no-store")
        .send(await uploadSound(db, actor, param(request, "id"), { name: nameField(request.body), bytes }));
    } catch (error) {
      return sendError(request, reply, error);
    }
  });

  app.post("/api/v1/servers/:id/sounds/:sound/import", async (request, reply) => {
    try {
      const actor = await caller(request);
      if (!db) throw new AuthError("auth_unconfigured");
      return reply
        .code(200)
        .header("cache-control", "no-store")
        .send(await importSound(db, actor, param(request, "id"), param(request, "sound")));
    } catch (error) {
      return sendError(request, reply, error);
    }
  });

  app.post("/api/v1/servers/:id/sounds/:sound/remove", async (request, reply) => {
    try {
      const actor = await caller(request);
      if (!db) throw new AuthError("auth_unconfigured");
      return reply
        .code(200)
        .header("cache-control", "no-store")
        .send(await removeFromLibrary(db, actor, param(request, "id"), param(request, "sound")));
    } catch (error) {
      return sendError(request, reply, error);
    }
  });

  app.get("/api/v1/sounds/mine", async (request, reply) => {
    try {
      const actor = await caller(request);
      if (!db) throw new AuthError("auth_unconfigured");
      return reply
        .code(200)
        .header("cache-control", "no-store")
        .send(await listOwnSounds(db, actor));
    } catch (error) {
      return sendError(request, reply, error);
    }
  });

  // A sound id never changes its bytes: renaming keeps them, a new upload gets a new id.
  app.get("/api/v1/sounds/:id", async (request, reply) => {
    try {
      const actor = await caller(request);
      if (!db) throw new AuthError("auth_unconfigured");
      const bytes = await readSound(db, actor, param(request, "id"));
      return reply
        .code(200)
        .header("content-type", "audio/wav")
        .header("x-content-type-options", "nosniff")
        .header("content-security-policy", "default-src 'none'; sandbox")
        .header("cache-control", "private, max-age=31536000, immutable")
        .send(Buffer.from(bytes));
    } catch (error) {
      return sendError(request, reply, error);
    }
  });

  app.post("/api/v1/sounds/:id/rename", async (request, reply) => {
    try {
      const actor = await caller(request);
      if (!db) throw new AuthError("auth_unconfigured");
      return reply
        .code(200)
        .header("cache-control", "no-store")
        .send(await renameSound(db, actor, param(request, "id"), nameField(request.body)));
    } catch (error) {
      return sendError(request, reply, error);
    }
  });

  app.post("/api/v1/sounds/:id/delete", async (request, reply) => {
    try {
      const actor = await caller(request);
      if (!db) throw new AuthError("auth_unconfigured");
      return reply
        .code(200)
        .header("cache-control", "no-store")
        .send(await deleteSound(db, actor, param(request, "id")));
    } catch (error) {
      return sendError(request, reply, error);
    }
  });

  app.get("/api/v1/images/:id", async (request, reply) => {
    try {
      const actor = await caller(request);
      if (!db) throw new AuthError("auth_unconfigured");
      const image = await readImage(db, actor, param(request, "id"));
      return reply
        .code(200)
        .header("content-type", image.contentType)
        .header("x-content-type-options", "nosniff")
        .header("content-security-policy", "default-src 'none'; sandbox")
        .header("cache-control", "private, max-age=31536000, immutable")
        .send(Buffer.from(image.bytes));
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

  app.post("/api/v1/rooms/:id/delete", async (request, reply) => {
    try {
      const actor = await caller(request);
      if (!db) throw new AuthError("auth_unconfigured");
      await deleteRoom(db, actor, param(request, "id"), media);
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

  // ADR 0024: text room messages. The body only travels in POST bodies, never in a URL that reaches the logs.
  const sending = createAttemptGate(10, 10_000);
  const searching = createAttemptGate(10, 10_000);
  const typing = createAttemptGate(1, 2_000);
  const reacting = createAttemptGate(20, 10_000);
  const events = db ? new ChatEvents(db) : undefined;
  // preClose: open streams would otherwise hold the shutdown until each client hangs up.
  app.addHook("preClose", async () => events?.closeAll());

  // A failed fan-out never fails the request: the clients catch up with ?after= on the next reconnect.
  async function publishMessage(request: FastifyRequest, name: ChatEventName, message: MessageView): Promise<void> {
    if (!events) return;
    try {
      events.publish(await events.roomAudience(message.roomId), name, publicMessage(message));
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "error";
      request.log.error({ code }, "chat event failed");
    }
  }

  app.get("/api/v1/events", async (request, reply) => {
    try {
      const actor = await caller(request);
      const secret = configuredSecret(env);
      const sessionId = secret ? readAccessToken(secret, requireAccessToken(request, env))?.sessionId : undefined;
      if (!events || !sessionId) throw new AuthError("unauthorized");
      if (events.full(actor.id)) throw new AuthError("rate_limited");
      const last = request.headers["last-event-id"];
      reply.hijack();
      const raw = reply.raw;
      raw.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "x-accel-buffering": "no",
        connection: "keep-alive",
      });
      const close = events.open(
        actor.id,
        sessionId,
        { write: (chunk) => void raw.write(chunk), end: () => raw.end() },
        typeof last === "string" ? last : undefined,
      );
      request.raw.on("close", () => close?.());
      return reply;
    } catch (error) {
      return sendError(request, reply, error);
    }
  });

  app.post("/api/v1/rooms/:id/typing", async (request, reply) => {
    try {
      const actor = await caller(request);
      if (!db) throw new AuthError("auth_unconfigured");
      const room = await typingRoom(db, actor, param(request, "id"));
      if (events && typing.allow(`${actor.id}:${room}`, Date.now())) {
        const audience = (await events.roomAudience(room)).filter((id) => id !== actor.id);
        events.signal(audience, "typing", { roomId: room, userId: actor.id });
      }
      return reply.code(204).header("cache-control", "no-store").send();
    } catch (error) {
      return sendError(request, reply, error);
    }
  });

  app.get("/api/v1/rooms/:id/messages", async (request, reply) => {
    try {
      const actor = await caller(request);
      if (!db) throw new AuthError("auth_unconfigured");
      const page = await listMessages(db, actor, param(request, "id"), {
        before: queryText(request, "before"),
        after: queryText(request, "after"),
        around: queryText(request, "around"),
      });
      return reply.code(200).header("cache-control", "no-store").send(page);
    } catch (error) {
      return sendError(request, reply, error);
    }
  });

  app.post("/api/v1/rooms/:id/messages", async (request, reply) => {
    try {
      const actor = await caller(request);
      if (!db) throw new AuthError("auth_unconfigured");
      if (!sending.allow(actor.id, Date.now())) throw new AuthError("rate_limited");
      const message = await sendMessage(db, actor, param(request, "id"), {
        body: bodyField(request.body, "body"),
        replyToId: textField(request.body, "replyToId"),
        attachmentIds: parseAttachmentIds(bodyField(request.body, "attachmentIds")),
      });
      await publishMessage(request, "message.created", message);
      return reply.code(201).header("cache-control", "no-store").send(message);
    } catch (error) {
      return sendError(request, reply, error);
    }
  });

  // ADR 0024: a file goes up before its message, as base64 in JSON like images and sounds, so the .exe
  // sends it through instance_call. The name only travels in the body; the log sees the room id.
  const attachmentLimit = attachmentMaxBytes(env);
  const ATTACHMENT_BASE64_MAX = Math.ceil(attachmentLimit / 3) * 4;
  const uploadBudget = createUploadBudget();
  const attachmentBody = { bodyLimit: ATTACHMENT_BASE64_MAX + 4096 };

  app.post("/api/v1/rooms/:id/attachments", attachmentBody, async (request, reply) => {
    try {
      const actor = await caller(request);
      if (!db) throw new AuthError("auth_unconfigured");
      await typingRoom(db, actor, param(request, "id"));
      const data = bodyField(request.body, "data");
      if (typeof data !== "string" || data.length === 0 || data.length % 4 !== 0) throw new RoomError("invalid_attachment");
      if (data.length > ATTACHMENT_BASE64_MAX) throw new RoomError("attachment_too_large");
      if (!BASE64.test(data)) throw new RoomError("invalid_attachment");
      const bytes = new Uint8Array(Buffer.from(data, "base64"));
      if (bytes.length > attachmentLimit) throw new RoomError("attachment_too_large");
      if (!uploadBudget.allow(actor.id, bytes.length, Date.now())) throw new AuthError("rate_limited");
      const stored = await storeAttachment(db, actor, { name: bodyField(request.body, "name"), bytes, maxBytes: attachmentLimit });
      return reply.code(201).header("cache-control", "no-store").send(stored);
    } catch (error) {
      return sendError(request, reply, error);
    }
  });

  // Always a download: the type is the one the bytes proved, nosniff and a sandbox CSP keep the browser
  // from guessing, and the bytes behind one id never change.
  app.get("/api/v1/attachments/:id", async (request, reply) => {
    try {
      const actor = await caller(request);
      if (!db) throw new AuthError("auth_unconfigured");
      const file = await readAttachment(db, actor, param(request, "id"));
      return reply
        .code(200)
        .header("content-type", file.view.contentType)
        .header("content-disposition", contentDisposition(file.view.name))
        .header("x-content-type-options", "nosniff")
        .header("content-security-policy", "default-src 'none'; sandbox")
        .header("cache-control", "private, max-age=31536000, immutable")
        .send(Buffer.from(file.bytes));
    } catch (error) {
      return sendError(request, reply, error);
    }
  });

  if (db) {
    const purge = (): void => {
      purgeOrphanAttachments(db).catch((error: unknown) => {
        const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "error";
        app.log.error({ code }, "attachment purge failed");
      });
    };
    const timer = setInterval(purge, 60 * 60_000);
    timer.unref();
    app.addHook("onClose", async () => clearInterval(timer));
  }

  app.get("/api/v1/rooms/:id/pins", async (request, reply) => {
    try {
      const actor = await caller(request);
      if (!db) throw new AuthError("auth_unconfigured");
      return reply
        .code(200)
        .header("cache-control", "no-store")
        .send({ messages: await listPinned(db, actor, param(request, "id")) });
    } catch (error) {
      return sendError(request, reply, error);
    }
  });

  app.post("/api/v1/rooms/:id/messages/search", async (request, reply) => {
    try {
      const actor = await caller(request);
      if (!db) throw new AuthError("auth_unconfigured");
      if (!searching.allow(actor.id, Date.now())) throw new AuthError("rate_limited");
      const page = await searchMessages(db, actor, param(request, "id"), {
        query: bodyField(request.body, "query"),
        before: textField(request.body, "before"),
      });
      return reply.code(200).header("cache-control", "no-store").send(page);
    } catch (error) {
      return sendError(request, reply, error);
    }
  });

  app.post("/api/v1/messages/:id/edit", async (request, reply) => {
    try {
      const actor = await caller(request);
      if (!db) throw new AuthError("auth_unconfigured");
      if (!sending.allow(actor.id, Date.now())) throw new AuthError("rate_limited");
      const message = await editMessage(db, actor, param(request, "id"), { body: bodyField(request.body, "body") });
      await publishMessage(request, "message.updated", message);
      return reply.code(200).header("cache-control", "no-store").send(message);
    } catch (error) {
      return sendError(request, reply, error);
    }
  });

  app.post("/api/v1/messages/:id/delete", async (request, reply) => {
    try {
      const actor = await caller(request);
      if (!db) throw new AuthError("auth_unconfigured");
      const message = await deleteMessage(db, actor, param(request, "id"));
      await publishMessage(request, "message.deleted", message);
      return reply.code(200).header("cache-control", "no-store").send(message);
    } catch (error) {
      return sendError(request, reply, error);
    }
  });

  app.post("/api/v1/messages/:id/reactions", async (request, reply) => {
    try {
      const actor = await caller(request);
      if (!db) throw new AuthError("auth_unconfigured");
      if (!reacting.allow(actor.id, Date.now())) throw new AuthError("rate_limited");
      const message = await reactMessage(db, actor, param(request, "id"), { emoji: bodyField(request.body, "emoji"), on: booleanField(request.body, "on") });
      await publishMessage(request, "message.updated", message);
      return reply.code(200).header("cache-control", "no-store").send(message);
    } catch (error) {
      return sendError(request, reply, error);
    }
  });

  app.post("/api/v1/messages/:id/pin", async (request, reply) => {
    try {
      const actor = await caller(request);
      if (!db) throw new AuthError("auth_unconfigured");
      const message = await pinMessage(db, actor, param(request, "id"), booleanField(request.body, "pinned"));
      await publishMessage(request, "message.updated", message);
      return reply.code(200).header("cache-control", "no-store").send(message);
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
