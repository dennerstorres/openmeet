-- ADR 0027: Web Push subscriptions of the web client. One row per browser; an account may have several.
create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  constraint push_subscriptions_endpoint_length check (char_length(endpoint) between 1 and 2048),
  constraint push_subscriptions_p256dh_length check (char_length(p256dh) between 1 and 128),
  constraint push_subscriptions_auth_length check (char_length(auth) between 1 and 64),
  constraint push_subscriptions_user_agent_length check (user_agent is null or char_length(user_agent) <= 256)
);

create unique index push_subscriptions_endpoint on push_subscriptions (endpoint);
create index push_subscriptions_user on push_subscriptions (user_id);
