// Isolated browser tests: actual server handlers and migrations, emulated Supabase Auth.
import { createECDH } from "node:crypto";
import { createPushApi } from "../../lib/server/push.ts";
import { serverFixture } from "../helpers/server-fixture.mjs";
export async function backend(page) {
  const fixture = await serverFixture({ appOrigin: "http://localhost:3100" });
  const vapid = createECDH("prime256v1");
  vapid.generateKeys();
  fixture.push = createPushApi({
    admin: fixture.admin,
    authorize: fixture.api.authorizePush,
    origin: "http://localhost:3100",
    publicKey: vapid.getPublicKey().toString("base64url"),
    cronSecret: "test-cron",
    send: async () => {},
  });
  async function fulfill(route, res) {
    await route.fulfill({
      status: res.status,
      headers: Object.fromEntries(res.headers),
      body: await res.text(),
    });
  }
  function request(route) {
    const r = route.request();
    return new Request(r.url(), {
      method: r.method(),
      headers: r.headers(),
      ...(!["GET", "HEAD"].includes(r.method())
        ? { body: r.postData() ?? "" }
        : {}),
    });
  }
  await page.route("https://e2e.supabase.test/**", async (route) => {
    await fulfill(route, await fixture.fetch(request(route)));
  });
  await page.route("**/api/**", async (route) => {
    const req = request(route),
      url = new URL(req.url),
      api = fixture.api;
    let res;
    if (url.pathname === "/api/push/history")
      res = await (req.method === "GET"
        ? fixture.push.history(req)
        : fixture.push.markRead(req));
    else if (url.pathname === "/api/push/subscription")
      res = await (req.method === "GET"
        ? fixture.push.status(req)
        : req.method === "POST"
          ? fixture.push.subscribe(req)
          : fixture.push.unsubscribe(req));
    else if (url.pathname === "/api/push/dispatch")
      res = await fixture.push.dispatch(req);
    else if (url.pathname === "/api/auth/password-status")
      res = await api.passwordStatus(req);
    else if (url.pathname === "/api/auth/change-initial-password")
      res = await api.changeInitialPassword(req);
    else if (url.pathname === "/api/auth/login") res = await api.login(req);
    else if (url.pathname === "/api/staff")
      res = await (req.method === "GET" ? api.list(req) : api.create(req));
    else {
      const parts = url.pathname.split("/"),
        id = parts[3];
      res =
        parts[4] === "active"
          ? await api.active(req, id)
          : parts[4] === "password"
            ? await api.reset(req, id)
            : await api.update(req, id);
    }
    await fulfill(route, res);
  });
  return fixture;
}
