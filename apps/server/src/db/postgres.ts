import postgres from "postgres";
import type { MigrationClient } from "./migrate.js";

export function redact(message: string, secret: string): string {
  if (secret.length === 0) return message;
  return message.split(secret).join("[redacted]");
}

export function postgresClient(sql: ReturnType<typeof postgres>): MigrationClient {
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

export interface PostgresHandle {
  client: MigrationClient;
  close(): Promise<void>;
}

export function openPostgres(databaseUrl: string, max = 4): PostgresHandle {
  const sql = postgres(databaseUrl, { max, idle_timeout: 20, connect_timeout: 10 });
  return {
    client: postgresClient(sql),
    close: async () => {
      await sql.end({ timeout: 5 });
    },
  };
}
