-- S-04: a removal or an ended room is not done until the SFU confirms the cut.
-- Until then no new token is signed for that person or room. last_join_nbf is the newest `nbf`
-- signed, so the cut revokes strictly after it. livekit_hold is written by logout and deactivation (S-18).

alter table rooms add column media_closed_at timestamptz;
alter table rooms add column last_join_nbf bigint;
alter table server_members add column media_cut_at timestamptz;
alter table server_members add column last_join_nbf bigint;
alter table users add column livekit_hold boolean not null default false;

-- Tokens signed before this migration lived ten minutes; past removals and ends count as cut.
update rooms set media_closed_at = ended_at where ended_at is not null;
update server_members set media_cut_at = removed_at where removed_at is not null;
