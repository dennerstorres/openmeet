import { spawnSync } from "node:child_process";

/** The icacls arguments that leave only the current Windows user with read and write. */
export function ownerOnlyArgs(filePath, env = process.env) {
  const user = env.USERNAME ?? "";
  if (user.length === 0) throw new Error("USERNAME is not set");
  const owner = (env.USERDOMAIN ?? "").length > 0 ? `${env.USERDOMAIN}\\${user}` : user;
  return [filePath, "/inheritance:r", "/grant:r", `${owner}:(R,W)`];
}

/**
 * S-17: the stack secrets and the backup are readable only by the operator.
 * On Linux the file mode 0o600 does it; on Windows that mode is not an ACL, so icacls removes inheritance.
 * Read and write, not read only: host.mjs rewrites the .env and a new backup replaces the old one.
 */
export function restrictToOwner(filePath, platform = process.platform, run = spawnSync) {
  if (platform !== "win32") return;
  const result = run("icacls", ownerOnlyArgs(filePath), { encoding: "utf8", windowsHide: true });
  if (result.status !== 0) throw new Error("could not restrict the file to the current user");
}
