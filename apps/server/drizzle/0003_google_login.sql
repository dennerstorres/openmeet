-- ADR 0010: sign in with Google through the system browser. Keys stay in the server environment.
-- A person is recognised by the Google `sub`. Nothing here holds a Google or OpenMeet token.

create table user_identities (
  provider text not null,
  subject text not null,
  user_id uuid not null references users (id),
  email text,
  created_at timestamptz not null default now(),
  primary key (provider, subject),
  constraint user_identities_provider check (provider = 'google'),
  constraint user_identities_subject_length check (char_length(subject) between 1 and 255)
);

create unique index user_identities_one_per_user on user_identities (provider, user_id);

-- One browser round trip. The state travels through Google; the poll secret stays in the app.
-- Both are stored as hashes. The PKCE verifier and the nonce never leave the server.
create table oauth_logins (
  id uuid primary key default gen_random_uuid(),
  state_hash text not null,
  poll_hash text not null,
  pkce_verifier text not null,
  nonce text not null,
  user_id uuid references users (id),
  failure text,
  completed_at timestamptz,
  consumed_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint oauth_logins_state_hash_unique unique (state_hash),
  constraint oauth_logins_poll_hash_unique unique (poll_hash),
  constraint oauth_logins_failure_length check (failure is null or char_length(failure) between 1 and 64)
);
