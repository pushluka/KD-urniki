import { test, expect } from "@playwright/test";
import { backend } from "./backend.mjs";
import { ids, asUser } from "../helpers/database.mjs";
let data;
test.beforeEach(async ({ page }) => {
  data = await backend(page);
});
test.afterEach(async () => {
  await data.close();
});
async function login(page, role = "admin", path = "/") {
  await page.goto(path);
  await page
    .getByLabel("Uporabniško ime ali e-pošta", { exact: true })
    .fill(role + "@example.test");
  await page.getByLabel("Geslo", { exact: true }).fill("test-password");
  await page.getByRole("button", { name: "Prijava", exact: true }).click();
  await expect(page.locator(".user strong")).toHaveText(
    role === "admin" ? "Ana Administrator" : "Tine Tehnik",
  );
}
async function notice() {
  await asUser(data.db, ids.admin);
  await data.db.query(
    "insert into assignments(event_id,user_id,arrives_at,finishes_at) select id,$2,starts_at,ends_at from events where id=$1",
    [ids.event, ids.tech],
  );
  await data.db.exec("reset role");
  return (
    await data.db.query("select id from admin_notifications where user_id=$1", [
      ids.admin,
    ])
  ).rows[0].id;
}
test("admin history shows content, event, time and persistent read state across reloads", async ({
  page,
}) => {
  await notice();
  await login(page);
  await page.getByRole("link", { name: "Obvestila", exact: true }).click();
  const item = page.getByRole("article", { name: "Nova razporeditev" });
  await expect(item).toContainText("Tine Tehnik");
  await expect(item).toContainText("Neprebrano");
  await expect(item.locator("time")).toBeVisible();
  await item
    .getByRole("button", { name: "Označi kot prebrano", exact: true })
    .click();
  await expect(item).toContainText("Prebrano");
  await page.reload();
  await expect(
    item.getByRole("button", { name: "Označi kot neprebrano" }),
  ).toBeVisible();
  await item.getByRole("button", { name: "Označi kot neprebrano" }).click();
  await expect(item).toContainText("Neprebrano");
  await item
    .getByRole("link", { name: "Odpri dogodek: Preizkusni koncert" })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Preizkusni koncert" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Zapri", exact: true }).click();
  await page.getByRole("link", { name: "Obvestila", exact: true }).click();
  await expect(
    item.getByRole("button", { name: "Označi kot neprebrano" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("admin notification deep link waits for login, opens event, and marks the corresponding history read", async ({
  page,
}) => {
  const id = await notice();
  await login(
    page,
    "admin",
    `/?dogodek=${ids.event}&prejemnik=${ids.admin}&obvestilo=${id}`,
  );
  await expect(
    page.getByRole("dialog", { name: "Preizkusni koncert" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Zapri", exact: true }).click();
  await page.getByRole("link", { name: "Obvestila", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Označi kot neprebrano" }),
  ).toBeVisible();
});
test("staff has no administrator history tab or access", async ({ page }) => {
  await notice();
  await login(page, "tech");
  await expect(
    page.getByRole("link", { name: "Obvestila", exact: true }),
  ).toHaveCount(0);
  await page.goto("/obvestila");
  await expect(page.getByRole("status")).toContainText("samo administratorju");
  await expect(page.getByRole("article")).toHaveCount(0);
});
