#!/bin/sh
set -eu

if [ "${#AUTH_SECRET}" -lt 32 ]; then
  echo "AUTH_SECRET must be at least 32 characters" >&2
  exit 1
fi

bootstrap="${BOOTSTRAP_TOKEN:-}"
if [ "${#bootstrap}" -lt 20 ]; then
  echo "BOOTSTRAP_TOKEN must be at least 20 characters" >&2
  exit 1
fi

if [ -z "${LIVEKIT_API_KEY:-}" ] || [ -z "${LIVEKIT_API_SECRET:-}" ] || [ -z "${LIVEKIT_URL:-}" ]; then
  echo "LIVEKIT_API_KEY, LIVEKIT_API_SECRET and LIVEKIT_URL are required" >&2
  exit 1
fi

if [ "${POC_JOIN:-0}" = "1" ]; then
  echo "POC_JOIN must stay off in this stack" >&2
  exit 1
fi

DATABASE_URL="$(
  node --input-type=module -e 'const user = process.env.POSTGRES_USER ?? "";
const password = process.env.POSTGRES_PASSWORD ?? "";
const host = process.env.POSTGRES_HOST ?? "";
const name = process.env.POSTGRES_DB ?? "";
if (user.length === 0 || password.length === 0 || host.length === 0 || name.length === 0) process.exit(1);
process.stdout.write(`postgres://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:5432/${encodeURIComponent(name)}`);'
)"
export DATABASE_URL

node dist/db/cli.js
exec node dist/main.js
