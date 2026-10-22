/* Bump this version when changing the public offline page. No application shell,
 * authentication, API, calendar or document response is ever cached here. */
const CACHE = "kd-urniki-pwa-v1";
const OFFLINE = "/offline.html";
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const response = await fetch(OFFLINE, {
        cache: "no-store",
        credentials: "omit",
      });
      if (!response.ok) throw new Error("Offline page unavailable");
      const cache = await caches.open(CACHE);
      await cache.put(OFFLINE, response);
    })(),
  );
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith("kd-urniki-pwa-") && name !== CACHE)
          await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});
self.addEventListener("message", (event) => {
  if (event.data?.type === "ACTIVATE_UPDATE") self.skipWaiting();
});
self.addEventListener("fetch", (event) => {
  // Network-only, including cross-origin Supabase, signed PDF URLs and RSC.
  // Never replace an API failure with HTML or return a previously fetched response.
  event.respondWith(
    (async () => {
      try {
        return await fetch(event.request, { cache: "no-store" });
      } catch (error) {
        const url = new URL(event.request.url);
        if (
          event.request.method === "GET" &&
          event.request.mode === "navigate" &&
          url.origin === self.location.origin
        ) {
          const offline = await caches.match(OFFLINE, { cacheName: CACHE });
          if (offline) return offline;
        }
        throw error;
      }
    })(),
  );
});
