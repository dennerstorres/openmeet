import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATION_NAME = /^[0-9]{4}_[a-z0-9_]+\.sql$/;

export interface MigrationClient {
  exec(statement: string): Promise<void>;
  query(statement: string, params?: readonly unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  transaction<T>(run: (tx: MigrationClient) => Promise<T>): Promise<T>;
}

export function migrationDirectory(): string {
  return fileURLToPath(new URL("../../drizzle", import.meta.url));
}

export async function listMigrationFiles(directory = migrationDirectory()): Promise<string[]> {
  const entries = await readdir(directory);
  return entries.filter((name) => MIGRATION_NAME.test(name)).sort();
}

export async function applyMigrations(client: MigrationClient, directory = migrationDirectory()): Promise<readonly string[]> {
  await client.exec(`
    create table if not exists schema_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )
  `);
  const applied = await client.query("select name from schema_migrations");
  const done = new Set(applied.rows.map((row) => String(row.name)));
  const fresh: string[] = [];
  for (const name of await listMigrationFiles(directory)) {
    if (done.has(name)) continue;
    const filePath = path.resolve(directory, name);
    if (path.dirname(filePath) !== path.resolve(directory)) {
      throw new Error("migration path escaped its directory");
    }
    const sqlText = await readFile(filePath, "utf8");
    await client.transaction(async (tx) => {
      await tx.exec(sqlText);
      await tx.query("insert into schema_migrations (name) values ($1)", [name]);
    });
    fresh.push(name);
  }
  return fresh;
}
