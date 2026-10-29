// ADR 0027: the web client's service worker. The build fills BUILD with an id of the bundle,
// so every deploy is a new worker with its own cache.
const BUILD = "__OPENMEET_BUILD__";
const CACHE = `openmeet-${BUILD}`;
// Vite names built assets `name-<hash>.ext`: same name, same bytes, so cache-first never serves stale code.
const HASHED = /^\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/;

const OFFLINE = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>OpenMeet</title></head>
<body style="font-family:system-ui,sans-serif;background:#1e1f22;color:#f2f3f5;display:grid;place-items:center;min-height:100vh;margin:0">
<main style="text-align:center;padding:16px"><h1 style="font-size:20px">Sem conexão</h1><p>O OpenMeet precisa de internet. Tente de novo quando a conexão voltar.</p></main></body></html>`;

// The first worker takes over at once (there is nothing to replace). A later one waits in `waiting` until the
// page asks, so a deploy never swaps code under an open call.
self.addEventListener("install", () => {
  if (!self.registration.active) self.skipWaiting();
});

self.addEventListener("message", (event) => {
  if (event.data === "openmeet:activate") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith("openmeet-") && name !== CACHE) await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Pages always come from the network. Offline shows a notice, never an old build talking to a new API.
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => new Response(OFFLINE, { status: 503, headers: { "content-type": "text/html; charset=utf-8" } })));
    return;
  }

  // /api, SSE, invites, health, media and anything unhashed: the worker stays out of the way.
  if (!HASHED.test(url.pathname)) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(request);
      if (hit) return hit;
      const response = await fetch(request);
      if (response.ok) await cache.put(request, response.clone());
      return response;
    })(),
  );
});
