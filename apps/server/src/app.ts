import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import { attemptPolicy, type AttemptOptions } from "./auth/limit.js";
import { registerAuth } from "./auth/routes.js";
import type { MigrationClient } from "./db/migrate.js";
import { registerInstance } from "./instance.js";
import { registerPocJoin, type AppEnv } from "./poc-join.js";
import type { RoomMedia } from "./rooms/media.js";
import { registerRooms } from "./rooms/routes.js";

const DEV_ORIGINS = ["http://localhost:1420", "http://127.0.0.1:1420", "http://tauri.localhost", "tauri://localhost"];

export async function buildApp(options?: {
  logger?: boolean;
  env?: AppEnv;
  db?: MigrationClient;
  media?: RoomMedia;
  attempts?: AttemptOptions;
}): Promise<FastifyInstance> {
  const env = options?.env ?? process.env;
  const app = Fastify({
    logger: options?.logger ?? {
      level: env.LOG_LEVEL ?? "info",
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

  const attempts = attemptPolicy(env.TRUST_PROXY === "1", options?.attempts);
  registerInstance(app, env, options?.db);
  registerAuth(app, env, options?.db, attempts);
  registerRooms(app, env, options?.db, options?.media);
  registerPocJoin(app, env);
  return app;
}
