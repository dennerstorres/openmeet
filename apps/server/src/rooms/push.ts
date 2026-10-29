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

// ADR 0027 (F14-05): who gets a push for a new message, and the send itself. The rule follows the
// client's shouldNotify (F13-13) but narrower: only a mention, a reply to you, or a DM at level "all".

/** What the service worker gets. Short on purpose: the push service sees its size, never the text. */
export interface PushPayload {
  type: "mention" | "reply" | "dm";
  authorName: string;
  chat: { kind: "room" | "dm"; id: string };
  serverId: string | null;
  roomName: string | null;
  excerpt: string;
  messageId: string;
}

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** Sends one encrypted push; answers the push service's status code. Tests inject one without network. */
export type PushSender = (target: PushTarget, payload: string) => Promise<number>;

export interface PushMessage {
  id: string;
  roomId: string | null;
  dmId?: string | null;
  body: string;
  deleted: boolean;
  mentions: readonly string[];
  mentionsEveryone: boolean;
  replyTo: { authorId: string } | null;
}

const EXCERPT_CHARS = 120;
const MENTION_TOKEN = /<@[0-9a-f-]{36}>/g;

export function pushExcerpt(body: string): string {
  const flat = body.replace(MENTION_TOKEN, "@").replace(/\s+/g, " ").trim();
  return flat.length > EXCERPT_CHARS ? `${flat.slice(0, EXCERPT_CHARS - 1)}…` : flat;
}

/** The real sender, or undefined while the instance has no VAPID pair. */
export async function webPushSender(env: AppEnv): Promise<PushSender | undefined> {
  const publicKey = vapidPublicKey(env);
  const privateKey = env.VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) return undefined;
  const subject = env.VAPID_SUBJECT?.trim() || "mailto:admin@localhost";
  const webpush = (await import("web-push")).default;
  return async (target, payload) => {
    try {
      const sent = await webpush.sendNotification({ endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } }, payload, {
        vapidDetails: { subject, publicKey, privateKey },
        TTL: 3600,
        urgency: "high",
        timeout: 10_000,
      });
      return sent.statusCode;
    } catch (error) {
      // WebPushError carries the push service's answer; anything else (network, timeout) is a 0.
      const status = typeof error === "object" && error !== null && "statusCode" in error ? Number(error.statusCode) : 0;
      return Number.isFinite(status) ? status : 0;
    }
  };
}

/**
 * The recipients of one message and why: never the author, never someone who blocked the author, never
 * a chat silenced at "none". Rooms push only a mention or a reply; DMs also push any message at "all".
 */
async function recipients(db: MigrationClient, authorId: string, message: PushMessage): Promise<{ userId: string; type: PushPayload["type"] }[]> {
  const found = message.dmId
    ? await db.query(
        `select d.user_id::text as user_id, coalesce(p.level::text, 'all') as level
         from dm_members d left join notify_prefs p on p.user_id = d.user_id and p.dm_id = d.dm_id
         where d.dm_id = $1 and d.left_at is null and d.user_id <> $2
           and not exists (select 1 from user_blocks b where b.user_id = d.user_id and b.blocked_id = $2)`,
        [message.dmId, authorId],
      )
    : await db.query(
        `select m.user_id::text as user_id, coalesce(rp.level::text, sp.level::text, 'mentions') as level
         from rooms r
         join servers s on s.id = r.server_id and s.deleted_at is null
         join server_members m on m.server_id = r.server_id and m.removed_at is null
         left join notify_prefs rp on rp.user_id = m.user_id and rp.room_id = r.id
         left join notify_prefs sp on sp.user_id = m.user_id and sp.server_id = r.server_id
         where r.id = $1 and r.deleted_at is null and m.user_id <> $2
           and not exists (select 1 from user_blocks b where b.user_id = m.user_id and b.blocked_id = $2)`,
        [message.roomId ?? "", authorId],
      );
  return found.rows.flatMap((row): { userId: string; type: PushPayload["type"] }[] => {
    const userId = typeof row.user_id === "string" ? row.user_id : undefined;
    if (!userId || row.level === "none") return [];
    if (message.mentionsEveryone || message.mentions.includes(userId)) return [{ userId, type: "mention" }];
    if (message.replyTo?.authorId === userId) return [{ userId, type: "reply" }];
    if (message.dmId && row.level === "all") return [{ userId, type: "dm" }];
    return [];
  });
}

/** Sends the pushes of one new message. A gone subscription (404/410) is dropped; a delivered one is stamped. */
export async function pushMessage(db: MigrationClient, send: PushSender, author: PublicUser, message: PushMessage): Promise<void> {
  if (message.deleted) return;
  const targets = await recipients(db, author.id, message);
  if (targets.length === 0) return;
  const room = message.roomId ? (await db.query("select name, server_id::text as server_id from rooms where id = $1", [message.roomId])).rows[0] : undefined;
  const base = {
    authorName: author.displayName,
    chat: message.dmId ? { kind: "dm" as const, id: message.dmId } : { kind: "room" as const, id: message.roomId ?? "" },
    serverId: typeof room?.server_id === "string" ? room.server_id : null,
    roomName: typeof room?.name === "string" ? room.name : null,
    excerpt: pushExcerpt(message.body),
    messageId: message.id,
  };
  const subscriptions = await db.query("select user_id::text as user_id, endpoint, p256dh, auth from push_subscriptions where user_id = any($1::uuid[])", [
    targets.map((target) => target.userId),
  ]);
  const typeOf = new Map(targets.map((target) => [target.userId, target.type]));
  await Promise.all(
    subscriptions.rows.map(async (row) => {
      const target = { endpoint: String(row.endpoint), p256dh: String(row.p256dh), auth: String(row.auth) };
      const payload: PushPayload = { type: typeOf.get(String(row.user_id)) ?? "mention", ...base };
      const status = await send(target, JSON.stringify(payload));
      if (status === 404 || status === 410) {
        await db.query("delete from push_subscriptions where endpoint = $1", [target.endpoint]);
      } else if (status >= 200 && status < 300) {
        await db.query("update push_subscriptions set last_used_at = now() where endpoint = $1", [target.endpoint]);
      }
    }),
  );
}
