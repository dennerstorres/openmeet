// S-02: the instance accounts the administrator manages.

// ADR 0028: one signed-in device of an account.
export interface AccountDevice {
  client: "web" | "desktop" | null;
  version: string | null;
  agent: string | null;
  signedInAt: string;
  lastSeenAt: string;
}

export interface InstanceAccount {
  id: string;
  username: string;
  displayName: string;
  role: string;
  disabled: boolean;
  sessions: AccountDevice[];
}

function optional(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function parseSessions(value: unknown): AccountDevice[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item: unknown) => {
    if (typeof item !== "object" || item === null) return [];
    const row = item as Record<string, unknown>;
    const { client, signedInAt, lastSeenAt } = row;
    if (typeof signedInAt !== "string" || typeof lastSeenAt !== "string") return [];
    return [
      {
        client: client === "web" || client === "desktop" ? client : null,
        version: optional(row.version),
        agent: optional(row.agent),
        signedInAt,
        lastSeenAt,
      },
    ];
  });
}

export function parseAccounts(value: unknown): InstanceAccount[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item: unknown) => {
    if (typeof item !== "object" || item === null) return [];
    const row = item as Record<string, unknown>;
    const { id, username, displayName, role, disabled } = row;
    if (typeof id !== "string" || typeof username !== "string" || typeof displayName !== "string" || typeof role !== "string") return [];
    return [{ id, username, displayName, role, disabled: disabled === true, sessions: parseSessions(row.sessions) }];
  });
}
