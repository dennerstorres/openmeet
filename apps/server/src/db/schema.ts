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
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow();
const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({ dataType: () => "bytea" });

export const userRole = pgEnum("user_role", ["admin", "moderator", "participant"]);
export const roomKind = pgEnum("room_kind", ["persistent", "temporary"]);
export const roomChannel = pgEnum("room_channel", ["voice", "text"]);
export const dmKind = pgEnum("dm_kind", ["direct", "group"]);
export const notifyLevel = pgEnum("notify_level", ["all", "mentions", "none"]);
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
    clientKind: text("client_kind"),
    clientVersion: text("client_version"),
    clientAgent: text("client_agent"),
    createdAt: createdAt(),
  },
  (table) => [
    index("refresh_sessions_family").on(table.familyId),
    check("refresh_sessions_token_hash_present", sql`char_length(${table.tokenHash}) > 0`),
    check("refresh_sessions_client_kind", sql`${table.clientKind} is null or ${table.clientKind} in ('web', 'desktop')`),
    check("refresh_sessions_client_version_length", sql`${table.clientVersion} is null or char_length(${table.clientVersion}) between 1 and 32`),
    check("refresh_sessions_client_agent_length", sql`${table.clientAgent} is null or char_length(${table.clientAgent}) <= 256`),
  ],
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
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
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
    channel: roomChannel("channel").notNull().default("voice"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    endedAt: timestamp("ended_at", { withTimezone: true, mode: "date" }),
    mediaClosedAt: timestamp("media_closed_at", { withTimezone: true, mode: "date" }),
    lastJoinNbf: bigint("last_join_nbf", { mode: "bigint" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("rooms_server_slug_unique")
      .on(table.serverId, table.slug)
      .where(sql`${table.deletedAt} is null`),
    check("rooms_name_safe", sql`openmeet_is_label(${table.name})`),
    check("rooms_slug_charset", sql`${table.slug} ~ '^[A-Za-z0-9_-]{1,64}$'`),
    check("rooms_text_persistent", sql`${table.channel} = 'voice' or ${table.kind} = 'persistent'`),
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

// ADR 0021. A sound belongs to its uploader; server_sounds lists it in each library that holds it.
export const sounds = pgTable(
  "sounds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references((): AnyPgColumn => users.id),
    name: text("name").notNull(),
    bytes: bytea("bytes").notNull(),
    byteSize: integer("byte_size").notNull(),
    durationMs: integer("duration_ms").notNull(),
    sha256: text("sha256").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index("sounds_owner").on(table.ownerId),
    check("sounds_name_safe", sql`openmeet_is_label(${table.name}) and char_length(${table.name}) <= 32`),
    check("sounds_byte_size", sql`${table.byteSize} between 46 and 960044 and ${table.byteSize} = octet_length(${table.bytes})`),
    check("sounds_duration", sql`${table.durationMs} between 1 and 20000`),
    check("sounds_sha256", sql`${table.sha256} ~ '^[0-9a-f]{64}$'`),
  ],
);

export const serverSounds = pgTable(
  "server_sounds",
  {
    serverId: uuid("server_id")
      .notNull()
      .references((): AnyPgColumn => servers.id, { onDelete: "cascade" }),
    soundId: uuid("sound_id")
      .notNull()
      .references((): AnyPgColumn => sounds.id, { onDelete: "cascade" }),
    addedBy: uuid("added_by")
      .notNull()
      .references((): AnyPgColumn => users.id),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.serverId, table.soundId] }), index("server_sounds_sound").on(table.soundId)],
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
    inviteHash: text("invite_hash"),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
    consumedAt: timestamp("consumed_at", { withTimezone: true, mode: "date" }),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    check("oauth_logins_failure_length", sql`${table.failure} is null or char_length(${table.failure}) between 1 and 64`),
    check("oauth_logins_invite_hash_length", sql`${table.inviteHash} is null or char_length(${table.inviteHash}) between 1 and 128`),
  ],
);

// ADR 0024. A direct DM is unique per pair through direct_key ("<smaller uuid>:<larger uuid>").
export const dmChannels = pgTable(
  "dm_channels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: dmKind("kind").notNull(),
    name: text("name"),
    directKey: text("direct_key").unique(),
    createdBy: uuid("created_by")
      .notNull()
      .references((): AnyPgColumn => users.id),
    createdAt: createdAt(),
  },
  (table) => [
    check("dm_channels_name_safe", sql`${table.name} is null or (openmeet_is_label(${table.name}) and char_length(${table.name}) <= 100)`),
    check(
      "dm_channels_direct_shape",
      sql`(${table.kind} = 'direct' and ${table.name} is null and ${table.directKey} is not null and ${table.directKey} ~ '^[0-9a-f-]{36}:[0-9a-f-]{36}$') or (${table.kind} = 'group' and ${table.directKey} is null)`,
    ),
  ],
);

export const dmMembers = pgTable(
  "dm_members",
  {
    dmId: uuid("dm_id")
      .notNull()
      .references(() => dmChannels.id),
    userId: uuid("user_id")
      .notNull()
      .references((): AnyPgColumn => users.id),
    joinedAt: timestamp("joined_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    leftAt: timestamp("left_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    primaryKey({ columns: [table.dmId, table.userId] }),
    index("dm_members_user")
      .on(table.userId)
      .where(sql`${table.leftAt} is null`),
  ],
);

// A message belongs to exactly one text room or DM. Removing it clears the body; the row stays.
export const messages = pgTable(
  "messages",
  {
    id: bigint("id", { mode: "bigint" }).primaryKey().generatedAlwaysAsIdentity(),
    roomId: uuid("room_id").references((): AnyPgColumn => rooms.id),
    dmId: uuid("dm_id").references(() => dmChannels.id),
    authorId: uuid("author_id")
      .notNull()
      .references((): AnyPgColumn => users.id),
    body: text("body").notNull(),
    replyToId: bigint("reply_to_id", { mode: "bigint" }).references((): AnyPgColumn => messages.id),
    mentionsEveryone: boolean("mentions_everyone").notNull().default(false),
    pinnedAt: timestamp("pinned_at", { withTimezone: true, mode: "date" }),
    pinnedBy: uuid("pinned_by").references((): AnyPgColumn => users.id),
    editedAt: timestamp("edited_at", { withTimezone: true, mode: "date" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
    createdAt: createdAt(),
  },
  (table) => [
    index("messages_room")
      .on(table.roomId, table.id)
      .where(sql`${table.roomId} is not null`),
    index("messages_dm")
      .on(table.dmId, table.id)
      .where(sql`${table.dmId} is not null`),
    index("messages_pinned")
      .on(table.roomId, table.dmId, table.pinnedAt)
      .where(sql`${table.pinnedAt} is not null`),
    index("messages_search")
      .using("gin", sql`to_tsvector('simple', ${table.body})`)
      .where(sql`${table.deletedAt} is null`),
    check("messages_one_target", sql`num_nonnulls(${table.roomId}, ${table.dmId}) = 1`),
    check("messages_body_length", sql`char_length(${table.body}) <= 4000`),
    check("messages_removed_empty", sql`${table.deletedAt} is null or (${table.body} = '' and ${table.pinnedAt} is null)`),
    check("messages_pin_pair", sql`(${table.pinnedAt} is null) = (${table.pinnedBy} is null)`),
  ],
);

export const messageMentions = pgTable(
  "message_mentions",
  {
    messageId: bigint("message_id", { mode: "bigint" })
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references((): AnyPgColumn => users.id),
  },
  (table) => [primaryKey({ columns: [table.messageId, table.userId] }), index("message_mentions_user").on(table.userId, table.messageId)],
);

// emoji is the Unicode text itself or "custom:<server_emojis.id>".
export const messageReactions = pgTable(
  "message_reactions",
  {
    messageId: bigint("message_id", { mode: "bigint" })
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references((): AnyPgColumn => users.id),
    emoji: text("emoji").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.messageId, table.userId, table.emoji] }),
    check(
      "message_reactions_emoji",
      sql`${table.emoji} ~ '^custom:[0-9a-f-]{36}$' or (char_length(${table.emoji}) between 1 and 16 and ${table.emoji} !~ '[[:space:][:cntrl:]<>:]')`,
    ),
  ],
);

// Uploaded before its message: message_id stays null until sent, and orphans are cleaned after 24 h.
export const messageAttachments = pgTable(
  "message_attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    messageId: bigint("message_id", { mode: "bigint" }).references(() => messages.id, { onDelete: "cascade" }),
    uploaderId: uuid("uploader_id")
      .notNull()
      .references((): AnyPgColumn => users.id),
    name: text("name").notNull(),
    contentType: text("content_type").notNull(),
    bytes: bytea("bytes").notNull(),
    byteSize: integer("byte_size").notNull(),
    width: integer("width"),
    height: integer("height"),
    sha256: text("sha256").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index("message_attachments_message")
      .on(table.messageId)
      .where(sql`${table.messageId} is not null`),
    index("message_attachments_orphan")
      .on(table.createdAt)
      .where(sql`${table.messageId} is null`),
    check("message_attachments_name", sql`char_length(${table.name}) between 1 and 255 and ${table.name} !~ '[[:cntrl:]/\\\\]'`),
    check("message_attachments_content_type", sql`char_length(${table.contentType}) between 1 and 127`),
    check("message_attachments_byte_size", sql`${table.byteSize} between 1 and 26214400 and ${table.byteSize} = octet_length(${table.bytes})`),
    check(
      "message_attachments_dimensions",
      sql`(${table.width} is null) = (${table.height} is null) and (${table.width} is null or (${table.width} between 1 and 16384 and ${table.height} between 1 and 16384))`,
    ),
    check("message_attachments_sha256", sql`${table.sha256} ~ '^[0-9a-f]{64}$'`),
  ],
);

export const serverEmojis = pgTable(
  "server_emojis",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    serverId: uuid("server_id")
      .notNull()
      .references((): AnyPgColumn => servers.id),
    name: text("name").notNull(),
    contentType: text("content_type").notNull(),
    animated: boolean("animated").notNull(),
    bytes: bytea("bytes").notNull(),
    byteSize: integer("byte_size").notNull(),
    sha256: text("sha256").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references((): AnyPgColumn => users.id),
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("server_emojis_name_unique")
      .on(table.serverId, sql`lower(${table.name})`)
      .where(sql`${table.deletedAt} is null`),
    check("server_emojis_name", sql`${table.name} ~ '^[A-Za-z0-9_]{2,32}$'`),
    check("server_emojis_content_type", sql`${table.contentType} in ('image/png', 'image/gif', 'image/webp')`),
    check("server_emojis_byte_size", sql`${table.byteSize} between 1 and 262144 and ${table.byteSize} = octet_length(${table.bytes})`),
    check("server_emojis_sha256", sql`${table.sha256} ~ '^[0-9a-f]{64}$'`),
  ],
);

export const userBlocks = pgTable(
  "user_blocks",
  {
    userId: uuid("user_id")
      .notNull()
      .references((): AnyPgColumn => users.id),
    blockedId: uuid("blocked_id")
      .notNull()
      .references((): AnyPgColumn => users.id),
    createdAt: createdAt(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.blockedId] }), check("user_blocks_not_self", sql`${table.userId} <> ${table.blockedId}`)],
);

export const chatReads = pgTable(
  "chat_reads",
  {
    userId: uuid("user_id")
      .notNull()
      .references((): AnyPgColumn => users.id),
    roomId: uuid("room_id").references((): AnyPgColumn => rooms.id),
    dmId: uuid("dm_id").references(() => dmChannels.id),
    lastReadId: bigint("last_read_id", { mode: "bigint" }).notNull(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("chat_reads_room")
      .on(table.userId, table.roomId)
      .where(sql`${table.roomId} is not null`),
    uniqueIndex("chat_reads_dm")
      .on(table.userId, table.dmId)
      .where(sql`${table.dmId} is not null`),
    check("chat_reads_one_target", sql`num_nonnulls(${table.roomId}, ${table.dmId}) = 1`),
  ],
);

// No target is the account default; otherwise one server, room or DM.
export const notifyPrefs = pgTable(
  "notify_prefs",
  {
    userId: uuid("user_id")
      .notNull()
      .references((): AnyPgColumn => users.id),
    serverId: uuid("server_id").references((): AnyPgColumn => servers.id),
    roomId: uuid("room_id").references((): AnyPgColumn => rooms.id),
    dmId: uuid("dm_id").references(() => dmChannels.id),
    level: notifyLevel("level").notNull(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("notify_prefs_scope").on(
      table.userId,
      sql`coalesce(${table.serverId}, ${table.roomId}, ${table.dmId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
    ),
    check("notify_prefs_target", sql`num_nonnulls(${table.serverId}, ${table.roomId}, ${table.dmId}) <= 1`),
  ],
);

// ADR 0027: one Web Push subscription per browser of the web client.
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references((): AnyPgColumn => users.id),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    uniqueIndex("push_subscriptions_endpoint").on(table.endpoint),
    index("push_subscriptions_user").on(table.userId),
    check("push_subscriptions_endpoint_length", sql`char_length(${table.endpoint}) between 1 and 2048`),
    check("push_subscriptions_p256dh_length", sql`char_length(${table.p256dh}) between 1 and 128`),
    check("push_subscriptions_auth_length", sql`char_length(${table.auth}) between 1 and 64`),
    check("push_subscriptions_user_agent_length", sql`${table.userAgent} is null or char_length(${table.userAgent}) <= 256`),
  ],
);

export const schemaMigrations = pgTable("schema_migrations", {
  name: text("name").primaryKey(),
  appliedAt: timestamp("applied_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export const identityEnums = [userRole, roomKind, membershipRole, registrationMode, serverRole, roomChannel, dmKind, notifyLevel] as const;

export const identityTables = [
  users,
  refreshSessions,
  servers,
  serverMembers,
  serverInvites,
  rooms,
  images,
  sounds,
  serverSounds,
  memberships,
  invites,
  auditEvents,
  instanceSettings,
  bootstrapTokens,
  userIdentities,
  oauthLogins,
  dmChannels,
  dmMembers,
  messages,
  messageMentions,
  messageReactions,
  messageAttachments,
  serverEmojis,
  userBlocks,
  chatReads,
  notifyPrefs,
  pushSubscriptions,
  schemaMigrations,
] as const;
