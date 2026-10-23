import { test, expect } from "@playwright/test";
import { backend } from "./backend.mjs";
let data;
test.beforeEach(async ({ page }) => {
  data = await backend(page);
});
test.afterEach(async () => {
  await data.close();
});
async function login(page, identity, password = "test-password") {
  await page.goto("/");
  await expect(page.locator(".calendar-footer")).toBeVisible();
  await expect(
    page.getByText("Nalaganje dogodkov …", { exact: true }),
  ).toHaveCount(0);
  const logout = page.getByRole("button", { name: "Izpis", exact: true });
  if (await logout.isVisible()) await logout.click();
  await page
    .getByLabel("Uporabniško ime ali e-pošta", { exact: true })
    .fill(identity);
  await page.getByLabel("Geslo", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Prijava", exact: true }).click();
}
test("administrator creates, edits, resets and deactivates a username account without exposing passwords", async ({
  page,
}, testInfo) => {
  await login(page, "admin@example.test");
  await page.getByRole("link", { name: "Osebje", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Osebje", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Dodaj sodelavca", exact: true })
    .click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("Ime", { exact: true }).fill("Nov");
  await dialog.getByLabel("Priimek", { exact: true }).fill("Sodelavec");
  await dialog
    .getByLabel("Uporabniško ime", { exact: true })
    .fill("nov.sodelavec");
  await dialog
    .getByLabel("Začetno geslo", { exact: true })
    .fill("initial-password-123");
  await dialog.getByRole("button", { name: "Ustvari račun" }).click();
  await expect(dialog).not.toBeVisible();
  let person = page.getByRole("article", { name: "Nov Sodelavec" });
  await expect(person).toContainText("@nov.sodelavec");
  await page.screenshot({ path: testInfo.outputPath("staff-admin.png") });
  await expect(page.locator("body")).not.toContainText("initial-password-123");
  await page.reload();
  person = page.getByRole("article", { name: "Nov Sodelavec" });
  await expect(person).toBeVisible();
  await person.getByRole("button", { name: "Uredi", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Priimek", { exact: true }).fill("Tehnik");
  await dialog.getByRole("button", { name: "Shrani sodelavca" }).click();
  await expect(dialog).not.toBeVisible();
  person = page.getByRole("article", { name: "Nov Tehnik" });
  await person.getByRole("button", { name: "Ponastavi geslo" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Novo začasno geslo").fill("changed-password-123");
  await dialog.getByLabel("Potrditev gesla").fill("changed-password-123");
  await dialog.getByRole("button", { name: "Nastavi začasno geslo" }).click();
  await expect(dialog).not.toBeVisible();
  await login(page, "nov.sodelavec", "changed-password-123");
  await expect(page).toHaveURL(/nastavi-geslo/);
  await page
    .getByLabel("Novo geslo", { exact: true })
    .fill("personal-password-123");
  await page
    .getByLabel("Potrditev novega gesla", { exact: true })
    .fill("personal-password-123");
  await page.getByRole("button", { name: "Shrani novo geslo" }).click();
  await expect(page.locator(".user strong")).toHaveText("Nov Tehnik");
  await expect(
    page.getByRole("link", { name: "Osebje", exact: true }),
  ).toHaveCount(0);
  const now = new Date();
  const diff = (2026 - now.getFullYear()) * 12 + 10 - now.getMonth();
  for (let i = 0; i < Math.abs(diff); i++)
    await page
      .getByRole("button", {
        name: diff > 0 ? "Naslednji mesec" : "Prejšnji mesec",
      })
      .click();
  await page
    .getByRole("button", { name: "Odpri dogodek: Preizkusni koncert" })
    .click();
  await page.getByRole("button", { name: "Prijavi se na dogodek" }).click();
  await expect(
    page.getByRole("dialog").getByRole("article", { name: "Nov Tehnik" }),
  ).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("article", { name: "Nov Tehnik" })
    .getByRole("button", { name: "Odjavi se" })
    .click();
  await expect(
    page.getByRole("dialog").getByRole("article", { name: "Nov Tehnik" }),
  ).toHaveCount(0);
  await page.goto("/osebje");
  await expect(
    page.getByText("Dostop je dovoljen samo aktivnemu administratorju."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Dodaj sodelavca" }),
  ).toHaveCount(0);
  await login(page, "admin@example.test");
  await page.getByRole("link", { name: "Osebje", exact: true }).click();
  person = page.getByRole("article", { name: "Nov Tehnik" });
  page.once("dialog", (d) => d.accept());
  await person.getByRole("button", { name: "Deaktiviraj" }).click();
  await expect(person).toContainText("Deaktiviran");
  await login(page, "nov.sodelavec", "personal-password-123");
  await expect(page.getByRole("status")).toContainText("Prijava ni uspela.");
});
test("hostess username login preserves read-only assignments and denies staff administration", async ({
  page,
}) => {
  await login(page, "admin@example.test");
  await page.getByRole("link", { name: "Osebje", exact: true }).click();
  await page
    .getByRole("article", { name: "Hana Hostesa" })
    .getByRole("button", { name: "Uredi", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Ime", { exact: true }).fill("Hana");
  await dialog.getByLabel("Priimek", { exact: true }).fill("Hostesa");
  await dialog
    .getByLabel("Uporabniško ime", { exact: true })
    .fill("hana.hostesa");
  await dialog.getByRole("button", { name: "Shrani sodelavca" }).click();
  await expect(dialog).not.toBeVisible();
  await login(page, "hana.hostesa");
  await expect(page.locator(".user strong")).toHaveText("Hana Hostesa");
  await expect(
    page.getByRole("link", { name: "Osebje", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Moj razpored", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Moj razpored", exact: true }),
  ).toBeVisible();
  await page.goto("/osebje");
  await expect(
    page.getByText("Dostop je dovoljen samo aktivnemu administratorju."),
  ).toBeVisible();
});
