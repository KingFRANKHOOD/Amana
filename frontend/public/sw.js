const CACHE_NAME = "amana-cache-v1";
const STATIC_ASSETS = [
  "/",
  "/manifest.json",
];

const API_CACHE_NAME = "amana-api-cache-v1";
const API_CACHE_TTL_MS = 5 * 60 * 1000;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME && key !== API_CACHE_NAME)
          .map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/trades/")) {
    event.respondWith(networkFirstWithCache(request));
    return;
  }

  if (
    request.method === "GET" &&
    (url.pathname.startsWith("/_next/") ||
      url.pathname.match(/\.(js|css|png|jpg|jpeg|gif|svg|ico|woff2?)$/))
  ) {
    event.respondWith(cacheFirst(request));
    return;
  }

  event.respondWith(networkFirstWithCache(request));
});

async function cacheFirst(request: Request): Promise<Response> {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response("Offline", { status: 503 });
  }
}

async function networkFirstWithCache(request: Request): Promise<Response> {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(API_CACHE_NAME);
      const cloned = response.clone();
      const body = await cloned.text();
      cache.put(request, new Response(body, {
        headers: {
          ...Object.fromEntries(cloned.headers.entries()),
          "x-amana-cache-time": String(Date.now()),
        },
      }));
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) {
      const cacheTime = cached.headers.get("x-amana-cache-time");
      if (cacheTime && Date.now() - parseInt(cacheTime) < API_CACHE_TTL_MS) {
        return cached;
      }
    }
    return new Response(JSON.stringify({ offline: true, error: "You are offline" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
}
