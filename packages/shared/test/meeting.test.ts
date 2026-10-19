import assert from "node:assert/strict";
import test from "node:test";
import { inviteLink, MeetingModel, MemorySessionVault, type InstanceApi, type MeetingMedia } from "../src/index.js";

const roomId = "11111111-1111-4111-8111-111111111111";
const otherRoomId = "33333333-3333-4333-8333-333333333333";
const serverId = "44444444-4444-4444-8444-444444444444";
const otherServerId = "55555555-5555-4555-8555-555555555555";
const userId = "22222222-2222-4222-8222-222222222222";
const accessToken = "access-token-value";
const refreshToken = "refresh-token-value";
const nextRefresh = "refresh-token-rotated";
const joinToken = "header.payload.signature";
const inviteCode = "C".repeat(43);
let presenceDown = false;
const googlePoll = "G".repeat(43);
let googlePolls = 0;
let googleOutcome = "ok";

function session(role: string, refresh = refreshToken) {
  return {
    accessToken,
    refreshToken: refresh,
    expiresIn: 600,
    user: { id: userId, username: "ada", displayName: "Ada", role },
  };
}

function room() {
  return { id: roomId, name: "Sala", slug: "sala", kind: "persistent", ended: false };
}

function apiFor(role: string): { api: InstanceApi; calls: string[]; bodies: unknown[] } {
  const calls: string[] = [];
  const bodies: unknown[] = [];
  const api: InstanceApi = {
    async request(origin, method, path, body) {
      calls.push(`${method} ${origin}${path}`);
      bodies.push(body);
      if (path === "/api/v1/instance") return { status: 200, body: { name: "Sala", apiVersion: "v1", bootstrapOpen: false, googleLogin: true } };
      if (path === "/api/v1/auth/google/start") {
        return { status: 201, body: { authUrl: `https://accounts.google.com/o/oauth2/v2/auth?state=s`, poll: googlePoll, expiresIn: 600 } };
      }
      if (path === "/api/v1/auth/google/poll") {
        googlePolls += 1;
        if ((body as { poll?: string } | null)?.poll !== googlePoll) return { status: 401, body: { error: "invalid_session" } };
        if (googlePolls < 3) return { status: 202, body: { status: "pending" } };
        return googleOutcome === "ok" ? { status: 200, body: session(role) } : { status: 403, body: { error: googleOutcome } };
      }
      if (path === "/api/v1/auth/login" || path === "/api/v1/auth/refresh") {
        return { status: 200, body: session(role, path === "/api/v1/auth/refresh" ? nextRefresh : refreshToken) };
      }
      const serverRole = role === "admin" ? "owner" : "participant";
      if (path === "/api/v1/servers" && method === "GET") {
        return {
          status: 200,
          body: [
            { id: serverId, name: "Trabalho", role: serverRole },
            { id: otherServerId, name: "Família", role: "participant" },
          ],
        };
      }
      if (path === "/api/v1/servers" && method === "POST") return { status: 201, body: { id: otherServerId, name: "Família", role: "owner" } };
      if (path === `/api/v1/servers/${serverId}/rooms` && method === "GET") return { status: 200, body: [room()] };
      if (path === `/api/v1/servers/${otherServerId}/rooms` && method === "GET") {
        return { status: 200, body: [{ id: otherRoomId, name: "Mesa", slug: "geral", kind: "persistent", ended: false }] };
      }
      if (path === `/api/v1/servers/${serverId}/rooms` && method === "POST") return { status: 201, body: room() };
      if (path === `/api/v1/servers/${serverId}/invites` && method === "POST") return { status: 201, body: { id: roomId, code: inviteCode, maxUses: 10 } };
      if (path === "/api/v1/invites/accept") {
        const sent = (body as { code?: string } | null)?.code;
        return sent === inviteCode
          ? { status: 200, body: { id: otherServerId, name: "Família", role: "participant" } }
          : { status: 403, body: { error: "invalid_invite" } };
      }
      if (path === `/api/v1/servers/${serverId}/presence`) {
        if (presenceDown) return { status: 503, body: { error: "presence_unavailable" } };
        return {
          status: 200,
          body: {
            [roomId]: [
              { id: userId, displayName: "Ada" },
              { id: userId, displayName: "Ada" },
              { id: "x", displayName: roomId },
            ],
            bogus: [],
          },
        };
      }
      if (path.endsWith("/join")) return { status: 200, body: { url: "wss://sfu.example", token: joinToken } };
      if (path === "/api/v1/auth/logout") return { status: 204, body: null };
      return { status: 404, body: { error: "room_not_found" } };
    },
  };
  return { api, calls, bodies };
}

function mediaFor(): MeetingMedia & { connects: string[]; disconnects: number } {
  return {
    connects: [],
    disconnects: 0,
    async connect(url: string) {
      this.connects.push(url);
    },
    async disconnect() {
      this.disconnects += 1;
    },
  };
}

test("password is not sent until the instance metadata is accepted", async () => {
  const { api, calls } = apiFor("admin");
  const model = new MeetingModel(api);
  await model.confirmInstance("https://user:secret-token@meet.example");
  assert.equal(calls.length, 0);
  assert.equal(model.snapshot().error, "invalid_api_base");
  assert.equal(JSON.stringify(model.snapshot()).includes("secret-token"), false);

  await model.submitAccount({ mode: "login", username: "ada", password: "correct-horse-battery", displayName: "", token: "" });
  assert.equal(calls.length, 0);

  await model.confirmInstance("https://meet.example/sala");
  assert.equal(calls.length, 0);

  await model.confirmInstance("https://meet.example");
  assert.deepEqual(calls, ["GET https://meet.example/api/v1/instance"]);
  await model.submitAccount({ mode: "login", username: "ada", password: "correct-horse-battery", displayName: "", token: "" });
  assert.equal(calls[1], "POST https://meet.example/api/v1/auth/login");
  assert.equal(
    calls.some((call) => call.includes("other.example")),
    false,
  );
  assert.equal(JSON.stringify(model.snapshot()).includes("correct-horse-battery"), false);
  assert.equal(JSON.stringify(model.snapshot()).includes(accessToken), false);
  assert.equal(model.snapshot().step, "rooms");
  assert.equal(model.snapshot().canCreate, true);
});

test("a saved session is refreshed only on its own instance", async () => {
  const { api, calls, bodies } = apiFor("participant");
  const vault = new MemorySessionVault();
  await vault.save("https://meet.example", refreshToken);
  const model = new MeetingModel(api, mediaFor(), vault);
  await model.confirmInstance("https://other.example");
  assert.equal(calls.includes("POST https://other.example/api/v1/auth/refresh"), false);
  assert.equal(model.snapshot().step, "account");

  await model.changeInstance();
  await model.confirmInstance("https://meet.example");
  assert.equal(calls.includes("POST https://meet.example/api/v1/auth/refresh"), true);
  assert.equal(JSON.stringify(bodies).includes(refreshToken), true);
  assert.equal(JSON.stringify(model.snapshot()).includes(refreshToken), false);
  assert.equal(await vault.load("https://meet.example"), nextRefresh);
  assert.equal(model.snapshot().canCreate, false);
  await model.createRoom("Outra", "outra", "temporary");
  assert.equal(model.snapshot().error, "forbidden");
  assert.equal(
    calls.some((call) => call.startsWith("POST https://meet.example/api/v1/servers")),
    false,
  );
});

test("entering a room connects and leaving returns without a new client", async () => {
  const { api, calls } = apiFor("admin");
  const media = mediaFor();
  const model = new MeetingModel(api, media);
  await model.confirmInstance("http://127.0.0.1:3000");
  await model.submitAccount({ mode: "login", username: "ada", password: "correct-horse-battery", displayName: "", token: "" });
  await model.enterRoom(roomId, "");
  assert.equal(model.snapshot().step, "meeting");
  assert.equal(model.snapshot().activeRoomId, roomId);
  assert.deepEqual(media.connects, ["wss://sfu.example/"]);
  assert.equal(JSON.stringify(model.snapshot()).includes(joinToken), false);
  model.leaveRoom();
  assert.equal(model.snapshot().step, "rooms");
  assert.equal(model.snapshot().activeRoomId, null);
  assert.equal(media.disconnects > 0, true);
  await model.signOut();
  assert.equal(model.snapshot().step, "account");
  assert.equal(calls.includes("POST http://127.0.0.1:3000/api/v1/auth/logout"), true);
  assert.equal(model.snapshot().userLabel, null);
});

test("leaving a persistent room keeps it listed for the same client", async () => {
  const { api, calls } = apiFor("admin");
  const media = mediaFor();
  const model = new MeetingModel(api, media);
  await model.confirmInstance("https://meet.example");
  await model.submitAccount({ mode: "login", username: "ada", password: "correct-horse-battery", displayName: "", token: "" });
  await model.enterRoom(roomId, "");
  model.leaveRoom();
  assert.equal(model.snapshot().step, "rooms");
  assert.equal(model.snapshot().rooms.length, 1);
  assert.equal(model.snapshot().rooms[0]?.id, roomId);
  assert.equal(model.snapshot().rooms[0]?.kind, "persistent");
  assert.equal(model.snapshot().rooms[0]?.ended, false);
  const joins = calls.filter((call) => call.endsWith("/join"));
  assert.equal(joins.length, 1);
  assert.equal(media.disconnects, 2);
});

test("an expired session returns to login", async () => {
  const { api, calls } = apiFor("admin");
  const wrapped = api.request.bind(api);
  let expired = false;
  api.request = (origin, method, path, body, accessToken) => {
    if (expired && path === "/api/v1/servers" && method === "GET") return Promise.resolve({ status: 401, body: { error: "unauthorized" } });
    return wrapped(origin, method, path, body, accessToken);
  };
  const vault = new MemorySessionVault();
  const media = mediaFor();
  const model = new MeetingModel(api, media, vault);
  await model.confirmInstance("https://meet.example");
  await model.submitAccount({ mode: "login", username: "ada", password: "correct-horse-battery", displayName: "", token: "" });
  await model.enterRoom(roomId, "");
  assert.equal(model.snapshot().step, "meeting");
  expired = true;
  await model.reloadRooms();
  assert.equal(model.snapshot().step, "account");
  assert.equal(model.snapshot().error, "unauthorized");
  assert.equal(model.snapshot().userLabel, null);
  assert.equal(model.snapshot().rooms.length, 0);
  assert.equal(await vault.load("https://meet.example"), null);
  assert.equal(calls.includes("POST https://meet.example/api/v1/auth/logout"), true);
  assert.equal(media.disconnects > 0, true);
});

test("media failure stays on the room list", async () => {
  const { api } = apiFor("admin");
  const media: MeetingMedia = {
    async connect() {
      throw new Error("ice failed");
    },
    async disconnect() {},
  };
  const model = new MeetingModel(api, media);
  await model.confirmInstance("https://meet.example");
  await model.submitAccount({ mode: "login", username: "ada", password: "correct-horse-battery", displayName: "", token: "" });
  await model.enterRoom(roomId, "invite-code");
  assert.equal(model.snapshot().step, "rooms");
  assert.equal(model.snapshot().error, "connect_failed");
  assert.equal(JSON.stringify(model.snapshot()).includes("ice failed"), false);
});

test("browsing another server keeps the call and its room", async () => {
  const { api, calls } = apiFor("admin");
  const media = mediaFor();
  const model = new MeetingModel(api, media);
  await model.confirmInstance("https://meet.example");
  await model.submitAccount({ mode: "login", username: "ada", password: "correct-horse-battery", displayName: "", token: "" });
  assert.equal(model.snapshot().selectedServerId, serverId);
  assert.equal(model.snapshot().canCreate, true);
  assert.equal(model.snapshot().canCreateServer, true);
  await model.enterRoom(roomId, "");
  await model.selectServer(otherServerId);
  const browsing = model.snapshot();
  assert.equal(browsing.step, "meeting");
  assert.equal(browsing.selectedServerId, otherServerId);
  assert.equal(browsing.rooms[0]?.id, otherRoomId);
  assert.equal(browsing.activeRoomId, roomId);
  assert.equal(browsing.activeRoomName, "Sala");
  assert.equal(browsing.activeServerId, serverId);
  assert.equal(browsing.canCreate, false);
  assert.equal(media.disconnects, 1);
  await model.createRoom("Outra", "outra", "temporary");
  assert.equal(model.snapshot().error, "forbidden");
  await model.selectServer(serverId);
  await model.createRoom("Outra", "outra", "temporary");
  assert.equal(calls.includes(`POST https://meet.example/api/v1/servers/${serverId}/rooms`), true);
  assert.equal(model.snapshot().step, "meeting");
  await model.selectServer("66666666-6666-4666-8666-666666666666");
  assert.equal(model.snapshot().selectedServerId, serverId);
});

test("only the instance admin creates a server and the new one is selected", async () => {
  const participant = apiFor("participant");
  const denied = new MeetingModel(participant.api, mediaFor());
  await denied.confirmInstance("https://meet.example");
  await denied.submitAccount({ mode: "login", username: "ada", password: "correct-horse-battery", displayName: "", token: "" });
  assert.equal(denied.snapshot().canCreateServer, false);
  await denied.createServer("RPG");
  assert.equal(denied.snapshot().error, "forbidden");
  assert.equal(participant.calls.includes("POST https://meet.example/api/v1/servers"), false);

  const { api, calls } = apiFor("admin");
  const model = new MeetingModel(api, mediaFor());
  await model.confirmInstance("https://meet.example");
  await model.submitAccount({ mode: "login", username: "ada", password: "correct-horse-battery", displayName: "", token: "" });
  await model.createServer("  ");
  assert.equal(model.snapshot().error, "invalid_body");
  await model.createServer("Família");
  assert.equal(calls.includes("POST https://meet.example/api/v1/servers"), true);
  assert.equal(model.snapshot().selectedServerId, otherServerId);
  assert.equal(model.snapshot().rooms[0]?.id, otherRoomId);
});

test("a link from this instance waits for confirmation, then joins the server and no room", async () => {
  const { api, calls } = apiFor("participant");
  const media = mediaFor();
  const model = new MeetingModel(api, media);
  await model.confirmInstance("https://meet.example");
  await model.submitAccount({ mode: "login", username: "ada", password: "correct-horse-battery", displayName: "", token: "" });
  const before = calls.length;
  model.offerInvite(inviteLink("https://meet.example", inviteCode));
  assert.equal(calls.length, before);
  assert.deepEqual(model.snapshot().inviteOffer, { host: "meet.example", sameInstance: true });
  assert.equal(JSON.stringify(model.snapshot()).includes(inviteCode), false);
  await model.acceptInvite();
  assert.equal(calls.includes("POST https://meet.example/api/v1/invites/accept"), true);
  assert.equal(model.snapshot().inviteOffer, null);
  assert.equal(model.snapshot().selectedServerId, otherServerId);
  assert.equal(model.snapshot().step, "rooms");
  assert.equal(media.connects.length, 0);
  assert.equal(
    calls.some((call) => call.endsWith("/join")),
    false,
  );
});

test("a pasted code goes to the current instance, and a bad one is refused locally", async () => {
  const { api, calls } = apiFor("participant");
  const model = new MeetingModel(api, mediaFor());
  model.offerInvite(inviteCode);
  assert.equal(model.snapshot().error, "invalid_api_base");
  await model.confirmInstance("https://meet.example");
  await model.submitAccount({ mode: "login", username: "ada", password: "correct-horse-battery", displayName: "", token: "" });
  model.offerInvite("openmeet://convite?host=meet.example&code=curto");
  assert.equal(model.snapshot().error, "invalid_invite");
  assert.equal(model.snapshot().inviteOffer, null);
  model.offerInvite(`  ${inviteCode} `);
  await model.acceptInvite();
  assert.equal(calls.filter((call) => call === "POST https://meet.example/api/v1/invites/accept").length, 1);
  model.offerInvite("D".repeat(43));
  await model.acceptInvite();
  assert.equal(model.snapshot().error, "invalid_invite");
});

test("a link from another instance switches only after confirmation and accepts after login", async () => {
  const { api, calls, bodies } = apiFor("participant");
  const vault = new MemorySessionVault();
  const model = new MeetingModel(api, mediaFor(), vault);
  await model.confirmInstance("https://meet.example");
  await model.submitAccount({ mode: "login", username: "ada", password: "correct-horse-battery", displayName: "", token: "" });
  model.offerInvite(inviteLink("https://other.example", inviteCode));
  assert.deepEqual(model.snapshot().inviteOffer, { host: "other.example", sameInstance: false });
  assert.equal(
    calls.some((call) => call.includes("other.example")),
    false,
  );
  model.declineInvite();
  assert.equal(model.snapshot().inviteOffer, null);
  assert.equal(model.snapshot().origin, "https://meet.example");

  model.offerInvite(inviteLink("https://other.example", inviteCode));
  await model.acceptInvite();
  assert.equal(model.snapshot().origin, "https://other.example");
  assert.equal(model.snapshot().step, "account");
  assert.equal(model.snapshot().inviteWaiting, "other.example");
  assert.equal(calls.includes("POST https://meet.example/api/v1/auth/logout"), true);
  assert.equal(calls.includes("POST https://other.example/api/v1/invites/accept"), false);
  await model.submitAccount({ mode: "login", username: "ada", password: "correct-horse-battery", displayName: "", token: "" });
  const accepted = calls.indexOf("POST https://other.example/api/v1/invites/accept");
  assert.equal(accepted > calls.indexOf("POST https://other.example/api/v1/auth/login"), true);
  assert.equal(JSON.stringify(bodies[accepted]).includes(inviteCode), true);
  assert.equal(
    calls.some((call) => call === "POST https://meet.example/api/v1/invites/accept"),
    false,
  );
  assert.equal(model.snapshot().inviteWaiting, null);
  assert.equal(model.snapshot().selectedServerId, otherServerId);
});

test("changing instance on purpose drops a waiting invite", async () => {
  const { api, calls } = apiFor("participant");
  const model = new MeetingModel(api, mediaFor());
  await model.confirmInstance("https://meet.example");
  model.offerInvite(inviteCode);
  await model.acceptInvite();
  assert.equal(model.snapshot().inviteWaiting, "meet.example");
  await model.changeInstance();
  assert.equal(model.snapshot().inviteWaiting, null);
  await model.confirmInstance("https://meet.example");
  await model.submitAccount({ mode: "login", username: "ada", password: "correct-horse-battery", displayName: "", token: "" });
  assert.equal(calls.includes("POST https://meet.example/api/v1/invites/accept"), false);
});

test("owners copy a link for the selected server and participants cannot", async () => {
  const participant = apiFor("participant");
  const denied = new MeetingModel(participant.api, mediaFor());
  await denied.confirmInstance("https://meet.example");
  await denied.submitAccount({ mode: "login", username: "ada", password: "correct-horse-battery", displayName: "", token: "" });
  await denied.createInvite();
  assert.equal(denied.snapshot().error, "forbidden");

  const { api, calls } = apiFor("admin");
  const model = new MeetingModel(api, mediaFor());
  await model.confirmInstance("https://meet.example");
  await model.submitAccount({ mode: "login", username: "ada", password: "correct-horse-battery", displayName: "", token: "" });
  await model.createInvite();
  assert.equal(calls.includes(`POST https://meet.example/api/v1/servers/${serverId}/invites`), true);
  assert.equal(model.snapshot().createdInvite, `openmeet://convite?host=meet.example&code=${inviteCode}`);
  await model.signOut();
  assert.equal(model.snapshot().createdInvite, null);
});

test("presence fills the room list, never blocks other work, and hides on failure", async () => {
  const { api } = apiFor("admin");
  const model = new MeetingModel(api, mediaFor());
  await model.confirmInstance("https://meet.example");
  await model.submitAccount({ mode: "login", username: "ada", password: "correct-horse-battery", displayName: "", token: "" });
  assert.equal(model.snapshot().presence, null);
  await model.refreshPresence();
  assert.equal(model.snapshot().pending, false);
  assert.deepEqual(model.snapshot().presence, {
    [roomId]: [
      { id: userId, label: "Ada" },
      { id: "x", label: "Participante" },
    ],
  });
  presenceDown = true;
  try {
    await model.refreshPresence();
    assert.equal(model.snapshot().presence, null);
    assert.equal(model.snapshot().rooms.length, 1);
    assert.equal(model.snapshot().error, null);
  } finally {
    presenceDown = false;
  }
  await model.refreshPresence();
  await model.selectServer(otherServerId);
  assert.equal(model.snapshot().presence, null);
});

test("Google opens only the system browser, polls with its own secret, and lands like a password login", async () => {
  googlePolls = 0;
  googleOutcome = "ok";
  const { api, calls, bodies } = apiFor("participant");
  const vault = new MemorySessionVault();
  const model = new MeetingModel(api, mediaFor(), vault);
  await model.confirmInstance("https://meet.example");
  assert.equal(model.snapshot().googleLogin, true);
  const opened: string[] = [];
  const waits: number[] = [];
  await model.loginWithGoogle(
    async (url) => {
      opened.push(url);
    },
    async (ms) => {
      waits.push(ms);
    },
  );
  assert.deepEqual(opened, ["https://accounts.google.com/o/oauth2/v2/auth?state=s"]);
  assert.equal(googlePolls, 3);
  assert.equal(model.snapshot().step, "rooms");
  assert.equal(model.snapshot().googleWaiting, false);
  assert.equal(await vault.load("https://meet.example"), refreshToken);
  const pollBodies = bodies.filter((_, index) => calls[index] === "POST https://meet.example/api/v1/auth/google/poll");
  assert.equal(
    pollBodies.every((body) => JSON.stringify(body).includes(googlePoll)),
    true,
  );
  assert.equal(opened[0]?.includes(googlePoll), false);
  assert.equal(JSON.stringify(model.snapshot()).includes(googlePoll), false);
});

test("a refused or cancelled Google sign-in stays on the account screen", async () => {
  googlePolls = 0;
  googleOutcome = "account_disabled";
  const { api } = apiFor("participant");
  const model = new MeetingModel(api, mediaFor());
  await model.confirmInstance("https://meet.example");
  await model.loginWithGoogle(
    async () => undefined,
    async () => undefined,
  );
  assert.equal(model.snapshot().step, "account");
  assert.equal(model.snapshot().error, "account_disabled");

  googlePolls = -100;
  googleOutcome = "ok";
  let release: () => void = () => undefined;
  const waiting = model.loginWithGoogle(
    async () => undefined,
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(model.snapshot().googleWaiting, true);
  model.cancelGoogle();
  assert.equal(model.snapshot().googleWaiting, false);
  release();
  await waiting;
  assert.equal(model.snapshot().step, "account");
  assert.equal(model.snapshot().userLabel, null);
});

test("sign out keeps the refresh in the vault until logout answers 204, and repeats after a 502 (S-18)", async () => {
  const { api, calls } = apiFor("admin");
  const wrapped = api.request.bind(api);
  const answers = [502, 0, 204];
  api.request = (origin, method, path, body, accessToken) => {
    if (path === "/api/v1/auth/logout") {
      calls.push(`${method} ${origin}${path}`);
      const status = answers.shift() ?? 204;
      if (status === 0) return Promise.reject(new Error("offline"));
      return Promise.resolve({ status, body: status === 204 ? null : { error: "media_disconnect_failed" } });
    }
    return wrapped(origin, method, path, body, accessToken);
  };
  const waits: number[] = [];
  let release: () => void = () => {};
  const settled = new Promise<void>((resolve) => {
    release = resolve;
  });
  const vault = new MemorySessionVault();
  const model = new MeetingModel(api, mediaFor(), vault, async (ms) => {
    waits.push(ms);
  });
  await model.confirmInstance("https://meet.example");
  await model.submitAccount({ mode: "login", username: "ada", password: "correct-horse-battery", displayName: "", token: "" });
  const saved = await vault.load("https://meet.example");
  assert.notEqual(saved, null);
  const clear = vault.clear.bind(vault);
  vault.clear = async (origin) => {
    await clear(origin);
    release();
  };
  await model.signOut();
  assert.equal(model.snapshot().step, "account");
  assert.equal(model.snapshot().userLabel, null);
  await settled;
  assert.equal(calls.filter((call) => call.endsWith("/api/v1/auth/logout")).length, 3);
  assert.deepEqual(waits, [1000, 2000]);
  assert.equal(await vault.load("https://meet.example"), null);
});

test("a revoked refresh on the next start finishes the pending logout before the vault forgets it", async () => {
  const { api, calls } = apiFor("admin");
  const wrapped = api.request.bind(api);
  api.request = (origin, method, path, body, accessToken) => {
    if (path === "/api/v1/auth/refresh") return Promise.resolve({ status: 401, body: { error: "invalid_session" } });
    return wrapped(origin, method, path, body, accessToken);
  };
  const vault = new MemorySessionVault();
  await vault.save("https://meet.example", "r".repeat(43));
  const model = new MeetingModel(api, mediaFor(), vault, async () => {});
  await model.confirmInstance("https://meet.example");
  assert.equal(calls.includes("POST https://meet.example/api/v1/auth/logout"), true);
  assert.equal(await vault.load("https://meet.example"), null);
  assert.equal(model.snapshot().step, "account");
});
