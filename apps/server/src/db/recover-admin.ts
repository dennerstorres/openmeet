// S-02: the only way back in when the instance admin lost the password. A host command, never an HTTP route.
//   docker compose exec -T api node dist/db/recover-admin.js < arquivo-com-a-senha
// The new password comes from stdin, never from an argument or the environment. Nothing secret is printed.
import { pathToFileURL } from "node:url";
import { hashPassword } from "../auth/password.js";
import type { MigrationClient } from "./migrate.js";
import { openPostgres } from "./postgres.js";

export class RecoverError extends Error {}

/** Replaces the admin password and revokes every session of that account. Does not reopen the bootstrap. */
export async function recoverAdmin(client: MigrationClient, password: string): Promise<void> {
  if (password.length < 12 || password.length > 128) throw new RecoverError("the password must have 12 to 128 characters");
  const passwordHash = await hashPassword(password);
  await client.transaction(async (tx) => {
    const updated = await tx.query("update users set password_hash = $1, updated_at = now() where role = 'admin' returning id", [passwordHash]);
    const id = updated.rows[0]?.id;
    if (updated.rows.length !== 1 || typeof id !== "string") throw new RecoverError("there is no admin account");
    await tx.query("update refresh_sessions set revoked_at = now() where user_id = $1 and revoked_at is null", [id]);
    await tx.query("insert into audit_events (actor_user_id, action, target_type, target_id) values ($1, 'admin_password_recover', 'user', $1)", [id]);
  });
}

/** `docker compose exec` does not inherit DATABASE_URL from PID 1. Same URL as the entrypoint, never printed. */
export function databaseUrlFromCompose(env: NodeJS.ProcessEnv): string {
  const user = env.POSTGRES_USER ?? "";
  const password = env.POSTGRES_PASSWORD ?? "";
  const host = env.POSTGRES_HOST ?? "";
  const name = env.POSTGRES_DB ?? "";
  if (user.length === 0 || password.length === 0 || host.length === 0 || name.length === 0) throw new RecoverError("POSTGRES_* is incomplete");
  return `postgres://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:5432/${encodeURIComponent(name)}`;
}

/** One line from stdin. Only the line break at the end is dropped. */
export function passwordFromInput(input: string): string {
  return input.replace(/\r?\n$/, "");
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  return Buffer.concat(chunks).toString("utf8");
}

async function main(): Promise<void> {
  let database: ReturnType<typeof openPostgres> | undefined;
  try {
    const password = passwordFromInput(await readStdin());
    database = openPostgres(databaseUrlFromCompose(process.env), 1);
    await recoverAdmin(database.client, password);
    console.log("admin password replaced; every session of the admin was revoked");
  } catch (error) {
    console.error(error instanceof RecoverError ? error.message : "admin recovery failed");
    process.exitCode = 1;
  } finally {
    await database?.close();
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
