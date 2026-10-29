-- A Google sign-in that would create an account must carry a server invite; only its hash is kept.
alter table oauth_logins add column invite_hash text;
alter table oauth_logins add constraint oauth_logins_invite_hash_length check (invite_hash is null or char_length(invite_hash) between 1 and 128);
