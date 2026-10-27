-- ADR 0024: text rooms, direct messages, reactions, attachments and server emojis. Messages are kept
-- forever; removing a message clears its body and drops its attachments, the row stays as "removed".
create type room_channel as enum ('voice', 'text');
create type dm_kind as enum ('direct', 'group');
create type notify_level as enum ('all', 'mentions', 'none');

alter table rooms add column channel room_channel not null default 'voice';
alter table rooms add constraint rooms_text_persistent check (channel = 'voice' or kind = 'persistent');

-- A direct DM is unique per pair: direct_key is "<smaller uuid>:<larger uuid>". A group has up to 10
-- members, enforced by the API.
create table dm_channels (
  id uuid primary key default gen_random_uuid(),
  kind dm_kind not null,
  name text,
  direct_key text unique,
  created_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  constraint dm_channels_name_safe check (name is null or (openmeet_is_label(name) and char_length(name) <= 100)),
  constraint dm_channels_direct_shape check (
    (kind = 'direct' and name is null and direct_key is not null and direct_key ~ '^[0-9a-f-]{36}:[0-9a-f-]{36}$')
    or (kind = 'group' and direct_key is null)
  )
);

create table dm_members (
  dm_id uuid not null references dm_channels(id),
  user_id uuid not null references users(id),
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  primary key (dm_id, user_id)
);

create index dm_members_user on dm_members (user_id) where left_at is null;

create table messages (
  id bigint generated always as identity primary key,
  room_id uuid references rooms(id),
  dm_id uuid references dm_channels(id),
  author_id uuid not null references users(id),
  body text not null,
  reply_to_id bigint references messages(id),
  mentions_everyone boolean not null default false,
  pinned_at timestamptz,
  pinned_by uuid references users(id),
  edited_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  constraint messages_one_target check (num_nonnulls(room_id, dm_id) = 1),
  constraint messages_body_length check (char_length(body) <= 4000),
  constraint messages_removed_empty check (deleted_at is null or (body = '' and pinned_at is null)),
  constraint messages_pin_pair check ((pinned_at is null) = (pinned_by is null))
);

create index messages_room on messages (room_id, id) where room_id is not null;
create index messages_dm on messages (dm_id, id) where dm_id is not null;
create index messages_pinned on messages (room_id, dm_id, pinned_at) where pinned_at is not null;
create index messages_search on messages using gin (to_tsvector('simple', body)) where deleted_at is null;

create table message_mentions (
  message_id bigint not null references messages(id) on delete cascade,
  user_id uuid not null references users(id),
  primary key (message_id, user_id)
);

create index message_mentions_user on message_mentions (user_id, message_id);

-- emoji is the Unicode text itself or "custom:<server_emojis.id>".
create table message_reactions (
  message_id bigint not null references messages(id) on delete cascade,
  user_id uuid not null references users(id),
  emoji text not null,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji),
  constraint message_reactions_emoji check (
    emoji ~ '^custom:[0-9a-f-]{36}$' or (char_length(emoji) between 1 and 16 and emoji !~ '[[:space:][:cntrl:]<>:]')
  )
);

-- An attachment is uploaded before its message; message_id stays null until it is sent and orphans are
-- cleaned after 24 h. The 25 MiB ceiling is a hard stop; ATTACHMENT_MAX_BYTES sets the real limit.
create table message_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id bigint references messages(id) on delete cascade,
  uploader_id uuid not null references users(id),
  name text not null,
  content_type text not null,
  bytes bytea not null,
  byte_size integer not null,
  width integer,
  height integer,
  sha256 text not null,
  created_at timestamptz not null default now(),
  constraint message_attachments_name check (char_length(name) between 1 and 255 and name !~ '[[:cntrl:]/\\]'),
  constraint message_attachments_content_type check (char_length(content_type) between 1 and 127),
  constraint message_attachments_byte_size check (byte_size between 1 and 26214400 and byte_size = octet_length(bytes)),
  constraint message_attachments_dimensions check ((width is null) = (height is null) and (width is null or (width between 1 and 16384 and height between 1 and 16384))),
  constraint message_attachments_sha256 check (sha256 ~ '^[0-9a-f]{64}$')
);

create index message_attachments_message on message_attachments (message_id) where message_id is not null;
create index message_attachments_orphan on message_attachments (created_at) where message_id is null;

create table server_emojis (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references servers(id),
  name text not null,
  content_type text not null,
  animated boolean not null,
  bytes bytea not null,
  byte_size integer not null,
  sha256 text not null,
  created_by uuid not null references users(id),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  constraint server_emojis_name check (name ~ '^[A-Za-z0-9_]{2,32}$'),
  constraint server_emojis_content_type check (content_type in ('image/png', 'image/gif', 'image/webp')),
  constraint server_emojis_byte_size check (byte_size between 1 and 262144 and byte_size = octet_length(bytes)),
  constraint server_emojis_sha256 check (sha256 ~ '^[0-9a-f]{64}$')
);

create unique index server_emojis_name_unique on server_emojis (server_id, lower(name)) where deleted_at is null;

create table user_blocks (
  user_id uuid not null references users(id),
  blocked_id uuid not null references users(id),
  created_at timestamptz not null default now(),
  primary key (user_id, blocked_id),
  constraint user_blocks_not_self check (user_id <> blocked_id)
);

create table chat_reads (
  user_id uuid not null references users(id),
  room_id uuid references rooms(id),
  dm_id uuid references dm_channels(id),
  last_read_id bigint not null,
  updated_at timestamptz not null default now(),
  constraint chat_reads_one_target check (num_nonnulls(room_id, dm_id) = 1)
);

create unique index chat_reads_room on chat_reads (user_id, room_id) where room_id is not null;
create unique index chat_reads_dm on chat_reads (user_id, dm_id) where dm_id is not null;

-- No target is the account default; otherwise one server, room or DM.
create table notify_prefs (
  user_id uuid not null references users(id),
  server_id uuid references servers(id),
  room_id uuid references rooms(id),
  dm_id uuid references dm_channels(id),
  level notify_level not null,
  updated_at timestamptz not null default now(),
  constraint notify_prefs_target check (num_nonnulls(server_id, room_id, dm_id) <= 1)
);

create unique index notify_prefs_scope on notify_prefs (user_id, coalesce(server_id, room_id, dm_id, '00000000-0000-0000-0000-000000000000'::uuid));
