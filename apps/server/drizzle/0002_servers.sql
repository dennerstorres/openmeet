-- ADR 0007: a instance holds many servers; each room belongs to one server.
-- Access is decided by server membership. Room memberships and room invites stay only as history.

create type server_role as enum ('owner', 'moderator', 'participant');

create table servers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid not null references users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint servers_name_length check (char_length(name) between 1 and 80)
);

create table server_members (
  server_id uuid not null references servers (id),
  user_id uuid not null references users (id),
  role server_role not null,
  removed_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (server_id, user_id)
);

create unique index server_members_single_owner on server_members (server_id) where role = 'owner';

create table server_invites (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references servers (id),
  code_hash text not null,
  created_by uuid not null references users (id),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  max_uses integer not null default 1,
  use_count integer not null default 0,
  created_at timestamptz not null default now(),
  constraint server_invites_code_hash_unique unique (code_hash),
  constraint server_invites_code_hash_present check (char_length(code_hash) > 0),
  constraint server_invites_max_uses_positive check (max_uses >= 1),
  constraint server_invites_use_count_bounds check (use_count >= 0 and use_count <= max_uses)
);

alter table rooms add column server_id uuid references servers (id);

-- Existing rooms move into "Geral". The instance admin owns it; without an admin, the oldest room creator does.
insert into servers (name, created_by)
select 'Geral', coalesce((select id from users where role = 'admin'), (select created_by from rooms order by created_at, id limit 1))
where exists (select 1 from rooms);

update rooms set server_id = (select id from servers order by created_at limit 1) where server_id is null;

insert into server_members (server_id, user_id, role)
select s.id, s.created_by, 'owner' from servers s;

insert into server_members (server_id, user_id, role)
select distinct (select id from servers order by created_at limit 1), m.user_id, 'participant'::server_role
from memberships m
where m.removed_at is null
  and m.user_id <> (select created_by from servers order by created_at limit 1);

update invites set revoked_at = now() where revoked_at is null;

alter table rooms alter column server_id set not null;
alter table rooms drop constraint rooms_slug_unique;
alter table rooms add constraint rooms_server_slug_unique unique (server_id, slug);
