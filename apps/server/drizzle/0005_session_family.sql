-- S-03: a refresh token presented after it was replaced revokes its whole rotation family.
-- Other families of the same account (another device) stay alive.
-- Rolling the image back to code that inserts refresh rows without family_id breaks: restore the backup instead.

alter table refresh_sessions add column family_id uuid;

-- The root of each replaced_by chain names the family of every session that came from it.
with recursive chain (id, family_id) as (
  select s.id, s.id
  from refresh_sessions s
  where not exists (select 1 from refresh_sessions p where p.replaced_by = s.id)
  union all
  select next.id, chain.family_id
  from chain
  join refresh_sessions current on current.id = chain.id
  join refresh_sessions next on next.id = current.replaced_by
)
update refresh_sessions r set family_id = chain.family_id from chain where chain.id = r.id;

alter table refresh_sessions alter column family_id set not null;
create index refresh_sessions_family on refresh_sessions (family_id);
