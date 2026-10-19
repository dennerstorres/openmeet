import { sql } from "drizzle-orm";
import { boolean, check, integer, pgEnum, pgTable, primaryKey, smallint, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow();

export const userRole = pgEnum("user_role", ["admin", "moderator", "participant"]);
export const roomKind = pgEnum("room_kind", ["persistent", "temporary"]);
export const membershipRole = pgEnum("membership_role", ["moderator", "participant"]);
export const registrationMode = pgEnum("registration_mode", ["closed", "invite"]);
export const serverRole = pgEnum("server_role", ["owner", "moderator", "participant"]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    username: text("username").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    displayName: text("display_name").notNull(),
    role: userRole("role").notNull().default("participant"),
    disabledAt: timestamp("disabled_at", { withTimezone: true, mode: "date" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("users_single_admin")
      .on(table.role)
      .where(sql`${table.role} = 'admin'`),
    check("users_username_charset", sql`${table.username} ~ '^[A-Za-z0-9_-]{1,64}$'`),
    check("users_password_hash_present", sql`char_length(${table.passwordHash}) > 0`),
    check("users_display_name_length", sql`char_length(${table.displayName}) between 1 and 80`),
  ],
);

export const refreshSessions = pgTable(
  "refresh_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
    replacedBy: uuid("replaced_by").references((): AnyPgColumn => refreshSessions.id),
    createdAt: createdAt(),
  },
  (table) => [check("refresh_sessions_token_hash_present", sql`char_length(${table.tokenHash}) > 0`)],
);

export const servers = pgTable(
  "servers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [check("servers_name_length", sql`char_length(${table.name}) between 1 and 80`)],
);

export const serverMembers = pgTable(
  "server_members",
  {
    serverId: uuid("server_id")
      .notNull()
      .references(() => servers.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    role: serverRole("role").notNull(),
    removedAt: timestamp("removed_at", { withTimezone: true, mode: "date" }),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.serverId, table.userId] }),
    uniqueIndex("server_members_single_owner")
      .on(table.serverId)
      .where(sql`${table.role} = 'owner'`),
  ],
);

export const serverInvites = pgTable(
  "server_invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    serverId: uuid("server_id")
      .notNull()
      .references(() => servers.id),
    codeHash: text("code_hash").notNull().unique(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
    maxUses: integer("max_uses").notNull().default(1),
    useCount: integer("use_count").notNull().default(0),
    createdAt: createdAt(),
  },
  (table) => [
    check("server_invites_code_hash_present", sql`char_length(${table.codeHash}) > 0`),
    check("server_invites_max_uses_positive", sql`${table.maxUses} >= 1`),
    check("server_invites_use_count_bounds", sql`${table.useCount} >= 0 and ${table.useCount} <= ${table.maxUses}`),
  ],
);

export const rooms = pgTable(
  "rooms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    serverId: uuid("server_id")
      .notNull()
      .references(() => servers.id),
    slug: text("slug").notNull(),
    kind: roomKind("kind").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    endedAt: timestamp("ended_at", { withTimezone: true, mode: "date" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("rooms_server_slug_unique").on(table.serverId, table.slug),
    check("rooms_name_length", sql`char_length(${table.name}) between 1 and 80`),
    check("rooms_slug_charset", sql`${table.slug} ~ '^[A-Za-z0-9_-]{1,64}$'`),
  ],
);

export const memberships = pgTable(
  "memberships",
  {
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    role: membershipRole("role").notNull(),
    removedAt: timestamp("removed_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [primaryKey({ columns: [table.roomId, table.userId] })],
);

export const invites = pgTable(
  "invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id),
    codeHash: text("code_hash").notNull().unique(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
    maxUses: integer("max_uses").notNull().default(1),
    useCount: integer("use_count").notNull().default(0),
    createdAt: createdAt(),
  },
  (table) => [
    check("invites_code_hash_present", sql`char_length(${table.codeHash}) > 0`),
    check("invites_max_uses_positive", sql`${table.maxUses} >= 1`),
    check("invites_use_count_bounds", sql`${table.useCount} >= 0 and ${table.useCount} <= ${table.maxUses}`),
  ],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: uuid("target_id"),
    createdAt: createdAt(),
  },
  (table) => [
    check("audit_events_action_length", sql`char_length(${table.action}) between 1 and 64`),
    check("audit_events_target_type_length", sql`char_length(${table.targetType}) between 1 and 64`),
  ],
);

export const instanceSettings = pgTable(
  "instance_settings",
  {
    id: smallint("id").primaryKey(),
    registration: registrationMode("registration").notNull().default("closed"),
    bootstrapCompleted: boolean("bootstrap_completed").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [check("instance_settings_singleton", sql`${table.id} = 1`)],
);

export const bootstrapTokens = pgTable(
  "bootstrap_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true, mode: "date" }),
    createdAt: createdAt(),
  },
  (table) => [check("bootstrap_tokens_token_hash_present", sql`char_length(${table.tokenHash}) > 0`)],
);

export const schemaMigrations = pgTable("schema_migrations", {
  name: text("name").primaryKey(),
  appliedAt: timestamp("applied_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export const identityEnums = [userRole, roomKind, membershipRole, registrationMode, serverRole] as const;

export const identityTables = [
  users,
  refreshSessions,
  servers,
  serverMembers,
  serverInvites,
  rooms,
  memberships,
  invites,
  auditEvents,
  instanceSettings,
  bootstrapTokens,
  schemaMigrations,
] as const;
