import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

// ADR 0027: the cache rules of pwa/sw.js, run in a sandbox with fake worker globals.
const source = await readFile(new URL("../pwa/sw.js", import.meta.url), "utf8");
const ORIGIN = "https://meet.example.com";

function worker({ active = null, cacheNames = [], network = async () => new Response("net") } = {}) {
  const handlers = {};
  const stores = new Map(cacheNames.map((name) => [name, new Map()]));
  const calls = { skipWaiting: 0, claim: 0, network: [] };
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
    registration: { active },
    clients: { claim: async () => void calls.claim++ },
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
  return { handlers, stores, calls, request, activate };
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
