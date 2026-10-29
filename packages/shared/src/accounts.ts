// S-02: the instance accounts the administrator manages.

export interface InstanceAccount {
  id: string;
  username: string;
  displayName: string;
  role: string;
  disabled: boolean;
}

export function parseAccounts(value: unknown): InstanceAccount[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item: unknown) => {
    if (typeof item !== "object" || item === null) return [];
    const row = item as Record<string, unknown>;
    const { id, username, displayName, role, disabled } = row;
    if (typeof id !== "string" || typeof username !== "string" || typeof displayName !== "string" || typeof role !== "string") return [];
    return [{ id, username, displayName, role, disabled: disabled === true }];
  });
}
