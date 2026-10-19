import { applyMigrations } from "./migrate.js";
import { openPostgres, redact } from "./postgres.js";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
if (databaseUrl.length === 0) {
  console.error("DATABASE_URL is not set");
  process.exitCode = 1;
} else {
  const database = openPostgres(databaseUrl, 1);
  try {
    const applied = await applyMigrations(database.client);
    console.log(applied.length === 0 ? "migrations already applied" : `applied ${applied.join(", ")}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "migration failed";
    console.error(redact(message, databaseUrl));
    process.exitCode = 1;
  } finally {
    await database.close();
  }
}
