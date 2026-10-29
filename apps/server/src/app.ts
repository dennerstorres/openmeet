import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import type { GoogleTokens } from "./auth/google.js";
import { registerGoogle } from "./auth/google-routes.js";
import { attemptPolicy, type AttemptOptions } from "./auth/limit.js";
import { registerAuth } from "./auth/routes.js";
import type { MigrationClient } from "./db/migrate.js";
import { registerInstance } from "./instance.js";
import { redactInviteUrl, registerInvitePage } from "./invite-page.js";
import { registerLegalPages } from "./legal-pages.js";
import { registerPocJoin, type AppEnv } from "./poc-join.js";
import type { RoomMedia } from "./rooms/media.js";
import { registerRooms } from "./rooms/routes.js";
import { registerWebClient } from "./web-client.js";

const DEV_ORIGINS = ["http://localhost:1420", "http://127.0.0.1:1420", "http://tauri.localhost", "tauri://localhost"];

export async function buildApp(options?: {
  logger?: boolean;
  env?: AppEnv;
  db?: MigrationClient;
  media?: RoomMedia;
  attempts?: AttemptOptions;
  googleTokens?: GoogleTokens;
  /** ADR 0014: the built web client (`dist-web`). Absent, the instance serves only the API. */
  webRoot?: string;
  /** Tests read the production log lines through this stream. */
  logStream?: { write: (line: string) => void };
}): Promise<FastifyInstance> {
  const env = options?.env ?? process.env;
  const app = Fastify({
    logger: options?.logger ?? {
      level: env.LOG_LEVEL ?? "info",
      ...(options?.logStream ? { stream: options.logStream } : {}),
      serializers: {
        req: (request: { method: string; url: string }) => ({ method: request.method, url: redactInviteUrl(request.url) }),
      },
    },
  });

  await app.register(cors, {
    origin: DEV_ORIGINS,
    methods: ["GET", "POST", "PATCH", "DELETE"],
  });

  app.get("/health/live", async () => {
    return { status: "ok" };
  });

  app.get("/health/ready", async (_request, reply) => {
    if (!options?.db) {
      return { status: "ok", checks: { database: "not_configured" } };
    }
    try {
      await options.db.query("select 1 as ok");
      return { status: "ok", checks: { database: "ok" } };
    } catch {
      return reply.code(503).send({ status: "unavailable", checks: { database: "error" } });
    }
  });

  const attempts = attemptPolicy(env.TRUST_PROXY === "1", options?.attempts, env.PROXY_AUTH);
  registerInstance(app, env, options?.db);
  registerAuth(app, env, options?.db, attempts, options?.media);
  registerGoogle(app, env, options?.db, attempts, options?.googleTokens);
  registerRooms(app, env, options?.db, options?.media);
  registerPocJoin(app, env);
  registerInvitePage(app, registerWebClient(app, env, options?.webRoot));
  registerLegalPages(app);
  return app;
}
