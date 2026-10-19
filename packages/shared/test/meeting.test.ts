import assert from "node:assert/strict";
import test from "node:test";
import { MeetingModel, MemorySessionVault, type InstanceApi, type MeetingMedia } from "../src/index.js";

const roomId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const accessToken = "access-token-value";
const refreshToken = "refresh-token-value";
const nextRefresh = "refresh-token-rotated";
const joinToken = "header.payload.signature";

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
      if (path === "/api/v1/instance") return { status: 200, body: { name: "Sala", apiVersion: "v1", bootstrapOpen: false } };
      if (path === "/api/v1/auth/login" || path === "/api/v1/auth/refresh") {
        return { status: 200, body: session(role, path === "/api/v1/auth/refresh" ? nextRefresh : refreshToken) };
      }
      if (path === "/api/v1/rooms" && method === "GET") return { status: 200, body: [room()] };
      if (path === "/api/v1/rooms" && method === "POST") return { status: 201, body: room() };
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
    calls.some((call) => call === "POST https://meet.example/api/v1/rooms"),
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
