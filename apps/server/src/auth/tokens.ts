import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

const ROLES = new Set(["admin", "moderator", "participant"]);

export function hashSecret(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

export function secretsMatch(left: string, right: string): boolean {
  return timingSafeEqual(createHash("sha256").update(left).digest(), createHash("sha256").update(right).digest());
}

export function newRefreshToken(): string {
  return randomBytes(32).toString("base64url");
}

export function signAccessToken(secret: string, userId: string, now = Date.now()): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ sub: userId, exp: Math.floor(now / 1000) + ACCESS_TOKEN_TTL_SECONDS })).toString("base64url");
  const body = `${header}.${payload}`;
  const signature = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${signature}`;
}

export function readAccessToken(secret: string, token: string, now = Date.now()): string | undefined {
  const parts = token.split(".");
  if (parts.length !== 3) return undefined;
  const [header, payload, signature] = parts;
  if (!header || !payload || !signature) return undefined;
  const expected = createHmac("sha256", secret).update(`${header}.${payload}`).digest();
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return undefined;
  try {
    const claims: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof claims !== "object" || claims === null) return undefined;
    const sub = "sub" in claims ? claims.sub : undefined;
    const exp = "exp" in claims ? claims.exp : undefined;
    const role = "role" in claims ? claims.role : undefined;
    if (typeof sub !== "string" || !/^[0-9a-f-]{36}$/i.test(sub)) return undefined;
    if (typeof exp !== "number" || exp * 1000 <= now) return undefined;
    if (role !== undefined && (typeof role !== "string" || !ROLES.has(role))) return undefined;
    return sub;
  } catch {
    return undefined;
  }
}
