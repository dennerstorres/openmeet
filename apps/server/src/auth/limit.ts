import { secretsMatch } from "./tokens.js";

export interface AttemptGate {
  allow(key: string, now: number): boolean;
}

/**
 * S-11: at most `maxKeys` keys. Past it, expired keys go first; if it is still full, a new key is refused
 * and not stored. A live key is never dropped to make room, so nobody resets their own count.
 */
export function createAttemptGate(limit: number, windowMs: number, maxKeys = 4096): AttemptGate {
  const hits = new Map<string, number[]>();
  return {
    allow(key, now) {
      if (!hits.has(key) && hits.size >= maxKeys) {
        for (const [stored, times] of hits) {
          if (times.every((at) => now - at >= windowMs)) hits.delete(stored);
        }
        if (hits.size >= maxKeys) return false;
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
    if (code <= 32 || code === 127 || value[index] === ",") return true;
  }
  return false;
}

/** The request did not come through the stack proxy, or the proxy sent no usable address. */
export class ProxyRejected extends Error {
  constructor() {
    super("proxy_rejected");
    this.name = "ProxyRejected";
  }
}

export interface ProxyHeaders {
  forwarded: string | undefined;
  proxy: string | undefined;
}

/**
 * Behind the proxy, the address counts only when the request carries the proxy secret, and then
 * only the single hop Caddy wrote. The socket address is never used instead: behind Caddy it is
 * Caddy itself, and one bucket would lock everyone out.
 */
export function clientAddress(ip: string, headers: ProxyHeaders, policy: Pick<AttemptPolicy, "trustProxy" | "proxySecret">): string {
  if (!policy.trustProxy) return ip;
  const secret = policy.proxySecret ?? "";
  if (secret.length < 32 || headers.proxy === undefined || !secretsMatch(headers.proxy, secret)) throw new ProxyRejected();
  const hop = headers.forwarded?.trim() ?? "";
  if (rejectedHop(hop)) throw new ProxyRejected();
  return hop;
}

export function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value.length === 1 ? value[0] : undefined;
  return value;
}

export interface AttemptOptions {
  now?: () => number;
  loginLimit?: number;
  loginIpLimit?: number;
  bootstrapLimit?: number;
  refreshIpLimit?: number;
  refreshTokenLimit?: number;
  maxKeys?: number;
  windowMs?: number;
}

export interface AttemptPolicy {
  now: () => number;
  trustProxy: boolean;
  proxySecret: string | undefined;
  loginUser: AttemptGate;
  loginIp: AttemptGate;
  bootstrap: AttemptGate;
  refreshIp: AttemptGate;
  refreshToken: AttemptGate;
}

export function attemptPolicy(trustProxy: boolean, options?: AttemptOptions, proxySecret: string | undefined = undefined): AttemptPolicy {
  const windowMs = options?.windowMs ?? 15 * 60 * 1000;
  const maxKeys = options?.maxKeys ?? 4096;
  return {
    now: options?.now ?? (() => Date.now()),
    trustProxy,
    proxySecret,
    loginUser: createAttemptGate(options?.loginLimit ?? 8, windowMs, maxKeys),
    loginIp: createAttemptGate(options?.loginIpLimit ?? 30, windowMs, maxKeys),
    bootstrap: createAttemptGate(options?.bootstrapLimit ?? 5, windowMs, maxKeys),
    refreshIp: createAttemptGate(options?.refreshIpLimit ?? 60, windowMs, maxKeys),
    refreshToken: createAttemptGate(options?.refreshTokenLimit ?? 12, windowMs, maxKeys),
  };
}
