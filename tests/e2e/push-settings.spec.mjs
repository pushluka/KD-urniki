import { createECDH, randomBytes } from "node:crypto";
import { test, expect } from "@playwright/test";
import { backend } from "./backend.mjs";
import { token } from "../helpers/server-fixture.mjs";
import { ids } from "../helpers/database.mjs";
let data;
test.beforeEach(async ({ page }) => {
  data = await backend(page);
});
test.afterEach(async () => {
  await data.close();
});
async function browserPush(
  page,
  { permission = "default", subscribed = false, supported = true } = {},
) {
  const keys = createECDH("prime256v1");
  keys.generateKeys();
  const subscription = {
    endpoint: "https://fcm.googleapis.com/fcm/send/settings-test",
    keys: {
      p256dh: keys.getPublicKey().toString("base64url"),
      auth: randomBytes(16).toString("base64url"),
    },
  };
  await page.addInitScript(
    ({ permission, subscribed, supported, subscription }) => {
      if (!supported) delete window.PushManager;
      if (!sessionStorage.getItem("test-permission"))
        sessionStorage.setItem("test-permission", permission);
      if (!sessionStorage.getItem("test-sub"))
        sessionStorage.setItem("test-sub", String(subscribed));
      window.permissionCalls = 0;
      window.subscribeCalls = 0;
      Object.defineProperty(window, "Notification", {
        configurable: true,
        value: {
          get permission() {
            return sessionStorage.getItem("test-permission");
          },
          requestPermission: async () => {
            window.permissionCalls++;
            sessionStorage.setItem("test-permission", "granted");
            return "granted";
          },
        },
      });
      const sub = {
        ...subscription,
        options: {
          get applicationServerKey() {
            const stored = sessionStorage.getItem("test-application-key");
            return stored ? Uint8Array.from(JSON.parse(stored)).buffer : null;
          },
        },
        toJSON: () => subscription,
        unsubscribe: async () => {
          sessionStorage.setItem("test-sub", "false");
          return true;
        },
      };
      const registration = new EventTarget();
      Object.assign(registration, {
        waiting: null,
        installing: null,
        update: async () => {},
        active: {
          postMessage: (_, ports) => ports[0].postMessage({ push: true }),
        },
        pushManager: {
          getSubscription: async () =>
            sessionStorage.getItem("test-sub") === "true" ? sub : null,
          subscribe: async (options) => {
            sessionStorage.setItem(
              "test-application-key",
              JSON.stringify(Array.from(options.applicationServerKey)),
            );
            window.subscribeCalls++;
            sessionStorage.setItem("test-sub", "true");
            return sub;
          },
        },
      });
      const container = new EventTarget();
      Object.assign(container, {
        controller: {},
        ready: Promise.resolve(registration),
        register: async () => registration,
        getRegistration: async () => registration,
      });
      Object.defineProperty(navigator, "serviceWorker", {
        configurable: true,
        value: container,
      });
    },
    { permission, subscribed, supported, subscription },
  );
  return subscription;
}
async function settings(page, role = "tech") {
  await page.goto("/");
  await page
    .getByLabel("Uporabniško ime ali e-pošta", { exact: true })
    .fill(role + "@example.test");
  await page.getByLabel("Geslo", { exact: true }).fill("test-password");
  await page.getByRole("button", { name: "Prijava", exact: true }).click();
  await expect(page.locator(".user strong")).toContainText(
    role === "admin" ? "Ana" : role === "hostess" ? "Hana" : "Tine",
  );
  await page.getByRole("link", { name: "Nastavitve", exact: true }).click();
  await expect(page).toHaveURL(/\/nastavitve$/);
  await expect(
    page.getByRole("heading", { name: "Nastavitve obvestil" }),
  ).toBeVisible();
}
const state = (page) => page.getByRole("status", { name: "Stanje obvestil" });
async function enabled(page) {
  await expect(state(page)).toHaveText("Obvestila so vključena.");
  await expect(
    page.getByRole("button", { name: "Izklopi obvestila", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Omogoči obvestila", exact: true }),
  ).toHaveCount(0);
}
async function disabled(page) {
  await expect(state(page)).toHaveText("Obvestila so izključena.");
  await expect(
    page.getByRole("button", { name: "Omogoči obvestila", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Izklopi obvestila", exact: true }),
  ).toHaveCount(0);
}
for (const role of ["admin", "tech", "hostess"])
  test(`${role}: device state survives reload and does not request permission again`, async ({
    page,
  }) => {
    await browserPush(page);
    await settings(page, role);
    await disabled(page);
    expect(await page.evaluate(() => window.permissionCalls)).toBe(0);
    await page
      .getByRole("button", { name: "Omogoči obvestila", exact: true })
      .click();
    await enabled(page);
    expect(await page.evaluate(() => window.permissionCalls)).toBe(1);
    await page.reload();
    await enabled(page);
    expect(await page.evaluate(() => window.permissionCalls)).toBe(0);
    expect(await page.evaluate(() => window.subscribeCalls)).toBe(0);
    await page
      .getByRole("button", { name: "Izklopi obvestila", exact: true })
      .click();
    await disabled(page);
    await page.reload();
    await disabled(page);
    await page
      .getByRole("button", { name: "Omogoči obvestila", exact: true })
      .click();
    await enabled(page);
    expect(await page.evaluate(() => window.permissionCalls)).toBe(0);
  });
test("denied and externally changed permission hide misleading actions", async ({
  page,
}) => {
  await browserPush(page, { permission: "denied" });
  await settings(page);
  await expect(state(page)).toHaveText("Obvestila so blokirana.");
  await expect(
    page.getByRole("button", { name: /^(Omogoči|Izklopi) obvestila$/ }),
  ).toHaveCount(0);
  await expect(
    page.getByText(/V nastavitvah telefona oziroma brskalnika dovolite/),
  ).toBeVisible();
  await page.evaluate(() => {
    sessionStorage.setItem("test-permission", "granted");
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await disabled(page);
  expect(await page.evaluate(() => window.permissionCalls)).toBe(0);
});
test("unsupported device never offers subscription actions", async ({
  page,
}) => {
  await browserPush(page, { supported: false });
  await settings(page);
  await expect(state(page)).toHaveText(
    "Obvestila v tem brskalniku niso podprta.",
  );
  await expect(
    page.getByRole("button", { name: /^(Omogoči|Izklopi) obvestila$/ }),
  ).toHaveCount(0);
  expect(await page.evaluate(() => window.permissionCalls)).toBe(0);
});
test("existing browser subscription missing from server is repaired only on explicit opt-in", async ({
  page,
}) => {
  await browserPush(page, { permission: "granted", subscribed: true });
  await settings(page);
  await disabled(page);
  await data.db.exec("reset role");
  expect(
    (await data.db.query("select id from push_subscriptions")).rows,
  ).toHaveLength(0);
  await page
    .getByRole("button", { name: "Omogoči obvestila", exact: true })
    .click();
  await enabled(page);
  expect(await page.evaluate(() => window.permissionCalls)).toBe(0);
  expect(await page.evaluate(() => window.subscribeCalls)).toBe(0);
  await page.reload();
  await enabled(page);
  await data.db.exec("delete from push_subscriptions");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await disabled(page);
});
test("server subscription for another device does not enable this browser", async ({
  page,
}) => {
  const subscription = await browserPush(page, { permission: "granted" });
  await settings(page);
  const response = await data.push.subscribe(
    new Request("http://localhost:3100/api/push/subscription", {
      method: "POST",
      headers: {
        Origin: "http://localhost:3100",
        Authorization: `Bearer ${token(ids.tech)}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(subscription),
    }),
  );
  expect(response.status).toBe(200);
  await page.reload();
  await disabled(page);
});

test("checking and server errors do not claim a device is disabled", async ({
  page,
}) => {
  await browserPush(page);
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let failed = true;
  await page.route("**/api/push/subscription", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await gate;
    if (failed)
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Preizkus nedosegljivega strežnika" }),
      });
    return route.fallback();
  });
  await settings(page);
  await expect(state(page)).toHaveText("Preverjanje nastavitev …");
  await expect(
    page.getByRole("button", { name: /^(Omogoči|Izklopi) obvestila$/ }),
  ).toHaveCount(0);
  release();
  await expect(state(page)).toHaveText("Stanja obvestil ni mogoče preveriti.");
  await expect(
    page.getByRole("button", { name: /^(Omogoči|Izklopi) obvestila$/ }),
  ).toHaveCount(0);
  failed = false;
  await page
    .getByRole("button", { name: "Preveri znova", exact: true })
    .click();
  await disabled(page);
});

test("a failed registration is not displayed as enabled", async ({ page }) => {
  await browserPush(page, { permission: "granted" });
  await settings(page);
  await disabled(page);
  await page.route("**/api/push/subscription", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "Registracija ni uspela" }),
        })
      : route.fallback(),
  );
  await page
    .getByRole("button", { name: "Omogoči obvestila", exact: true })
    .click();
  await disabled(page);
  await expect(page.locator(".notice")).toContainText("Registracija ni uspela");
  await page.reload();
  await disabled(page);
});

test("subscription belonging to another account is not reported as enabled", async ({
  page,
}) => {
  const subscription = await browserPush(page, {
    permission: "granted",
    subscribed: true,
  });
  const response = await data.push.subscribe(
    new Request("http://localhost:3100/api/push/subscription", {
      method: "POST",
      headers: {
        Origin: "http://localhost:3100",
        Authorization: `Bearer ${token(ids.admin)}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(subscription),
    }),
  );
  expect(response.status).toBe(200);
  await settings(page, "tech");
  await disabled(page);
  await page
    .getByRole("button", { name: "Omogoči obvestila", exact: true })
    .click();
  await expect(page.locator(".notice")).toContainText(
    "Obvestil trenutno ni mogoče upravljati",
  );
  await disabled(page);
  await data.db.exec("reset role");
  expect(
    (await data.db.query("select user_id from push_subscriptions")).rows,
  ).toEqual([{ user_id: ids.admin }]);
  expect(await page.evaluate(() => window.permissionCalls)).toBe(0);
});

test("revoking permission outside the application refreshes an enabled device", async ({
  page,
}) => {
  await browserPush(page);
  await settings(page);
  await disabled(page);
  await page
    .getByRole("button", { name: "Omogoči obvestila", exact: true })
    .click();
  await enabled(page);
  await page.evaluate(() => {
    sessionStorage.setItem("test-permission", "denied");
    window.dispatchEvent(new Event("focus"));
  });
  await expect(state(page)).toHaveText("Obvestila so blokirana.");
  await expect(
    page.getByRole("button", { name: /^(Omogoči|Izklopi) obvestila$/ }),
  ).toHaveCount(0);
  await page.reload();
  await expect(state(page)).toHaveText("Obvestila so blokirana.");
  expect(await page.evaluate(() => window.permissionCalls)).toBe(0);
});

test("a mismatched VAPID key requires explicit repair without duplicate registrations", async ({
  page,
}) => {
  await browserPush(page);
  await settings(page);
  await disabled(page);
  await page
    .getByRole("button", { name: "Omogoči obvestila", exact: true })
    .click();
  await enabled(page);
  await page.evaluate(() => {
    sessionStorage.setItem("test-application-key", JSON.stringify([1, 2, 3]));
    window.dispatchEvent(new Event("focus"));
  });
  await disabled(page);
  await page
    .getByRole("button", { name: "Omogoči obvestila", exact: true })
    .click();
  await enabled(page);
  expect(await page.evaluate(() => window.subscribeCalls)).toBe(2);
  expect(await page.evaluate(() => window.permissionCalls)).toBe(1);
  await data.db.exec("reset role");
  expect(
    (await data.db.query("select id from push_subscriptions")).rows,
  ).toHaveLength(1);
});
