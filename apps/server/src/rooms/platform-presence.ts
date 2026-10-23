export type ActivityState = "online" | "away";

interface PresenceEntry {
  state: ActivityState;
  seenAt: number;
}

export class PlatformPresence {
  private readonly entries = new Map<string, PresenceEntry>();

  constructor(
    private readonly ttlMs = 75_000,
    private readonly now: () => number = Date.now,
  ) {}

  touch(serverId: string, userId: string, state: ActivityState): void {
    this.entries.set(`${serverId}:${userId}`, { state, seenAt: this.now() });
  }

  read(serverId: string, userId: string): ActivityState | "offline" {
    const key = `${serverId}:${userId}`;
    const entry = this.entries.get(key);
    if (!entry) return "offline";
    if (this.now() - entry.seenAt > this.ttlMs) {
      this.entries.delete(key);
      return "offline";
    }
    return entry.state;
  }

  drop(serverId: string, userId: string): void {
    this.entries.delete(`${serverId}:${userId}`);
  }

  dropUser(userId: string): void {
    for (const key of this.entries.keys()) {
      if (key.endsWith(`:${userId}`)) this.entries.delete(key);
    }
  }
}
