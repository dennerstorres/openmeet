import type { MigrationClient } from "../db/migrate.js";
import type { PublicUser } from "../auth/service.js";
import type { AppEnv } from "../poc-join.js";
import { RoomError } from "./service.js";

// ADR 0027 (F14-04): Web Push subscriptions of the web client. The server will POST to these endpoints
// (F14-05), so only the browsers' own push services are accepted: never an address the caller picks.

/** Hosts of the push services of Chrome/Edge/Android, Firefox, Edge on Windows and Safari. */
const PUSH_HOSTS = ["fcm.googleapis.com", "updates.push.services.mozilla.com", "push.services.mozilla.com", "notify.windows.com", "push.apple.com"];
const MAX_PER_USER = 20;
// P-256 public key (65 bytes) and auth secret (16 bytes), base64url without padding.
const P256DH = /^[A-Za-z0-9_-]{87}$/;
const AUTH = /^[A-Za-z0-9_-]{22}$/;

export interface PushSubscriptionInput {
  endpoint: unknown;
  p256dh: unknown;
  auth: unknown;
  userAgent?: unknown;
}

/** The public VAPID key, or undefined while the instance has no key pair. */
export function vapidPublicKey(env: AppEnv): string | undefined {
  const key = env.VAPID_PUBLIC_KEY?.trim();
  const secret = env.VAPID_PRIVATE_KEY?.trim();
  return key && secret && /^[A-Za-z0-9_-]{87}$/.test(key) ? key : undefined;
}

export function pushEndpoint(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 2048) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.port !== "") return undefined;
  const host = url.hostname.toLowerCase();
  return PUSH_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`)) ? url.href : undefined;
}

export async function savePushSubscription(db: MigrationClient, actor: PublicUser, input: PushSubscriptionInput): Promise<void> {
  const endpoint = pushEndpoint(input.endpoint);
  const p256dh = typeof input.p256dh === "string" && P256DH.test(input.p256dh) ? input.p256dh : undefined;
  const auth = typeof input.auth === "string" && AUTH.test(input.auth) ? input.auth : undefined;
  if (!endpoint || !p256dh || !auth) throw new RoomError("invalid_subscription");
  const userAgent = typeof input.userAgent === "string" ? input.userAgent.slice(0, 256) : null;

  await db.transaction(async (tx) => {
    // The same browser signing into another account moves its subscription: pushes follow who is signed in.
    await tx.query(
      `insert into push_subscriptions (user_id, endpoint, p256dh, auth, user_agent) values ($1, $2, $3, $4, $5)
       on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
         user_agent = excluded.user_agent, created_at = now(), last_used_at = null`,
      [actor.id, endpoint, p256dh, auth, userAgent],
    );
    // Keep the newest few per account; old browsers that never unsubscribed fall off.
    await tx.query(
      `delete from push_subscriptions where user_id = $1 and id not in
         (select id from push_subscriptions where user_id = $1 order by created_at desc limit ${MAX_PER_USER})`,
      [actor.id],
    );
  });
}

/** Removes the caller's own subscription. Someone else's endpoint is left alone and the answer is the same. */
export async function deletePushSubscription(db: MigrationClient, actor: PublicUser, endpointInput: unknown): Promise<void> {
  const endpoint = pushEndpoint(endpointInput);
  if (!endpoint) throw new RoomError("invalid_subscription");
  await db.query("delete from push_subscriptions where user_id = $1 and endpoint = $2", [actor.id, endpoint]);
}
