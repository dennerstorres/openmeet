// S-12: the entrypoint asks this after the migration. Prints only "open" or "closed".
import { openPostgres } from "./postgres.js";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
if (databaseUrl.length === 0) {
  console.error("DATABASE_URL is not set");
  process.exitCode = 1;
} else {
  const database = openPostgres(databaseUrl, 1);
  try {
    const settings = await database.client.query("select bootstrap_completed from instance_settings where id = 1");
    const done = settings.rows[0]?.bootstrap_completed;
    process.stdout.write(done === true || done === "t" ? "closed" : "open");
  } catch {
    console.error("bootstrap state could not be read");
    process.exitCode = 1;
  } finally {
    await database.close();
  }
}
