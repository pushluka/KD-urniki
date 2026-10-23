import { test, expect } from "@playwright/test";
import { backend } from "./backend.mjs";
let data;
test.beforeEach(async ({ page }) => {
  data = await backend(page);
});
test.afterEach(async () => {
  await data.close();
});
async function login(page, role = "tech") {
  await page.goto("/");
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
  await page.getByRole("link", { name: "Nastavitve", exact: true }).click();
}
test("staff can confirm the dedicated calendar, resync and disconnect with clear retention notice", async ({
  page,
}) => {
  await data.calendar.oauth();
  await data.calendar.assign();
  await login(page);
  const panel = page.locator(".google-settings");
  await expect(panel).toContainText("potrdite namenski koledar");
  await panel
    .getByRole("button", {
      name: "Potrdi namenski koledar in uskladi moje dodelitve",
    })
    .click();
  await expect(panel).toContainText("Stanje: povezano");
  await data.calendar.dispatch();
  expect(data.calendar.remote.size).toBe(1);
  await panel
    .getByRole("button", { name: "Ponovno uskladi moje dodelitve" })
    .click();
  await expect(panel.getByRole("status")).toContainText(
    "dodana v strežniško vrsto",
  );
  await data.calendar.dispatch();
  expect(data.calendar.remote.size).toBe(1);
  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("vnosi ostanejo");
    await dialog.accept();
  });
  await panel.getByRole("button", { name: "Prekini Google Koledar" }).click();
  await expect(panel).toContainText("Stanje: ni povezave");
  expect(data.calendar.remote.size).toBe(1);
  await expect(
    panel.getByRole("button", { name: "Poveži Google Koledar" }),
  ).toBeEnabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("hostess integration is optional and administrators keep their existing notification settings", async ({
  page,
}) => {
  await login(page, "hostess");
  await expect(page.locator(".google-settings")).toContainText(
    "Stanje: ni povezave",
  );
  await expect(
    page.getByRole("button", { name: "Poveži Google Koledar" }),
  ).toBeEnabled();
  await expect(page.locator(".google-settings")).toContainText("prostovoljna");
});
test("administrator has no Google Calendar connection controls", async ({
  page,
}) => {
  await login(page, "admin");
  await expect(
    page.getByRole("heading", { name: "Nastavitve obvestil" }),
  ).toBeVisible();
  await expect(page.locator(".google-settings")).toHaveCount(0);
});
