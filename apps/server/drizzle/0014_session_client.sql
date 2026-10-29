-- ADR 0028: which client holds each session, so the administrator sees every device of an account.
alter table refresh_sessions
  add column client_kind text,
  add column client_version text,
  add column client_agent text,
  add constraint refresh_sessions_client_kind check (client_kind is null or client_kind in ('web', 'desktop')),
  add constraint refresh_sessions_client_version_length check (client_version is null or char_length(client_version) between 1 and 32),
  add constraint refresh_sessions_client_agent_length check (client_agent is null or char_length(client_agent) <= 256);
