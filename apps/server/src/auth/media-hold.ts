import type { MigrationClient } from "../db/migrate.js";
import type { RoomMedia } from "../rooms/media.js";

/** Strictly after every `nbf` already signed. With none recorded, after this second (S-04). */
export function revokeAfter(nbf: unknown): bigint {
  if (typeof nbf === "bigint") return nbf + 1n;
  if ((typeof nbf === "number" || typeof nbf === "string") && /^[0-9]+$/.test(String(nbf))) return BigInt(nbf) + 1n;
  return BigInt(Math.floor(Date.now() / 1000)) + 1n;
}

export interface HeldRoom {
  room: string;
  revokeAt: bigint;
}

/**
 * S-18: every open room of every server where the account is an active member.
 * The room token carries no session id, so the cut reaches every device of the account.
 * Run it inside the transaction that holds the user row.
 */
export async function heldRooms(tx: MigrationClient, userId: string): Promise<HeldRoom[]> {
  const found = await tx.query(
    `select r.id, m.last_join_nbf
     from server_members m
     join rooms r on r.server_id = m.server_id and r.ended_at is null
     where m.user_id = $1 and m.removed_at is null
     order by r.id
     for update of m`,
    [userId],
  );
  return found.rows.flatMap((row) => (typeof row.id === "string" ? [{ room: row.id, revokeAt: revokeAfter(row.last_join_nbf) }] : []));
}

/**
 * Called after the commit that turned `livekit_hold` on. Lowers the hold only when every room confirmed.
 * A 404 from the SFU is absence and already counts as confirmed inside `RoomMedia`.
 */
export async function releaseHold(db: MigrationClient, userId: string, media: RoomMedia | undefined, rooms: readonly HeldRoom[]): Promise<boolean> {
  // Without an SFU configured no room token can be signed either, so there is nothing to cut.
  if (media) {
    let failed = false;
    for (const held of rooms) {
      try {
        await media.disconnect(held.room, userId, held.revokeAt);
      } catch {
        failed = true;
      }
    }
    if (failed) return false;
  }
  await db.query("update users set livekit_hold = false where id = $1", [userId]);
  return true;
}
