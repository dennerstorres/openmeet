import postgres from "postgres";
import { applyMigrations, type MigrationClient } from "./migrate.js";

function redact(message: string, secret: string): string {
  return message.split(secret).join("[redacted]");
}

function postgresClient(sql: ReturnType<typeof postgres>): MigrationClient {
  const client: MigrationClient = {
    exec: async (statement) => {
      await sql.unsafe(statement);
    },
    query: async (statement, params) => {
      const rows = await sql.unsafe(statement, params === undefined ? [] : ([...params] as never[]));
      return { rows: rows.map((row) => ({ ...row })) };
    },
    transaction: async (run) => {
      await sql.unsafe("begin");
      try {
        const value = await run(client);
        await sql.unsafe("commit");
        return value;
      } catch (error) {
        await sql.unsafe("rollback");
        throw error;
      }
    },
  };
  return client;
}

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
if (databaseUrl.length === 0) {
  console.error("DATABASE_URL is not set");
  process.exitCode = 1;
} else {
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    const applied = await applyMigrations(postgresClient(sql));
    console.log(applied.length === 0 ? "migrations already applied" : `applied ${applied.join(", ")}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "migration failed";
    console.error(redact(message, databaseUrl));
    process.exitCode = 1;
  } finally {
    await sql.end();
  }
}
