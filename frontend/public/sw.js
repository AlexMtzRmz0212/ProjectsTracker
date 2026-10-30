// Service worker: makes the app installable and quick to open. Only the app's own files are cached;
// /api never is, so timers and data always come from the server.
const CACHE = "pt-shell-v1";
const SHELL = "/";
const MAX_ASSETS = 120; // each deploy adds new hashed files; the oldest are dropped past this

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.add(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

async function put(request, response) {
  const cache = await caches.open(CACHE);
  await cache.put(request, response);
  const keys = await cache.keys(); // oldest first
  const assets = keys.filter((key) => new URL(key.url).pathname.startsWith("/assets/"));
  await Promise.all(assets.slice(0, Math.max(0, assets.length - MAX_ASSETS)).map((key) => cache.delete(key)));
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  // The page itself: always the latest from the network, the cached copy only when offline
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) event.waitUntil(put(SHELL, response.clone()));
          return response;
        })
        .catch(() => caches.match(SHELL))
    );
    return;
  }

  // Built files carry a content hash in their name, so a cached one never goes stale
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((response) => {
            if (response.ok) event.waitUntil(put(request, response.clone()));
            return response;
          })
      )
    );
  }
});
