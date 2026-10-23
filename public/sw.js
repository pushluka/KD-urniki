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
  if (event.data?.type === "PUSH_CAPABILITIES")
    event.ports?.[0]?.postMessage({ push: true });
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

self.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      let data;
      try {
        data = event.data?.json();
      } catch {
        return;
      }
      const uuid =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (
        !data ||
        !uuid.test(data.eventId) ||
        !uuid.test(data.recipientId) ||
        !uuid.test(data.notificationId)
      )
        return;
      const history = uuid.test(data.historyId ?? "")
        ? `&obvestilo=${data.historyId}`
        : "";
      const url = `/?dogodek=${data.eventId}&prejemnik=${data.recipientId}${history}`;
      await self.registration.showNotification("KD Urniki", {
        body:
          typeof data.body === "string"
            ? data.body.slice(0, 180)
            : "Vaš razpored je spremenjen. Odprite aplikacijo.",
        icon: "/icons/icon-192.png",
        tag: `kd-${data.notificationId}`,
        renotify: false,
        data: { url },
      });
    })(),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const target = new URL(
        event.notification.data?.url ?? "/",
        self.location.origin,
      );
      // Never open a URL supplied by an arbitrary notification payload/provider.
      if (target.origin !== self.location.origin || target.pathname !== "/")
        return;
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      const existing = windows.find((client) => client.url === target.href);
      // Reuse only the exact target; do not navigate an open unsaved form.
      if (existing) {
        existing.postMessage({ type: "OPEN_PUSH_EVENT", url: target.href });
        await existing.focus();
      } else await self.clients.openWindow(target.href);
    })(),
  );
});
