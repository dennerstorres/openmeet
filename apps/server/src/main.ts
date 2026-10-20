import { fileURLToPath } from "node:url";
import { buildApp } from "./app.js";
import { openPostgres, redact } from "./db/postgres.js";
import { assertPocBind } from "./poc-join.js";
import { liveKitRoomMedia } from "./rooms/media.js";

const port = Number(process.env.PORT ?? "3000");
const host = process.env.HOST ?? "127.0.0.1";

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535");
}

assertPocBind(process.env);
const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const database = databaseUrl.length > 0 ? openPostgres(databaseUrl) : undefined;
const media = liveKitRoomMedia(process.env);
// ADR 0014: the image puts the web client next to dist/. WEB_ROOT points elsewhere for development.
const webRoot = process.env.WEB_ROOT?.trim() || fileURLToPath(new URL("../web", import.meta.url));
const app = await buildApp({
  webRoot,
  ...(database ? { db: database.client } : {}),
  ...(media ? { media } : {}),
});
if (database) {
  app.addHook("onClose", async () => {
    await database.close();
  });
}

let stopping = false;

async function stop(code: number): Promise<void> {
  if (stopping) return;
  stopping = true;
  try {
    await app.close();
  } finally {
    process.exit(code);
  }
}

process.on("SIGINT", () => {
  void stop(0);
});
process.on("SIGTERM", () => {
  void stop(0);
});

try {
  await app.listen({ port, host });
} catch (error) {
  const message = error instanceof Error ? error.message : "server failed";
  app.log.error(redact(message, databaseUrl));
  await stop(1);
}
