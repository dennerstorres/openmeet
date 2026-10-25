import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  customType,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow();
const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({ dataType: () => "bytea" });

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
    livekitHold: boolean("livekit_hold").notNull().default(false),
    avatarImageId: uuid("avatar_image_id").references((): AnyPgColumn => images.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("users_single_admin")
      .on(table.role)
      .where(sql`${table.role} = 'admin'`),
    check("users_username_charset", sql`${table.username} ~ '^[A-Za-z0-9_-]{1,64}$'`),
    check("users_password_hash_present", sql`char_length(${table.passwordHash}) > 0`),
    check("users_display_name_safe", sql`openmeet_is_label(${table.displayName})`),
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
    familyId: uuid("family_id").notNull(),
    createdAt: createdAt(),
  },
  (table) => [index("refresh_sessions_family").on(table.familyId), check("refresh_sessions_token_hash_present", sql`char_length(${table.tokenHash}) > 0`)],
);

export const servers = pgTable(
  "servers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    allowInvisible: boolean("allow_invisible").notNull().default(false),
    managersSeeInvisible: boolean("managers_see_invisible").notNull().default(false),
    iconImageId: uuid("icon_image_id").references((): AnyPgColumn => images.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [check("servers_name_safe", sql`openmeet_is_label(${table.name})`)],
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
    mediaCutAt: timestamp("media_cut_at", { withTimezone: true, mode: "date" }),
    lastJoinNbf: bigint("last_join_nbf", { mode: "bigint" }),
    presenceMode: text("presence_mode").notNull().default("visible"),
    nickname: text("nickname"),
    avatarImageId: uuid("avatar_image_id").references((): AnyPgColumn => images.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.serverId, table.userId] }),
    uniqueIndex("server_members_single_owner")
      .on(table.serverId)
      .where(sql`${table.role} = 'owner'`),
    check("server_members_presence_mode", sql`${table.presenceMode} in ('visible', 'invisible')`),
    check("server_members_nickname_safe", sql`${table.nickname} is null or openmeet_is_label(${table.nickname})`),
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
    mediaClosedAt: timestamp("media_closed_at", { withTimezone: true, mode: "date" }),
    lastJoinNbf: bigint("last_join_nbf", { mode: "bigint" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("rooms_server_slug_unique").on(table.serverId, table.slug),
    check("rooms_name_safe", sql`openmeet_is_label(${table.name})`),
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

// ADR 0019. One row per uploaded icon or avatar; replacing it deletes the old row.
export const images = pgTable(
  "images",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contentType: text("content_type").notNull(),
    bytes: bytea("bytes").notNull(),
    byteSize: integer("byte_size").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    sha256: text("sha256").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references((): AnyPgColumn => users.id),
    createdAt: createdAt(),
  },
  (table) => [
    check("images_content_type", sql`${table.contentType} in ('image/png', 'image/jpeg', 'image/webp')`),
    check("images_byte_size", sql`${table.byteSize} between 1 and 262144 and ${table.byteSize} = octet_length(${table.bytes})`),
    check("images_dimensions", sql`${table.width} between 1 and 512 and ${table.height} between 1 and 512`),
    check("images_sha256", sql`${table.sha256} ~ '^[0-9a-f]{64}$'`),
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

export const userIdentities = pgTable(
  "user_identities",
  {
    provider: text("provider").notNull(),
    subject: text("subject").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    email: text("email"),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.provider, table.subject] }),
    uniqueIndex("user_identities_one_per_user").on(table.provider, table.userId),
    check("user_identities_provider", sql`${table.provider} = 'google'`),
    check("user_identities_subject_length", sql`char_length(${table.subject}) between 1 and 255`),
  ],
);

export const oauthLogins = pgTable(
  "oauth_logins",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    stateHash: text("state_hash").notNull().unique(),
    pollHash: text("poll_hash").notNull().unique(),
    pkceVerifier: text("pkce_verifier").notNull(),
    nonce: text("nonce").notNull(),
    userId: uuid("user_id").references(() => users.id),
    failure: text("failure"),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
    consumedAt: timestamp("consumed_at", { withTimezone: true, mode: "date" }),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [check("oauth_logins_failure_length", sql`${table.failure} is null or char_length(${table.failure}) between 1 and 64`)],
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
  images,
  memberships,
  invites,
  auditEvents,
  instanceSettings,
  bootstrapTokens,
  userIdentities,
  oauthLogins,
  schemaMigrations,
] as const;
