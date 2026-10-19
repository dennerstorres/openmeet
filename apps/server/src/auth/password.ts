import { hash, verify } from "@node-rs/argon2";

// OWASP Argon2id minimum: 19 MiB, 2 passes, 1 lane. Algorithm 2 is Argon2id.
export const ARGON2ID_PARAMETERS = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
  algorithm: 2,
} as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2ID_PARAMETERS);
}

export function verifyPassword(encoded: string, password: string): Promise<boolean> {
  return verify(encoded, password);
}
