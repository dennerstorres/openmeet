-- ADR 0019: server icon, account avatar and per-server nickname/avatar. Bytes stay in Postgres.
create table images (
  id uuid primary key default gen_random_uuid(),
  content_type text not null,
  bytes bytea not null,
  byte_size integer not null,
  width integer not null,
  height integer not null,
  sha256 text not null,
  created_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  constraint images_content_type check (content_type in ('image/png', 'image/jpeg', 'image/webp')),
  constraint images_byte_size check (byte_size between 1 and 262144 and byte_size = octet_length(bytes)),
  constraint images_dimensions check (width between 1 and 512 and height between 1 and 512),
  constraint images_sha256 check (sha256 ~ '^[0-9a-f]{64}$')
);

alter table users add column avatar_image_id uuid references images(id) on delete set null;
alter table servers add column icon_image_id uuid references images(id) on delete set null;
alter table server_members add column nickname text;
alter table server_members add column avatar_image_id uuid references images(id) on delete set null;
alter table server_members add constraint server_members_nickname_safe check (nickname is null or openmeet_is_label(nickname));
