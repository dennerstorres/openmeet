import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { buildApp } from "../src/app.js";
import { applyMigrations, type MigrationClient } from "../src/db/migrate.js";
import { redactInviteUrl } from "../src/invite-page.js";

const bootstrapToken = "unit-test-bootstrap-token";
const authSecret = "unit-test-auth-secret-do-not-leak";
const adminPassword = "correct-horse-battery";
const memberPassword = "member-horse-battery";
const code = "A".repeat(20) + "b_-" + "9".repeat(20);

function pgliteClient(db: PGlite): MigrationClient {
  const client: MigrationClient = {
    exec: async (statement) => {
      await db.exec(statement);
    },
    query: async (statement, params) => {
      const result = await db.query<Record<string, unknown>>(statement, params === undefined ? [] : [...params]);
      return { rows: result.rows.map((row) => ({ ...row })) };
    },
    transaction: async (run) => {
      await db.exec("begin");
      try {
        const value = await run(client);
        await db.exec("commit");
        return value;
      } catch (error) {
        await db.exec("rollback");
        throw error;
      }
    },
  };
  return client;
}

function auth(token: string): { authorization: string } {
  return { authorization: `Bearer ${token}` };
}

test("a pasted code or a link joins the server of the invite and no room", async () => {
  const pg = new PGlite();
  const db = pgliteClient(pg);
  await applyMigrations(db);
  const app = await buildApp({ logger: false, env: { AUTH_SECRET: authSecret, BOOTSTRAP_TOKEN: bootstrapToken }, db });
  try {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/auth/bootstrap",
      payload: { token: bootstrapToken, username: "admin", password: adminPassword, displayName: "Admin" },
    });
    const adminToken = (created.json() as { accessToken: string }).accessToken;
    const server = await app.inject({ method: "POST", url: "/api/v1/servers", headers: auth(adminToken), payload: { name: "Trabalho" } });
    const serverId = (server.json() as { id: string }).id;
    await app.inject({
      method: "POST",
      url: "/api/v1/admin/users",
      headers: auth(adminToken),
      payload: { username: "member", password: memberPassword, displayName: "Member", role: "participant" },
    });
    const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "member", password: memberPassword } });
    const memberToken = (login.json() as { accessToken: string }).accessToken;

    for (const bad of ["", "short", code]) {
      const refused = await app.inject({ method: "POST", url: "/api/v1/invites/accept", headers: auth(memberToken), payload: { code: bad } });
      assert.equal(refused.statusCode, 403, bad);
      assert.equal(refused.json().error, "invalid_invite");
    }
    const anonymous = await app.inject({ method: "POST", url: "/api/v1/invites/accept", payload: { code } });
    assert.equal(anonymous.statusCode, 401);

    const invite = await app.inject({
      method: "POST",
      url: `/api/v1/servers/${serverId}/invites`,
      headers: auth(adminToken),
      payload: { expiresInMinutes: 30, maxUses: 2 },
    });
    const realCode = (invite.json() as { code: string }).code;
    const accepted = await app.inject({ method: "POST", url: "/api/v1/invites/accept", headers: auth(memberToken), payload: { code: realCode } });
    assert.equal(accepted.statusCode, 200);
    assert.deepEqual(accepted.json(), { id: serverId, name: "Trabalho", role: "participant" });
    assert.equal(accepted.body.includes(realCode), false);
    const again = await app.inject({ method: "POST", url: "/api/v1/invites/accept", headers: auth(memberToken), payload: { code: realCode } });
    assert.equal(again.statusCode, 200);
    const uses = await db.query("select use_count from server_invites where server_id = $1", [serverId]);
    assert.equal(uses.rows[0]?.use_count, 1);
    const roomMemberships = await db.query("select count(*)::int as n from memberships");
    assert.equal(roomMemberships.rows[0]?.n, 0);

    await db.query("update server_invites set revoked_at = now() where server_id = $1", [serverId]);
    await app.inject({
      method: "POST",
      url: "/api/v1/admin/users",
      headers: auth(adminToken),
      payload: { username: "late", password: memberPassword, displayName: "Late", role: "participant" },
    });
    const lateLogin = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "late", password: memberPassword } });
    const lateToken = (lateLogin.json() as { accessToken: string }).accessToken;
    const revoked = await app.inject({ method: "POST", url: "/api/v1/invites/accept", headers: auth(lateToken), payload: { code: realCode } });
    assert.equal(revoked.statusCode, 403);
    assert.equal(revoked.json().error, "invalid_invite");
  } finally {
    await app.close();
    await pg.close();
  }
});

test("the browser page only points back to the app and holds no session", async () => {
  const app = await buildApp({ logger: false, env: {} });
  try {
    const shown = await app.inject({ method: "GET", url: `/convite/${code}`, headers: { host: "meet.example" } });
    assert.equal(shown.statusCode, 200);
    assert.match(String(shown.headers["content-type"]), /^text\/html/);
    assert.equal(shown.headers["cache-control"], "no-store");
    assert.equal(shown.headers["referrer-policy"], "no-referrer");
    assert.match(String(shown.headers["content-security-policy"]), /default-src 'none'/);
    assert.equal(shown.body.includes(`href="openmeet://convite?host=meet.example&amp;code=${code}"`), true);
    assert.equal(shown.body.includes("<script"), false);
    assert.equal(shown.headers["set-cookie"], undefined);

    const badCode = await app.inject({ method: "GET", url: "/convite/%3Cscript%3E", headers: { host: "meet.example" } });
    assert.equal(badCode.statusCode, 404);
    assert.equal(badCode.body.includes("<script>"), false);
    assert.equal(badCode.body.includes("openmeet://"), false);

    const badHost = await app.inject({ method: "GET", url: `/convite/${code}`, headers: { host: 'evil.example"><b' } });
    assert.equal(badHost.statusCode, 404);
    assert.equal(badHost.body.includes("evil.example"), false);
  } finally {
    await app.close();
  }
});

test("the request log redacts the invite code", () => {
  assert.equal(redactInviteUrl(`/convite/${code}`), "/convite/[redacted]");
  assert.equal(redactInviteUrl(`/convite/${code}?x=1`), "/convite/[redacted]?x=1");
  assert.equal(redactInviteUrl("/api/v1/servers"), "/api/v1/servers");
});
