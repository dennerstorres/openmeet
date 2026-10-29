import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

// ADR 0027: the cache rules of pwa/sw.js, run in a sandbox with fake worker globals.
const source = await readFile(new URL("../pwa/sw.js", import.meta.url), "utf8");
const ORIGIN = "https://meet.example.com";

function worker({ active = null, cacheNames = [], network = async () => new Response("net"), windows = [] } = {}) {
  const handlers = {};
  const stores = new Map(cacheNames.map((name) => [name, new Map()]));
  const calls = { skipWaiting: 0, claim: 0, network: [], shown: [], opened: [] };
  const caches = {
    keys: async () => [...stores.keys()],
    delete: async (name) => stores.delete(name),
    open: async (name) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      return {
        match: async (request) => store.get(request.url)?.clone(),
        put: async (request, response) => void store.set(request.url, response),
      };
    },
  };
  const self = {
    location: new URL(ORIGIN),
    registration: { active, showNotification: async (title, options) => void calls.shown.push({ title, ...options }) },
    clients: {
      claim: async () => void calls.claim++,
      matchAll: async () => windows,
      openWindow: async (url) => void calls.opened.push(url),
    },
    skipWaiting: () => void calls.skipWaiting++,
    addEventListener: (type, handler) => (handlers[type] = handler),
  };
  const fetch = async (request) => {
    calls.network.push(request.url);
    return network(request);
  };
  vm.runInNewContext(source.replace("__OPENMEET_BUILD__", "b2"), { self, caches, fetch, Response, URL });

  async function request(path, { mode = "cors", method = "GET" } = {}) {
    let responded;
    handlers.fetch({ request: { url: new URL(path, ORIGIN).href, mode, method }, respondWith: (value) => (responded = value) });
    return responded === undefined ? undefined : await responded;
  }
  async function activate() {
    let done;
    handlers.activate({ waitUntil: (promise) => (done = promise) });
    await done;
  }
  async function push(data) {
    let done;
    handlers.push({ data: data === undefined ? null : { json: () => (typeof data === "string" ? JSON.parse(data) : data) }, waitUntil: (p) => (done = p) });
    await done;
  }
  async function click(data) {
    let done;
    let closed = false;
    handlers.notificationclick({ notification: { data, close: () => (closed = true) }, waitUntil: (p) => (done = p) });
    await done;
    return closed;
  }
  return { handlers, stores, calls, request, activate, push, click };
}

test("the first worker activates at once; an update waits for the page to ask", () => {
  const first = worker();
  first.handlers.install({});
  assert.equal(first.calls.skipWaiting, 1);

  const update = worker({ active: {} });
  update.handlers.install({});
  assert.equal(update.calls.skipWaiting, 0);
  update.handlers.message({ data: "something else" });
  assert.equal(update.calls.skipWaiting, 0);
  update.handlers.message({ data: "openmeet:activate" });
  assert.equal(update.calls.skipWaiting, 1);
});

test("activation deletes other builds' caches and keeps foreign ones", async () => {
  const w = worker({ cacheNames: ["openmeet-b1", "openmeet-b2", "other-app"] });
  await w.activate();
  assert.deepEqual([...w.stores.keys()].sort(), ["openmeet-b2", "other-app"]);
  assert.equal(w.calls.claim, 1);
});

test("pages always come from the network, and offline shows a notice instead of an old build", async () => {
  const online = worker();
  assert.equal(await (await online.request("/", { mode: "navigate" })).text(), "net");
  assert.equal(await (await online.request("/", { mode: "navigate" })).text(), "net");
  assert.equal(online.calls.network.length, 2);

  const offline = worker({ network: async () => Promise.reject(new TypeError("offline")) });
  const page = await offline.request("/servidores/x", { mode: "navigate" });
  assert.equal(page.status, 503);
  assert.match(await page.text(), /Sem conexão/);
});

test("hashed assets are cached; api, media and unhashed files are never touched", async () => {
  const w = worker();
  assert.equal(await (await w.request("/assets/index-AbCd1234.js")).text(), "net");
  assert.equal(await (await w.request("/assets/index-AbCd1234.js")).text(), "net");
  assert.equal(w.calls.network.length, 1);

  for (const path of ["/api/v1/me", "/api/v1/events", "/convite/abc", "/health/live", "/media/selfie_segmenter.tflite", "/manifest.webmanifest", "/sw.js"]) {
    assert.equal(await w.request(path), undefined, path);
  }
  assert.equal(await w.request("/assets/index-AbCd1234.js", { method: "POST" }), undefined);
  assert.equal(await w.request("https://rtc.example.com/assets/x-AbCd1234.js"), undefined);
});

test("a failed asset response is not cached", async () => {
  let status = 500;
  const w = worker({ network: async () => new Response("x", { status }) });
  assert.equal((await w.request("/assets/app-AbCd1234.js")).status, 500);
  status = 200;
  assert.equal((await w.request("/assets/app-AbCd1234.js")).status, 200);
  assert.equal(w.calls.network.length, 2);
});

// ADR 0027 (F14-06): pushes and the click that opens the chat.
const ROOM = "11111111-2222-3333-4444-555555555555";
const payload = { type: "mention", authorName: "Ana", chat: { kind: "room", id: ROOM }, serverId: null, roomName: "Geral", excerpt: "oi @", messageId: "7" };

test("a push shows one notification per chat, and none while a tab is in front", async () => {
  const away = worker({ windows: [{ focused: false, visibilityState: "hidden", url: `${ORIGIN}/` }] });
  await away.push(payload);
  assert.equal(away.calls.shown.length, 1);
  assert.equal(away.calls.shown[0].title, "Ana em #Geral");
  assert.equal(away.calls.shown[0].body, "Mencionou você: oi @");
  assert.equal(away.calls.shown[0].tag, `room:${ROOM}`);
  assert.deepEqual(JSON.parse(JSON.stringify(away.calls.shown[0].data)), { chat: { kind: "room", id: ROOM } });

  const front = worker({ windows: [{ focused: true, visibilityState: "visible", url: `${ORIGIN}/` }] });
  await front.push(payload);
  assert.equal(front.calls.shown.length, 0);

  const bad = worker();
  await bad.push({ ...payload, chat: { kind: "room", id: "../x" } });
  await bad.push("not json");
  assert.equal(bad.calls.shown.length, 0);
});

test("a click focuses an open tab and tells it the chat, or opens one on it", async () => {
  const posted = [];
  const tab = { url: `${ORIGIN}/`, focus: async () => undefined, postMessage: (message) => posted.push(message) };
  const open = worker({ windows: [tab] });
  assert.equal(await open.click({ chat: { kind: "dm", id: ROOM } }), true);
  assert.deepEqual(JSON.parse(JSON.stringify(posted)), [{ type: "openmeet:open-chat", chat: { kind: "dm", id: ROOM } }]);
  assert.deepEqual(open.calls.opened, []);

  const none = worker();
  await none.click({ chat: { kind: "room", id: ROOM } });
  await none.click({ chat: { kind: "room", id: "javascript:alert(1)" } });
  assert.deepEqual(none.calls.opened, [`/?chat=room:${ROOM}`, "/"]);
});
