import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import { registerAuth } from "./auth/routes.js";
import type { MigrationClient } from "./db/migrate.js";
import { registerPocJoin, type AppEnv } from "./poc-join.js";
import { registerRooms } from "./rooms/routes.js";

const DEV_ORIGINS = ["http://localhost:1420", "http://127.0.0.1:1420", "http://tauri.localhost", "tauri://localhost"];

export async function buildApp(options?: { logger?: boolean; env?: AppEnv; db?: MigrationClient }): Promise<FastifyInstance> {
  const env = options?.env ?? process.env;
  const app = Fastify({
    logger: options?.logger ?? {
      level: env.LOG_LEVEL ?? "info",
    },
  });

  await app.register(cors, {
    origin: DEV_ORIGINS,
    methods: ["GET", "POST"],
  });

  app.get("/health/live", async () => {
    return { status: "ok" };
  });

  app.get("/health/ready", async () => {
    return {
      status: "ok",
      checks: {
        database: "not_configured",
      },
    };
  });

  registerAuth(app, env, options?.db);
  registerRooms(app, env, options?.db);
  registerPocJoin(app, env);
  return app;
}
