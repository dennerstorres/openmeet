export interface AttemptGate {
  allow(key: string, now: number): boolean;
}

export function createAttemptGate(limit: number, windowMs: number): AttemptGate {
  const hits = new Map<string, number[]>();
  return {
    allow(key, now) {
      if (hits.size > 1000) {
        for (const [stored, times] of hits) {
          if (times.every((at) => now - at >= windowMs)) hits.delete(stored);
        }
      }
      const recent = (hits.get(key) ?? []).filter((at) => now - at < windowMs);
      if (recent.length >= limit) {
        hits.set(key, recent);
        return false;
      }
      recent.push(now);
      hits.set(key, recent);
      return true;
    },
  };
}

function rejectedHop(value: string): boolean {
  if (value.length === 0 || value.length > 64) return true;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 32 || code === 127) return true;
  }
  return false;
}

export function clientAddress(ip: string, forwarded: string | undefined, trustProxy: boolean): string {
  if (!trustProxy) return ip;
  const first = forwarded?.split(",")[0]?.trim() ?? "";
  if (rejectedHop(first)) return ip;
  return first;
}

export interface AttemptOptions {
  now?: () => number;
  loginLimit?: number;
  loginIpLimit?: number;
  bootstrapLimit?: number;
  windowMs?: number;
}

export interface AttemptPolicy {
  now: () => number;
  trustProxy: boolean;
  loginUser: AttemptGate;
  loginIp: AttemptGate;
  bootstrap: AttemptGate;
}

export function attemptPolicy(trustProxy: boolean, options?: AttemptOptions): AttemptPolicy {
  const windowMs = options?.windowMs ?? 15 * 60 * 1000;
  return {
    now: options?.now ?? (() => Date.now()),
    trustProxy,
    loginUser: createAttemptGate(options?.loginLimit ?? 8, windowMs),
    loginIp: createAttemptGate(options?.loginIpLimit ?? 30, windowMs),
    bootstrap: createAttemptGate(options?.bootstrapLimit ?? 5, windowMs),
  };
}
