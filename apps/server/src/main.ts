import { buildApp } from "./app.js";
import { assertPocBind } from "./poc-join.js";

const port = Number(process.env.PORT ?? "3000");
const host = process.env.HOST ?? "127.0.0.1";

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535");
}

assertPocBind(process.env);
const app = await buildApp();

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
