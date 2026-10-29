import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { getTableColumns, getTableName } from "drizzle-orm";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { applyMigrations, migrationDirectory, type MigrationClient } from "../src/db/migrate.js";
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
    assert.deepEqual(await applyMigrations(client), [
      "0001_identity.sql",
      "0002_servers.sql",
      "0003_google_login.sql",
      "0004_display_name.sql",
      "0005_session_family.sql",
      "0006_media_cut.sql",
      "0007_server_presence.sql",
      "0008_images_profiles.sql",
      "0009_sounds.sql",
      "0010_soft_delete.sql",
      "0011_text_rooms.sql",
      "0012_google_invite.sql",
      "0013_push_subscriptions.sql",
      "0014_session_client.sql",
    ]);
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
    const server = await client.query("insert into servers (name, created_by) values ('Geral', $1) returning id", [adminId]);
    const serverId = server.rows[0]?.id;
    await client.query("insert into server_members (server_id, user_id, role) values ($1, $2, 'owner')", [serverId, adminId]);
    await expectSqlState(() => client.query("insert into server_members (server_id, user_id, role) values ($1, $2, 'owner')", [serverId, memberId]), "23505");
    await expectSqlState(
      () => client.query("insert into rooms (name, slug, kind, created_by) values ('Solta', 'solta', 'persistent', $1)", [adminId]),
      "23502",
    );
    const room = await client.query("insert into rooms (server_id, name, slug, kind, created_by) values ($1, 'Sala', 'sala', 'persistent', $2) returning id", [
      serverId,
      adminId,
    ]);
    const roomId = room.rows[0]?.id;
    assert.equal(typeof roomId, "string");
    await expectSqlState(
      () => client.query("insert into rooms (server_id, name, slug, kind, created_by) values ($1, 'Sala', 'sala', 'persistent', $2)", [serverId, adminId]),
      "23505",
    );
    const other = await client.query("insert into servers (name, created_by) values ('RPG', $1) returning id", [adminId]);
    await client.query("insert into rooms (server_id, name, slug, kind, created_by) values ($1, 'Sala', 'sala', 'persistent', $2)", [
      other.rows[0]?.id,
      adminId,
    ]);
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
      [
        "0001_identity.sql",
        "0002_servers.sql",
        "0003_google_login.sql",
        "0004_display_name.sql",
        "0005_session_family.sql",
        "0006_media_cut.sql",
        "0007_server_presence.sql",
        "0008_images_profiles.sql",
        "0009_sounds.sql",
        "0010_soft_delete.sql",
        "0011_text_rooms.sql",
        "0012_google_invite.sql",
        "0013_push_subscriptions.sql",
        "0014_session_client.sql",
      ],
    );
  } finally {
    await db.close();
  }
});

test("the servers migration moves existing rooms into Geral and revokes room invites", async () => {
  const db = new PGlite();
  const firstOnly = await mkdtemp(path.join(tmpdir(), "openmeet-migrations-"));
  try {
    const client = pgliteClient(db);
    await copyFile(path.join(migrationDirectory(), "0001_identity.sql"), path.join(firstOnly, "0001_identity.sql"));
    assert.deepEqual(await applyMigrations(client, firstOnly), ["0001_identity.sql"]);
    const admin = await client.query("insert into users (username, password_hash, display_name, role) values ('admin', 'h1', 'Admin', 'admin') returning id");
    const adminId = admin.rows[0]?.id;
    const kept = await client.query("insert into users (username, password_hash, display_name) values ('kept', 'h2', 'Kept') returning id");
    const keptId = kept.rows[0]?.id;
    const gone = await client.query("insert into users (username, password_hash, display_name) values ('gone', 'h3', 'Gone') returning id");
    const goneId = gone.rows[0]?.id;
    const room = await client.query("insert into rooms (name, slug, kind, created_by) values ('Sala', 'sala', 'persistent', $1) returning id", [adminId]);
    const roomId = room.rows[0]?.id;
    await client.query("insert into memberships (room_id, user_id, role) values ($1, $2, 'moderator')", [roomId, adminId]);
    await client.query("insert into memberships (room_id, user_id, role) values ($1, $2, 'participant')", [roomId, keptId]);
    await client.query("insert into memberships (room_id, user_id, role, removed_at) values ($1, $2, 'participant', now())", [roomId, goneId]);
    await client.query("insert into invites (room_id, code_hash, created_by, expires_at) values ($1, 'hash-a', $2, now() + interval '1 day')", [
      roomId,
      adminId,
    ]);

    assert.deepEqual(await applyMigrations(client), [
      "0002_servers.sql",
      "0003_google_login.sql",
      "0004_display_name.sql",
      "0005_session_family.sql",
      "0006_media_cut.sql",
      "0007_server_presence.sql",
      "0008_images_profiles.sql",
      "0009_sounds.sql",
      "0010_soft_delete.sql",
      "0011_text_rooms.sql",
      "0012_google_invite.sql",
      "0013_push_subscriptions.sql",
      "0014_session_client.sql",
    ]);

    const servers = await client.query("select id, name, created_by from servers");
    assert.equal(servers.rows.length, 1);
    assert.equal(servers.rows[0]?.name, "Geral");
    assert.equal(servers.rows[0]?.created_by, adminId);
    const moved = await client.query("select server_id from rooms where id = $1", [roomId]);
    assert.equal(moved.rows[0]?.server_id, servers.rows[0]?.id);
    const members = await client.query("select user_id, role from server_members order by role");
    assert.deepEqual(
      members.rows.map((row) => [row.user_id, row.role]).sort(),
      [
        [adminId, "owner"],
        [keptId, "participant"],
      ].sort(),
    );
    const open = await client.query("select id from invites where revoked_at is null");
    assert.deepEqual(open.rows, []);
  } finally {
    await rm(firstOnly, { recursive: true, force: true });
    await db.close();
  }
});

test("the servers migration on an empty database creates no server", async () => {
  const db = new PGlite();
  try {
    const client = pgliteClient(db);
    await applyMigrations(client);
    const servers = await client.query("select id from servers");
    assert.deepEqual(servers.rows, []);
  } finally {
    await db.close();
  }
});

test("the session family migration names every chain by its root", async () => {
  const db = new PGlite();
  const upTo = await mkdtemp(path.join(tmpdir(), "openmeet-family-"));
  try {
    const client = pgliteClient(db);
    for (const name of ["0001_identity.sql", "0002_servers.sql", "0003_google_login.sql", "0004_display_name.sql"]) {
      await copyFile(path.join(migrationDirectory(), name), path.join(upTo, name));
    }
    await applyMigrations(client, upTo);
    const user = await client.query("insert into users (username, password_hash, display_name, role) values ('admin', 'h', 'Admin', 'admin') returning id");
    const userId = user.rows[0]?.id;
    const session = async (hash: string, replacedBy: unknown) =>
      (
        await client.query("insert into refresh_sessions (user_id, token_hash, expires_at, replaced_by) values ($1, $2, now(), $3) returning id", [
          userId,
          hash,
          replacedBy ?? null,
        ])
      ).rows[0]?.id;
    const c = await session("c", null);
    const b = await session("b", c);
    const a = await session("a", b);
    const alone = await session("alone", null);

    assert.deepEqual(await applyMigrations(client), [
      "0005_session_family.sql",
      "0006_media_cut.sql",
      "0007_server_presence.sql",
      "0008_images_profiles.sql",
      "0009_sounds.sql",
      "0010_soft_delete.sql",
      "0011_text_rooms.sql",
      "0012_google_invite.sql",
      "0013_push_subscriptions.sql",
      "0014_session_client.sql",
    ]);
    const rows = await client.query("select id, family_id from refresh_sessions");
    const family = new Map(rows.rows.map((row) => [row.id, row.family_id]));
    assert.equal(family.get(a), a);
    assert.equal(family.get(b), a);
    assert.equal(family.get(c), a);
    assert.equal(family.get(alone), alone);
    await expectSqlState(() => client.query("insert into refresh_sessions (user_id, token_hash, expires_at) values ($1, 'd', now())", [userId]), "23502");
  } finally {
    await db.close();
    await rm(upTo, { recursive: true, force: true });
  }
});

test("the text rooms migration keeps rooms as voice and guards messages, DMs, emojis and reads", async () => {
  const db = new PGlite();
  try {
    const client = pgliteClient(db);
    await applyMigrations(client);
    const owner = await client.query("insert into users (username, password_hash, display_name) values ('dono', 'hash-dono', 'Dono') returning id");
    const ownerId = owner.rows[0]?.id;
    const friend = await client.query("insert into users (username, password_hash, display_name) values ('amiga', 'hash-amiga', 'Amiga') returning id");
    const friendId = friend.rows[0]?.id;
    const server = await client.query("insert into servers (name, created_by) values ('Geral', $1) returning id", [ownerId]);
    const serverId = server.rows[0]?.id;

    const voice = await client.query(
      "insert into rooms (server_id, name, slug, kind, created_by) values ($1, 'Voz', 'voz', 'persistent', $2) returning channel",
      [serverId, ownerId],
    );
    assert.equal(voice.rows[0]?.channel, "voice");
    await expectSqlState(
      () =>
        client.query("insert into rooms (server_id, name, slug, kind, channel, created_by) values ($1, 'Rápida', 'rapida', 'temporary', 'text', $2)", [
          serverId,
          ownerId,
        ]),
      "23514",
    );
    const text = await client.query(
      "insert into rooms (server_id, name, slug, kind, channel, created_by) values ($1, 'Geral', 'geral', 'persistent', 'text', $2) returning id",
      [serverId, ownerId],
    );
    const roomId = text.rows[0]?.id;

    const directKey = [String(ownerId), String(friendId)].sort().join(":");
    const dm = await client.query("insert into dm_channels (kind, direct_key, created_by) values ('direct', $1, $2) returning id", [directKey, ownerId]);
    const dmId = dm.rows[0]?.id;
    await expectSqlState(
      () => client.query("insert into dm_channels (kind, direct_key, created_by) values ('direct', $1, $2)", [directKey, friendId]),
      "23505",
    );
    await expectSqlState(() => client.query("insert into dm_channels (kind, created_by) values ('direct', $1)", [ownerId]), "23514");
    await expectSqlState(
      () => client.query("insert into dm_channels (kind, name, direct_key, created_by) values ('group', 'Grupo', $1, $2)", ["a:b", ownerId]),
      "23514",
    );
    await client.query("insert into dm_channels (kind, name, created_by) values ('group', 'Grupo', $1)", [ownerId]);

    const message = await client.query("insert into messages (room_id, author_id, body) values ($1, $2, 'olá') returning id", [roomId, ownerId]);
    const messageId = message.rows[0]?.id;
    const later = await client.query("insert into messages (dm_id, author_id, body) values ($1, $2, 'oi') returning id", [dmId, friendId]);
    assert.ok(BigInt(String(later.rows[0]?.id)) > BigInt(String(messageId)));
    await expectSqlState(
      () => client.query("insert into messages (room_id, dm_id, author_id, body) values ($1, $2, $3, 'x')", [roomId, dmId, ownerId]),
      "23514",
    );
    await expectSqlState(() => client.query("insert into messages (author_id, body) values ($1, 'x')", [ownerId]), "23514");
    await expectSqlState(
      () => client.query("insert into messages (room_id, author_id, body) values ($1, $2, $3)", [roomId, ownerId, "a".repeat(4001)]),
      "23514",
    );
    await expectSqlState(() => client.query("update messages set deleted_at = now() where id = $1", [messageId]), "23514");
    await client.query("update messages set deleted_at = now(), body = '' where id = $1", [messageId]);
    await expectSqlState(() => client.query("update messages set pinned_at = now() where id = $1", [later.rows[0]?.id]), "23514");

    await client.query("insert into message_reactions (message_id, user_id, emoji) values ($1, $2, '👍')", [messageId, friendId]);
    await expectSqlState(
      () => client.query("insert into message_reactions (message_id, user_id, emoji) values ($1, $2, '👍')", [messageId, friendId]),
      "23505",
    );
    await expectSqlState(
      () => client.query("insert into message_reactions (message_id, user_id, emoji) values ($1, $2, '<b>')", [messageId, friendId]),
      "23514",
    );

    const bytes = new Uint8Array([1, 2, 3]);
    const sha = "a".repeat(64);
    await client.query(
      "insert into message_attachments (uploader_id, name, content_type, bytes, byte_size, sha256) values ($1, 'nota.txt', 'text/plain', $2, 3, $3)",
      [ownerId, bytes, sha],
    );
    await expectSqlState(
      () =>
        client.query(
          "insert into message_attachments (uploader_id, name, content_type, bytes, byte_size, sha256) values ($1, '../x', 'text/plain', $2, 3, $3)",
          [ownerId, bytes, sha],
        ),
      "23514",
    );
    await expectSqlState(
      () =>
        client.query(
          "insert into message_attachments (uploader_id, name, content_type, bytes, byte_size, sha256) values ($1, 'x.txt', 'text/plain', $2, 4, $3)",
          [ownerId, bytes, sha],
        ),
      "23514",
    );

    const emoji =
      "insert into server_emojis (server_id, name, content_type, animated, bytes, byte_size, sha256, created_by) values ($1, $2, $3, false, $4, 3, $5, $6)";
    await client.query(emoji, [serverId, "Gato", "image/png", bytes, sha, ownerId]);
    await expectSqlState(() => client.query(emoji, [serverId, "gato", "image/png", bytes, sha, ownerId]), "23505");
    await expectSqlState(() => client.query(emoji, [serverId, "x", "image/png", bytes, sha, ownerId]), "23514");
    await expectSqlState(() => client.query(emoji, [serverId, "svg", "image/svg+xml", bytes, sha, ownerId]), "23514");
    await client.query("update server_emojis set deleted_at = now() where server_id = $1", [serverId]);
    await client.query(emoji, [serverId, "gato", "image/png", bytes, sha, ownerId]);

    await expectSqlState(() => client.query("insert into user_blocks (user_id, blocked_id) values ($1, $1)", [ownerId]), "23514");
    await client.query("insert into chat_reads (user_id, room_id, last_read_id) values ($1, $2, $3)", [friendId, roomId, messageId]);
    await expectSqlState(
      () => client.query("insert into chat_reads (user_id, room_id, last_read_id) values ($1, $2, $3)", [friendId, roomId, messageId]),
      "23505",
    );
    await expectSqlState(() => client.query("insert into chat_reads (user_id, last_read_id) values ($1, 1)", [friendId]), "23514");

    await client.query("insert into notify_prefs (user_id, level) values ($1, 'mentions')", [friendId]);
    await expectSqlState(() => client.query("insert into notify_prefs (user_id, level) values ($1, 'all')", [friendId]), "23505");
    await client.query("insert into notify_prefs (user_id, server_id, level) values ($1, $2, 'all')", [friendId, serverId]);
    await expectSqlState(
      () => client.query("insert into notify_prefs (user_id, server_id, room_id, level) values ($1, $2, $3, 'none')", [friendId, serverId, roomId]),
      "23514",
    );
  } finally {
    await db.close();
  }
});
