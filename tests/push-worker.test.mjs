import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
const source = await readFile(
  new URL("../public/sw.js", import.meta.url),
  "utf8",
);
const id = "10000000-0000-0000-0000-000000000001";
function worker() {
  const handlers = {},
    notifications = [],
    opened = [],
    messages = [];
  const clients = {
    claim: async () => {},
    matchAll: async () => [],
    openWindow: async (url) => opened.push(url),
  };
  vm.runInNewContext(source, {
    URL,
    self: {
      location: { origin: "https://kd-urniki.vercel.app" },
      addEventListener: (name, fn) => (handlers[name] = fn),
      clients,
      registration: {
        showNotification: async (title, options) =>
          notifications.push({ title, ...options }),
      },
    },
  });
  return {
    notifications,
    opened,
    messages,
    clients,
    async push(data) {
      let p;
      handlers.push({ data: { json: () => data }, waitUntil: (v) => (p = v) });
      await p;
    },
    async click(url) {
      let p;
      handlers.notificationclick({
        notification: { data: { url }, close: () => {} },
        waitUntil: (v) => (p = v),
      });
      await p;
    },
  };
}
test("worker validates payloads, uses stable tags and opens only same-origin event links", async () => {
  const w = worker();
  await w.push({
    eventId: id,
    recipientId: id,
    notificationId: id,
    body: "Vaš razpored je spremenjen.",
  });
  assert.equal(w.notifications.length, 1);
  assert.equal(w.notifications[0].tag, "kd-" + id);
  assert.equal(w.notifications[0].renotify, false);
  await w.push({ eventId: "evil", recipientId: id, notificationId: id });
  assert.equal(w.notifications.length, 1);
  await w.click("https://evil.test/");
  assert.equal(w.opened.length, 0);
  await w.click(w.notifications[0].data.url);
  assert.equal(
    w.opened[0],
    `https://kd-urniki.vercel.app/?dogodek=${id}&prejemnik=${id}`,
  );
  w.clients.matchAll = async () => [
    {
      url: w.opened[0],
      focus: async () => {},
      postMessage: (m) => w.messages.push(m),
    },
  ];
  await w.click(w.notifications[0].data.url);
  assert.equal(w.opened.length, 1);
  assert.equal(w.messages[0].type, "OPEN_PUSH_EVENT");
});
