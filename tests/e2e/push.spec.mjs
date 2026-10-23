import { createECDH, randomBytes } from "node:crypto";
import { test, expect } from "@playwright/test";
import { backend } from "./backend.mjs";
import { ids } from "../helpers/database.mjs";
let data;
test.beforeEach(async ({ page }) => {
  data = await backend(page);
});
test.afterEach(async () => {
  await data.close();
});
async function login(page, role = "tech", path = "/") {
  await page.goto(path);
  await page
    .getByLabel("Uporabniško ime ali e-pošta", { exact: true })
    .fill(role + "@example.test");
  await page.getByLabel("Geslo", { exact: true }).fill("test-password");
  await page.getByRole("button", { name: "Prijava", exact: true }).click();
  await expect(page.locator(".user strong")).toHaveText(
    role === "admin"
      ? "Ana Administrator"
      : role === "tech"
        ? "Tine Tehnik"
        : "Hana Hostesa",
  );
}
test("notification link waits for login and opens the correct event without changing calendar month", async ({
  page,
}) => {
  await login(page, "tech", `/?dogodek=${ids.event}&prejemnik=${ids.tech}`);
  await expect(
    page.getByRole("dialog", { name: "Preizkusni koncert" }),
  ).toBeVisible();
});
test("a notification for another account never opens the event automatically", async ({
  page,
}) => {
  await login(page, "hostess", `/?dogodek=${ids.event}&prejemnik=${ids.tech}`);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText(
    "namenjeno drugemu računu",
  );
});
test("notification settings request no permission on load and remain optional", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.permissionCalls = 0;
    Object.defineProperty(window, "Notification", {
      value: {
        permission: "default",
        requestPermission: async () => {
          window.permissionCalls++;
          window.Notification.permission = "denied";
          return "denied";
        },
      },
    });
  });
  await login(page);
  await page.getByRole("link", { name: "Nastavitve", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Nastavitve obvestil" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Omogoči obvestila" }),
  ).toBeEnabled();
  expect(await page.evaluate(() => window.permissionCalls)).toBe(0);
  await page.getByRole("button", { name: "Omogoči obvestila" }).click();
  await expect(page.locator(".notice")).toContainText(
    "Obvestila niso dovoljena",
  );
  expect(await page.evaluate(() => window.permissionCalls)).toBe(1);
  await page.getByRole("link", { name: "Nazaj na urnike" }).click();
  await expect(
    page.getByRole("heading", { name: "Koledar dogodkov" }),
  ).toBeVisible();
});

for (const account of ["tech", "admin", "hostess"])
  test(`${account} can enable and disable only the current device after an explicit permission gesture`, async ({
    page,
  }) => {
    const key = createECDH("prime256v1");
    key.generateKeys();
    const subscription = {
      endpoint: "https://fcm.googleapis.com/fcm/send/browser-test",
      keys: {
        p256dh: key.getPublicKey().toString("base64url"),
        auth: randomBytes(16).toString("base64url"),
      },
    };
    await page.addInitScript((data) => {
      window.permissionCalls = 0;
      const notification = {
        permission: "default",
        requestPermission: async () => {
          window.permissionCalls++;
          notification.permission = "granted";
          return "granted";
        },
      };
      Object.defineProperty(window, "Notification", { value: notification });
      let subscribed = false;
      const sub = {
        ...data,
        options: {},
        toJSON: () => data,
        unsubscribe: async () => {
          subscribed = false;
          return true;
        },
      };
      const registration = new EventTarget();
      registration.waiting = null;
      registration.installing = null;
      registration.update = async () => {};
      registration.active = {
        postMessage: (_, ports) => ports[0].postMessage({ push: true }),
      };
      registration.pushManager = {
        getSubscription: async () => (subscribed ? sub : null),
        subscribe: async (options) => {
          if (!options.userVisibleOnly) throw new Error("Opt-in required");
          subscribed = true;
          return sub;
        },
      };
      const container = new EventTarget();
      container.controller = {};
      container.ready = Promise.resolve(registration);
      container.register = async () => registration;
      container.getRegistration = async () => registration;
      Object.defineProperty(navigator, "serviceWorker", { value: container });
    }, subscription);
    await login(page, account);
    await page.getByRole("link", { name: "Nastavitve", exact: true }).click();
    const enable = page.getByRole("button", { name: "Omogoči obvestila" });
    await expect(enable).toBeEnabled();
    expect(await page.evaluate(() => window.permissionCalls)).toBe(0);
    await enable.click();
    await expect(
      page.getByRole("status", { name: "Stanje obvestil" }),
    ).toHaveText("Obvestila so vključena.");
    await expect(enable).toHaveCount(0);
    await data.db.exec("reset role");
    expect(
      (await data.db.query("select user_id from push_subscriptions")).rows,
    ).toEqual([
      {
        user_id:
          account === "admin"
            ? ids.admin
            : account === "hostess"
              ? ids.hostess
              : ids.tech,
      },
    ]);
    await page.getByRole("button", { name: "Izklopi obvestila" }).click();
    await expect(
      page.getByRole("status", { name: "Stanje obvestil" }),
    ).toHaveText("Obvestila so izključena.");
    await data.db.exec("reset role");
    expect(
      (await data.db.query("select id from push_subscriptions")).rows.length,
    ).toBe(0);
  });
