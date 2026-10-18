const JWT_PATTERN = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;

export interface DiagnosticEvent {
  at: string;
  level: "info" | "error";
  message: string;
}

export function sanitizeDiagnostic(message: string, secrets: readonly string[] = []): string {
  let sanitized = message.replace(JWT_PATTERN, "[redacted-jwt]");
  for (const secret of secrets) {
    if (secret.length < 4) {
      continue;
    }
    sanitized = sanitized.split(secret).join("[redacted]");
  }
  return sanitized.slice(0, 300);
}

export function describeMediaError(error: unknown): string {
  if (typeof error === "object" && error !== null && "name" in error && "message" in error) {
    const name = error.name;
    const message = error.message;
    if (typeof name === "string" && typeof message === "string") {
      return sanitizeDiagnostic(`${name}: ${message}`);
    }
  }
  return "unknown media error";
}
