import type { FastifyInstance } from "fastify";
import type { MigrationClient } from "./db/migrate.js";
import type { AppEnv } from "./poc-join.js";

function isTrue(value: unknown): boolean {
  return value === true || value === "t" || value === "true" || value === 1;
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

export function instanceName(env: AppEnv): string {
  const name = (env.INSTANCE_NAME ?? "").trim();
  if (name.length < 1 || name.length > 80 || hasControlCharacter(name)) return "OpenMeet";
  return name;
}

export function registerInstance(app: FastifyInstance, env: AppEnv, db: MigrationClient | undefined): void {
  app.get("/api/v1/instance", async (request, reply) => {
    try {
      let bootstrapOpen = false;
      if (db) {
        const found = await db.query("select bootstrap_completed from instance_settings where id = 1");
        bootstrapOpen = found.rows.length === 1 && !isTrue(found.rows[0]?.bootstrap_completed);
      }
      return reply
        .code(200)
        .header("cache-control", "no-store")
        .send({ name: instanceName(env), apiVersion: "v1", bootstrapOpen });
    } catch {
      request.log.error({ code: "instance_metadata_failed" }, "instance metadata failed");
      return reply.code(503).header("cache-control", "no-store").send({ error: "instance_unavailable" });
    }
  });
}
