import type { DmMember, DmSummary } from "@openmeet/shared";

// ADR 0024: what a DM screen shows that depends only on the DM, the caller and their blocks.

/** The other person of a direct DM, or null in a group. */
export function dmPeer(dm: DmSummary, selfId: string | null): DmMember | null {
  return dm.kind === "direct" ? (dm.members.find((member) => member.id !== selfId) ?? null) : null;
}

/**
 * Why the composer is closed, or null while it is open. A block either way leaves a direct DM read only; only the
 * one who blocked is told so, the blocked one just reads that nobody writes here.
 */
export function dmClosed(dm: DmSummary, selfId: string | null, blocked: ReadonlySet<string>): string | null {
  if (!dm.readOnly) return null;
  const peer = dmPeer(dm, selfId);
  return peer !== null && blocked.has(peer.id)
    ? `Você bloqueou ${peer.label}. As mensagens ficam só para leitura até desbloquear.`
    : "Esta conversa está só para leitura.";
}
