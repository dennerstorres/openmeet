-- One realm per database. Store hashes only: no raw password, refresh token, invite code, or bootstrap token.

create type user_role as enum ('admin', 'moderator', 'participant');
create type room_kind as enum ('persistent', 'temporary');
create type membership_role as enum ('moderator', 'participant');
create type registration_mode as enum ('closed', 'invite');

create table users (
  id uuid primary key default gen_random_uuid(),
  username text not null,
  password_hash text not null,
  display_name text not null,
  role user_role not null default 'participant',
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint users_username_unique unique (username),
  constraint users_username_charset check (username ~ '^[A-Za-z0-9_-]{1,64}$'),
  constraint users_password_hash_present check (char_length(password_hash) > 0),
  constraint users_display_name_length check (char_length(display_name) between 1 and 80)
);

create unique index users_single_admin on users (role) where role = 'admin';

create table refresh_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id),
  token_hash text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  replaced_by uuid references refresh_sessions (id),
  created_at timestamptz not null default now(),
  constraint refresh_sessions_token_hash_unique unique (token_hash),
  constraint refresh_sessions_token_hash_present check (char_length(token_hash) > 0)
);

create table rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null,
  kind room_kind not null,
  created_by uuid not null references users (id),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rooms_slug_unique unique (slug),
  constraint rooms_name_length check (char_length(name) between 1 and 80),
  constraint rooms_slug_charset check (slug ~ '^[A-Za-z0-9_-]{1,64}$')
);

create table memberships (
  room_id uuid not null references rooms (id),
  user_id uuid not null references users (id),
  role membership_role not null,
  removed_at timestamptz,
  primary key (room_id, user_id)
);

create table invites (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms (id),
  code_hash text not null,
  created_by uuid not null references users (id),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  max_uses integer not null default 1,
  use_count integer not null default 0,
  created_at timestamptz not null default now(),
  constraint invites_code_hash_unique unique (code_hash),
  constraint invites_code_hash_present check (char_length(code_hash) > 0),
  constraint invites_max_uses_positive check (max_uses >= 1),
  constraint invites_use_count_bounds check (use_count >= 0 and use_count <= max_uses)
);

create table audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references users (id),
  action text not null,
  target_type text not null,
  target_id uuid,
  created_at timestamptz not null default now(),
  constraint audit_events_action_length check (char_length(action) between 1 and 64),
  constraint audit_events_target_type_length check (char_length(target_type) between 1 and 64)
);

create table instance_settings (
  id smallint primary key,
  registration registration_mode not null default 'closed',
  bootstrap_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint instance_settings_singleton check (id = 1)
);

insert into instance_settings (id) values (1);

create table bootstrap_tokens (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  constraint bootstrap_tokens_token_hash_unique unique (token_hash),
  constraint bootstrap_tokens_token_hash_present check (char_length(token_hash) > 0)
);
