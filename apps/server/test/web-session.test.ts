import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { buildApp } from "../src/app.js";
import { applyMigrations, type MigrationClient } from "../src/db/migrate.js";
import type { RoomMedia } from "../src/rooms/media.js";
import { webMode, webOrigin } from "../src/auth/web-session.js";

const bootstrapToken = "unit-test-bootstrap-token";
const origin = "https://meet.example.com";
const env = {
  AUTH_SECRET: "unit-test-auth-secret-do-not-leak",
  BOOTSTRAP_TOKEN: bootstrapToken,
  API_DOMAIN: "meet.example.com",
  LIVEKIT_URL: "ws://127.0.0.1:7880",
  LIVEKIT_API_KEY: "unit-test-key",
  LIVEKIT_API_SECRET: "unit-test-secret-do-not-leak",
};
const password = "correct-horse-battery";
const web = { "x-openmeet-web": "1", origin };

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

function setCookies(response: LightMyRequestResponse): string[] {
  const header = response.headers["set-cookie"];
  if (header === undefined) return [];
  return Array.isArray(header) ? header : [header];
}

function cookieValue(response: LightMyRequestResponse, name: string): string {
  const line = setCookies(response).find((item) => item.startsWith(`${name}=`)) ?? "";
  return line.slice(name.length + 1, line.indexOf(";"));
}

function jar(response: LightMyRequestResponse): string {
  return `om_access=${cookieValue(response, "om_access")}; om_refresh=${cookieValue(response, "om_refresh")}`;
}

interface World {
  pg: PGlite;
  app: FastifyInstance;
  admin: { accessToken: string; refreshToken: string };
  room: string;
  calls: string[];
}

async function world(): Promise<World> {
  const pg = new PGlite();
  const db = pgliteClient(pg);
  await applyMigrations(db);
  const calls: string[] = [];
  const media: RoomMedia = {
    disconnect: async (room) => {
      calls.push(room);
    },
    closeRoom: async () => {},
  };
  const app = await buildApp({ logger: false, env, db, media });
  const created = await app.inject({
    method: "POST",
    url: "/api/v1/auth/bootstrap",
    payload: { token: bootstrapToken, username: "admin", password, displayName: "Admin" },
  });
  assert.equal(created.statusCode, 201);
  const admin = created.json() as { accessToken: string; refreshToken: string };
  const room = await app.inject({
    method: "POST",
    url: "/api/v1/rooms",
    headers: { authorization: `Bearer ${admin.accessToken}` },
    payload: { name: "sala", slug: "sala", kind: "persistent" },
  });
  return { pg, app, admin, room: (room.json() as { id: string }).id, calls };
}

async function webLogin(app: FastifyInstance): Promise<LightMyRequestResponse> {
  return app.inject({ method: "POST", url: "/api/v1/auth/login", headers: web, payload: { username: "admin", password } });
}

test("the page origin is https://API_DOMAIN, or WEB_ORIGIN only when https or loopback", () => {
  assert.equal(webOrigin({ API_DOMAIN: "Meet.Example.com" }), "https://meet.example.com");
  assert.equal(webOrigin({}), undefined);
  assert.equal(webOrigin({ WEB_ORIGIN: "http://localhost:1420" }), "http://localhost:1420");
  assert.equal(webOrigin({ WEB_ORIGIN: "http://meet.example.com" }), undefined);
  assert.equal(webOrigin({ WEB_ORIGIN: "https://meet.example.com/app" }), undefined);
  // Safe methods may omit Origin; state changes may not.
  assert.equal(webMode({ method: "GET", headers: { "x-openmeet-web": "1" } }, env), "web");
  assert.equal(webMode({ method: "POST", headers: { "x-openmeet-web": "1" } }, env), "rejected");
  assert.equal(webMode({ method: "GET", headers: { "x-openmeet-web": "1", origin: "https://evil.example" } }, env), "rejected");
  assert.equal(webMode({ method: "POST", headers: { "x-openmeet-web": "true", origin } }, env), "rejected");
  assert.equal(webMode({ method: "POST", headers: { origin } }, env), "native");
});

test("web login sets HttpOnly cookies and the body has no token", async () => {
  const w = await world();
  try {
    const response = await webLogin(w.app);
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["cache-control"], "no-store");
    const body = response.json() as Record<string, unknown>;
    assert.deepEqual(Object.keys(body).sort(), ["expiresIn", "user"]);
    assert.equal(response.body.includes(cookieValue(response, "om_access")), false);
    assert.equal(response.body.includes(cookieValue(response, "om_refresh")), false);
    const [access, refresh] = setCookies(response);
    assert.match(access ?? "", /^om_access=[^;]+; Path=\/api; Max-Age=900; HttpOnly; Secure; SameSite=Strict$/);
    assert.match(refresh ?? "", /^om_refresh=[^;]+; Path=\/api\/v1\/auth; Max-Age=2592000; HttpOnly; Secure; SameSite=Strict$/);

    const me = await w.app.inject({ method: "GET", url: "/api/v1/auth/me", headers: { "x-openmeet-web": "1", cookie: jar(response) } });
    assert.equal(me.statusCode, 200);
    assert.equal((me.json() as { username: string }).username, "admin");
  } finally {
    await w.app.close();
    await w.pg.close();
  }
});

test("the cookie does not authenticate without the web header or from another origin", async () => {
  const w = await world();
  try {
    const cookie = jar(await webLogin(w.app));
    const servers = (headers: Record<string, string>) =>
      w.app.inject({ method: "POST", url: "/api/v1/servers", headers: { cookie, ...headers }, payload: { name: "Novo" } });
    assert.equal((await servers({})).statusCode, 401);
    assert.equal((await servers({ "x-openmeet-web": "1" })).statusCode, 403);
    assert.equal((await servers({ "x-openmeet-web": "1", origin: "https://evil.example" })).statusCode, 403);
    assert.equal((await servers({ origin })).statusCode, 401);
    assert.equal((await servers(web)).statusCode, 201);
    // GET without the header is a plain 401, as a link from another site would be.
    assert.equal((await w.app.inject({ method: "GET", url: "/api/v1/servers", headers: { cookie } })).statusCode, 401);

    // Login from another origin answers no session at all.
    const foreign = await w.app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: { "x-openmeet-web": "1", origin: "https://evil.example" },
      payload: { username: "admin", password },
    });
    assert.equal(foreign.statusCode, 403);
    assert.deepEqual(foreign.json(), { error: "origin_rejected" });
    assert.equal(setCookies(foreign).length, 0);
  } finally {
    await w.app.close();
    await w.pg.close();
  }
});

test("Bearer and the cookie together are refused", async () => {
  const w = await world();
  try {
    const cookie = jar(await webLogin(w.app));
    const both = await w.app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: { ...web, cookie, authorization: `Bearer ${w.admin.accessToken}` },
    });
    assert.equal(both.statusCode, 401);
  } finally {
    await w.app.close();
    await w.pg.close();
  }
});

test("web refresh reads the cookie, rotates it, and a reused family clears the cookies", async () => {
  const w = await world();
  try {
    const first = await webLogin(w.app);
    const refreshed = await w.app.inject({ method: "POST", url: "/api/v1/auth/refresh", headers: { ...web, cookie: jar(first) } });
    assert.equal(refreshed.statusCode, 200);
    assert.deepEqual(Object.keys(refreshed.json() as object).sort(), ["expiresIn", "user"]);
    assert.notEqual(cookieValue(refreshed, "om_refresh"), cookieValue(first, "om_refresh"));

    // Replaying the first refresh is reuse: the family dies and the response clears both cookies.
    const reused = await w.app.inject({ method: "POST", url: "/api/v1/auth/refresh", headers: { ...web, cookie: jar(first) } });
    assert.equal(reused.statusCode, 401);
    const cleared = setCookies(reused);
    assert.equal(cleared.length, 2);
    for (const line of cleared) assert.match(line, /^om_(access|refresh)=; .*Max-Age=0; HttpOnly; Secure; SameSite=Strict$/);
    const after = await w.app.inject({ method: "POST", url: "/api/v1/auth/refresh", headers: { ...web, cookie: jar(refreshed) } });
    assert.equal(after.statusCode, 401);

    // Refresh without the web header and without a body token is not a cookie refresh.
    const plain = await w.app.inject({ method: "POST", url: "/api/v1/auth/refresh", headers: { cookie: jar(refreshed) }, payload: {} });
    assert.equal(plain.statusCode, 400);
  } finally {
    await w.app.close();
    await w.pg.close();
  }
});

test("web join returns the room token, and web logout clears the cookies and cuts the room", async () => {
  const w = await world();
  try {
    const signed = await webLogin(w.app);
    const cookie = jar(signed);
    const joined = await w.app.inject({ method: "POST", url: `/api/v1/rooms/${w.room}/join`, headers: { ...web, cookie }, payload: {} });
    assert.equal(joined.statusCode, 200);
    assert.equal(typeof (joined.json() as { token: string }).token, "string");

    const foreign = await w.app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: { "x-openmeet-web": "1", origin: "https://evil.example", cookie },
    });
    assert.equal(foreign.statusCode, 403);

    const out = await w.app.inject({ method: "POST", url: "/api/v1/auth/logout", headers: { ...web, cookie } });
    assert.equal(out.statusCode, 204);
    assert.equal(setCookies(out).length, 2);
    assert.deepEqual(w.calls, [w.room]);
    const refresh = await w.app.inject({ method: "POST", url: "/api/v1/auth/refresh", headers: { ...web, cookie } });
    assert.equal(refresh.statusCode, 401);
  } finally {
    await w.app.close();
    await w.pg.close();
  }
});

test("the .exe keeps Bearer and tokens in the body", async () => {
  const w = await world();
  try {
    const login = await w.app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "admin", password } });
    assert.equal(login.statusCode, 200);
    assert.equal(setCookies(login).length, 0);
    const session = login.json() as { accessToken: string; refreshToken: string };
    assert.equal(typeof session.accessToken, "string");
    assert.equal(typeof session.refreshToken, "string");
    const me = await w.app.inject({ method: "GET", url: "/api/v1/auth/me", headers: { authorization: `Bearer ${session.accessToken}` } });
    assert.equal(me.statusCode, 200);
    const refreshed = await w.app.inject({ method: "POST", url: "/api/v1/auth/refresh", payload: { refreshToken: session.refreshToken } });
    assert.equal(refreshed.statusCode, 200);
    assert.equal(setCookies(refreshed).length, 0);
  } finally {
    await w.app.close();
    await w.pg.close();
  }
});
