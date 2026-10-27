-- ADR 0023: removing a server or a room marks it and keeps the row, so audit events, invites and
-- memberships keep their references. A removed room frees its slug for a new room in the same server.
alter table servers add column deleted_at timestamptz;
alter table rooms add column deleted_at timestamptz;

alter table rooms drop constraint rooms_server_slug_unique;
create unique index rooms_server_slug_unique on rooms (server_id, slug) where deleted_at is null;
