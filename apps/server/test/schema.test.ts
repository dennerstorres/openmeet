import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { getTableColumns, getTableName } from "drizzle-orm";
import { applyMigrations, type MigrationClient } from "../src/db/migrate.js";
import { identityEnums, identityTables } from "../src/db/schema.js";

function pgliteClient(db: PGlite): MigrationClient {
  const client: MigrationClient = {
    exec: async (statement) => {
      await db.exec(statement);
    },
    query: async (statement, params) => {
      const result = await db.query<Record<string, unknown>>(statement, params === undefined ? [] : [...params]);
      return { rows: result.rows.map((row) => ({ ...row })) };
    },
    transaction: async (run) => {
      await db.exec("begin");
      try {
        const value = await run(client);
        await db.exec("commit");
        return value;
      } catch (error) {
        await db.exec("rollback");
        throw error;
      }
    },
  };
  return client;
}

function sqlState(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string") return error.code;
  return "";
}

async function expectSqlState(run: () => Promise<unknown>, state: string): Promise<void> {
  try {
    await run();
  } catch (error) {
    assert.equal(sqlState(error), state);
    return;
  }
  assert.fail(`expected sqlstate ${state}`);
}

test("identity migration matches the schema and rejects a second admin, duplicate names, and raw secrets", async () => {
  const db = new PGlite();
  try {
    const client = pgliteClient(db);
    assert.deepEqual(await applyMigrations(client), ["0001_identity.sql"]);
    assert.deepEqual(await applyMigrations(client), []);

    const tables = await client.query("select tablename from pg_tables where schemaname = 'public'");
    assert.deepEqual(tables.rows.map((row) => row.tablename).sort(), identityTables.map((table) => getTableName(table)).sort());

    for (const table of identityTables) {
      const expected = Object.values(getTableColumns(table))
        .map((column) => column.name)
        .sort();
      const actual = await client.query("select column_name from information_schema.columns where table_schema = 'public' and table_name = $1", [
        getTableName(table),
      ]);
      assert.deepEqual(actual.rows.map((row) => row.column_name).sort(), expected);
    }

    const types = await client.query("select typname from pg_type where typtype = 'e'");
    assert.deepEqual(types.rows.map((row) => row.typname).sort(), identityEnums.map((item) => item.enumName).sort());

    const secretColumns = await client.query(`
      select column_name
      from information_schema.columns
      where table_schema = 'public'
        and column_name ~ '(token|code|password|secret)'
        and column_name !~ '_hash$'
    `);
    assert.deepEqual(secretColumns.rows, []);

    const admin = await client.query(
      "insert into users (username, password_hash, display_name, role) values ('admin', 'hash-admin', 'Admin', 'admin') returning id",
    );
    const adminId = admin.rows[0]?.id;
    assert.equal(typeof adminId, "string");
    await expectSqlState(
      () => client.query("insert into users (username, password_hash, display_name, role) values ('other', 'hash-other', 'Other', 'admin')"),
      "23505",
    );
    await expectSqlState(
      () => client.query("insert into users (username, password_hash, display_name, role) values ('admin', 'hash-again', 'Again', 'participant')"),
      "23505",
    );
    await expectSqlState(() => client.query("insert into users (username, password_hash, display_name) values ('bad name', 'hash', 'Bad')"), "23514");
    await expectSqlState(() => client.query("insert into users (username, password_hash, display_name) values ('empty-hash', '', 'Empty')"), "23514");

    const member = await client.query("insert into users (username, password_hash, display_name) values ('member', 'hash-member', 'Member') returning id");
    const memberId = member.rows[0]?.id;
    assert.equal(typeof memberId, "string");
    const room = await client.query("insert into rooms (name, slug, kind, created_by) values ('Sala', 'sala', 'persistent', $1) returning id", [adminId]);
    const roomId = room.rows[0]?.id;
    assert.equal(typeof roomId, "string");
    await client.query("insert into memberships (room_id, user_id, role) values ($1, $2, 'participant')", [roomId, memberId]);
    await expectSqlState(() => client.query("insert into memberships (room_id, user_id, role) values ($1, $2, 'moderator')", [roomId, memberId]), "23505");
    await expectSqlState(
      () =>
        client.query("insert into invites (room_id, code_hash, created_by, expires_at, max_uses, use_count) values ($1, 'invite-hash', $2, now(), 1, 2)", [
          roomId,
          adminId,
        ]),
      "23514",
    );
    await expectSqlState(() => client.query("insert into instance_settings (id) values (1)"), "23505");
    await expectSqlState(() => client.query("insert into instance_settings (id) values (2)"), "23514");

    const applied = await client.query("select name from schema_migrations");
    assert.deepEqual(
      applied.rows.map((row) => row.name),
      ["0001_identity.sql"],
    );
  } finally {
    await db.close();
  }
});
