-- ADR 0021: server sound libraries. A sound belongs to the account that sent it and is listed by every
-- server library that holds it. Bytes are canonical WAV (PCM 16-bit, mono, 24 kHz, up to 20 s) in Postgres.
create table sounds (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users(id),
  name text not null,
  bytes bytea not null,
  byte_size integer not null,
  duration_ms integer not null,
  sha256 text not null,
  created_at timestamptz not null default now(),
  constraint sounds_name_safe check (openmeet_is_label(name) and char_length(name) <= 32),
  constraint sounds_byte_size check (byte_size between 46 and 960044 and byte_size = octet_length(bytes)),
  constraint sounds_duration check (duration_ms between 1 and 20000),
  constraint sounds_sha256 check (sha256 ~ '^[0-9a-f]{64}$')
);

create index sounds_owner on sounds (owner_id);

create table server_sounds (
  server_id uuid not null references servers(id) on delete cascade,
  sound_id uuid not null references sounds(id) on delete cascade,
  added_by uuid not null references users(id),
  added_at timestamptz not null default now(),
  primary key (server_id, sound_id)
);

create index server_sounds_sound on server_sounds (sound_id);
