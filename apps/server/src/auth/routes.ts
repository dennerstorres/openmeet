import type { FastifyInstance } from "fastify";
import type { AppEnv } from "../poc-join.js";
import type { MigrationClient } from "../db/migrate.js";
import { clientAddress, headerValue, ProxyRejected, type AttemptPolicy } from "./limit.js";
import type { RoomMedia } from "../rooms/media.js";
import { AuthError, type AuthErrorCode, bootstrapAdmin, bootstrapClosed, changePassword, currentUser, login, logout, refreshSession } from "./service.js";
import { clearSessionCookies, noteClient, readCookie, REFRESH_COOKIE, rejectForeignWeb, requireAccessToken, sendSession, webMode } from "./web-session.js";

const STATUS: Record<AuthErrorCode, number> = {
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

function configuredSecret(env: AppEnv): string | undefined {
  const secret = env.AUTH_SECRET ?? "";
  return secret.length >= 32 ? secret : undefined;
}

function configuredBootstrap(env: AppEnv): string | undefined {
  const token = env.BOOTSTRAP_TOKEN ?? "";
  return token.length >= 20 ? token : undefined;
}

function field(body: unknown, key: string): string | undefined {
  if (typeof body !== "object" || body === null || Array.isArray(body) || !(key in body)) return undefined;
  const value = (body as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

function requireField(body: unknown, key: string): string {
  const value = field(body, key);
  if (value === undefined) throw new AuthError("invalid_body");
  return value;
}

export function registerAuth(
  app: FastifyInstance,
  env: AppEnv,
  db: MigrationClient | undefined,
  attempts: AttemptPolicy,
  media: RoomMedia | undefined = undefined,
): void {
  // S-11: the routes that count attempts answer 503 when the request did not come through the stack proxy.
  function address(request: { ip: string; headers: { [key: string]: string | string[] | undefined } }): string {
    try {
      return clientAddress(
        request.ip,
        { forwarded: headerValue(request.headers["x-forwarded-for"]), proxy: headerValue(request.headers["x-openmeet-proxy"]) },
        attempts,
      );
    } catch (error) {
      if (error instanceof ProxyRejected) throw new AuthError("proxy_rejected");
      throw error;
    }
  }

  app.post("/api/v1/auth/bootstrap", async (request, reply) => {
    try {
      const database = db;
      const secret = configuredSecret(env);
      if (!database || !secret) throw new AuthError("auth_unconfigured");
      // Closed: the same 404 for any token and any body, before the token or the body is read.
      if (await bootstrapClosed(database)) throw new AuthError("bootstrap_closed");
      const expected = configuredBootstrap(env);
      if (!expected) throw new AuthError("auth_unconfigured");
      rejectForeignWeb(request, env);
      const ip = address(request);
      const session = await bootstrapAdmin(
        database,
        secret,
        expected,
        {
          token: requireField(request.body, "token"),
          username: requireField(request.body, "username"),
          password: requireField(request.body, "password"),
          displayName: requireField(request.body, "displayName"),
        },
        () => attempts.bootstrap.allow(`bootstrap:${ip}`, attempts.now()),
      );
      await noteClient(request, env, database, secret, session);
      return sendSession(request, reply, env, 201, session);
    } catch (error) {
      return sendAuthError(request, reply, error);
    }
  });

  app.post("/api/v1/auth/login", async (request, reply) => {
    try {
      const database = db;
      const secret = configuredSecret(env);
      if (!database || !secret) throw new AuthError("auth_unconfigured");
      rejectForeignWeb(request, env);
      const ip = address(request);
      const username = requireField(request.body, "username");
      const session = await login(database, secret, username, requireField(request.body, "password"), () => {
        const userOk = attempts.loginUser.allow(`user:${ip}:${username}`, attempts.now());
        const ipOk = attempts.loginIp.allow(`ip:${ip}`, attempts.now());
        return userOk && ipOk;
      });
      await noteClient(request, env, database, secret, session);
      return sendSession(request, reply, env, 200, session);
    } catch (error) {
      return sendAuthError(request, reply, error);
    }
  });

  app.post("/api/v1/auth/refresh", async (request, reply) => {
    const web = webMode(request, env) === "web";
    try {
      const database = db;
      const secret = configuredSecret(env);
      if (!database || !secret) throw new AuthError("auth_unconfigured");
      rejectForeignWeb(request, env);
      const ip = address(request);
      // The web client never sees its refresh token: it comes from the cookie, not the body.
      const refreshToken = web ? (readCookie(request.headers, REFRESH_COOKIE) ?? "") : requireField(request.body, "refreshToken");
      const session = await refreshSession(database, secret, refreshToken, (tokenKey) => {
        const ipOk = attempts.refreshIp.allow(`refresh:${ip}`, attempts.now());
        const tokenOk = attempts.refreshToken.allow(`refresh-token:${tokenKey}`, attempts.now());
        return ipOk && tokenOk;
      });
      await noteClient(request, env, database, secret, session);
      return sendSession(request, reply, env, 200, session);
    } catch (error) {
      // A reused or unknown refresh ends the web session: the cookies go with it.
      if (web && error instanceof AuthError && error.code === "invalid_session") clearSessionCookies(reply);
      return sendAuthError(request, reply, error);
    }
  });

  app.post("/api/v1/auth/logout", async (request, reply) => {
    try {
      if (!db) throw new AuthError("auth_unconfigured");
      rejectForeignWeb(request, env);
      if (webMode(request, env) === "web") {
        const refreshToken = readCookie(request.headers, REFRESH_COOKIE);
        // 502 keeps the cookies, so the page can repeat the logout until the cut confirms.
        if (refreshToken !== undefined) await logout(db, refreshToken, media);
        clearSessionCookies(reply);
        return reply.code(204).header("cache-control", "no-store").send();
      }
      await logout(db, requireField(request.body, "refreshToken"), media);
      return reply.code(204).header("cache-control", "no-store").send();
    } catch (error) {
      return sendAuthError(request, reply, error);
    }
  });

  app.post("/api/v1/auth/password", async (request, reply) => {
    try {
      const database = db;
      const secret = configuredSecret(env);
      if (!database || !secret) throw new AuthError("auth_unconfigured");
      const token = requireAccessToken(request, env);
      const ip = address(request);
      const session = await changePassword(
        database,
        secret,
        token,
        { currentPassword: requireField(request.body, "currentPassword"), newPassword: requireField(request.body, "newPassword") },
        () => attempts.loginIp.allow(`password:${ip}`, attempts.now()),
      );
      await noteClient(request, env, database, secret, session);
      return sendSession(request, reply, env, 200, session);
    } catch (error) {
      return sendAuthError(request, reply, error);
    }
  });

  app.get("/api/v1/auth/me", async (request, reply) => {
    try {
      const database = db;
      const secret = configuredSecret(env);
      if (!database || !secret) throw new AuthError("auth_unconfigured");
      const token = requireAccessToken(request, env);
      const user = await currentUser(database, secret, token);
      return reply.code(200).header("cache-control", "no-store").send(user);
    } catch (error) {
      return sendAuthError(request, reply, error);
    }
  });
}

function sendAuthError(
  request: { log: { error: (obj: object, message: string) => void } },
  reply: { code: (status: number) => { send: (body?: unknown) => unknown } },
  error: unknown,
): unknown {
  if (error instanceof AuthError) {
    return reply.code(STATUS[error.code]).send({ error: error.code });
  }
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "error";
  request.log.error({ code }, "auth failed");
  return reply.code(500).send({ error: "auth_failed" });
}
