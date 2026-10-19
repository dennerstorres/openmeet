import postgres from "postgres";
import type { MigrationClient } from "./migrate.js";

export function redact(message: string, secret: string): string {
  if (secret.length === 0) return message;
  return message.split(secret).join("[redacted]");
}

function parameters(params: readonly unknown[] | undefined): never[] {
  return params === undefined ? [] : ([...params] as never[]);
}

function reservedClient(tx: postgres.TransactionSql): MigrationClient {
  return {
    exec: async (statement) => {
      await tx.unsafe(statement);
    },
    query: async (statement, params) => {
      const rows = await tx.unsafe(statement, parameters(params));
      return { rows: rows.map((row) => ({ ...row })) };
    },
    transaction: async (run) => {
      const value = await tx.savepoint((sx) => run(reservedClient(sx)));
      return value as never;
    },
  };
}

export function postgresClient(sql: ReturnType<typeof postgres>): MigrationClient {
  return {
    exec: async (statement) => {
      await sql.unsafe(statement);
    },
    query: async (statement, params) => {
      const rows = await sql.unsafe(statement, parameters(params));
      return { rows: rows.map((row) => ({ ...row })) };
    },
    transaction: async (run) => {
      const value = await sql.begin((tx) => run(reservedClient(tx)));
      return value as never;
    },
  };
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
