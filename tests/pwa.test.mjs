import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
const source = await readFile(
  new URL("../public/sw.js", import.meta.url),
  "utf8",
);
function worker() {
  const listeners = {},
    entries = new Map(),
    deleted = [];
  let online = true,
    activated = false;
  const calls = [];
  vm.runInNewContext(source, {
    URL,
    self: {
      location: { origin: "https://kd-urniki.vercel.app" },
      addEventListener: (name, fn) => {
        listeners[name] = fn;
      },
      clients: { claim: async () => {} },
      skipWaiting: () => {
        activated = true;
      },
    },
    caches: {
      open: async () => ({
        put: async (key, value) => {
          entries.set(key, value);
        },
      }),
      match: async (key) => entries.get(key),
      keys: async () => [
        "kd-urniki-pwa-old",
        "kd-urniki-pwa-v1",
        "kd-urniki-pwa-v2",
        "kd-urniki-pwa-v3",
        "unrelated",
      ],
      delete: async (key) => {
        deleted.push(key);
      },
    },
    fetch: async (req, opts) => {
      calls.push({ req, opts });
      if (!online) throw new TypeError("offline");
      return new Response(
        String(req) === "/offline.html"
          ? "public offline page"
          : "PRIVATE DATA",
      );
    },
  });
  return {
    entries,
    calls,
    deleted,
    setOffline: () => {
      online = false;
    },
    activated: () => activated,
    async lifecycle(name) {
      let p;
      listeners[name]({
        waitUntil: (task) => {
          p = task;
        },
      });
      await p;
    },
    async request(url, mode = "cors", method = "GET") {
      let p;
      listeners.fetch({
        request: { url, mode, method },
        respondWith: (task) => {
          p = task;
        },
      });
      return p;
    },
    message(data) {
      listeners.message({ data });
    },
  };
}
test("worker caches only public offline page and removes only its obsolete caches", async () => {
  const w = worker();
  await w.lifecycle("install");
  await w.lifecycle("activate");
  assert.deepEqual([...w.entries.keys()], ["/offline.html"]);
  assert.deepEqual(w.deleted, [
    "kd-urniki-pwa-old",
    "kd-urniki-pwa-v1",
    "kd-urniki-pwa-v2",
  ]);
  assert.equal(w.calls[0].opts.credentials, "omit");
  assert.equal(w.activated(), false);
  w.message({ type: "UNTRUSTED_MESSAGE" });
  assert.equal(w.activated(), false);
  w.message({ type: "ACTIVATE_UPDATE" });
  assert.equal(w.activated(), true);
});
test("private navigation, Auth, RSC, API, signed PDFs and mutations are network-only", async () => {
  const w = worker();
  await w.lifecycle("install");
  const paths = [
    "https://kd-urniki.vercel.app/",
    "https://kd-urniki.vercel.app/osebje",
    "https://kd-urniki.vercel.app/?_rsc=secret",
    "https://kd-urniki.vercel.app/api/staff",
    "https://project.supabase.co/auth/v1/token",
    "https://project.supabase.co/rest/v1/assignments",
    "https://project.supabase.co/storage/v1/object/sign/technical-documents/private.pdf?token=secret",
  ];
  for (const path of paths) {
    assert.equal(await (await w.request(path)).text(), "PRIVATE DATA");
    assert.equal(w.calls.at(-1).opts.cache, "no-store");
  }
  await w.request(paths[3], "cors", "POST");
  assert.deepEqual([...w.entries.keys()], ["/offline.html"]);
  w.setOffline();
  for (const path of paths) await assert.rejects(w.request(path), /offline/);
  await assert.rejects(w.request(paths[3], "cors", "POST"), /offline/);
  assert.equal(
    await (await w.request(paths[1], "navigate")).text(),
    "public offline page",
  );
  await assert.rejects(w.request(paths[4], "navigate"), /offline/);
});
