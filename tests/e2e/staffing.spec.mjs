import { test, expect } from "@playwright/test";
import { backend } from "./backend.mjs";
import { ids } from "../helpers/database.mjs";
let data;
test.beforeEach(async ({ page }) => {
  data = await backend(page);
});
test.afterEach(async () => {
  await data?.close();
});
async function login(page, role = "admin") {
  await page.goto("/");
  await expect(page.locator(".calendar-footer")).toBeVisible();
  await expect(
    page.getByText("Nalaganje dogodkov …", { exact: true }),
  ).toHaveCount(0);
  await page
    .getByLabel("Uporabniško ime ali e-pošta", { exact: true })
    .fill(`${role}@example.test`);
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
async function goToEventMonth(page) {
  const now = new Date();
  const diff = (2026 - now.getFullYear()) * 12 + 10 - now.getMonth();
  for (let i = 0; i < Math.abs(diff); i++)
    await page
      .getByRole("button", {
        name: diff > 0 ? "Naslednji mesec" : "Prejšnji mesec",
      })
      .click();
}
async function open(page) {
  if (
    !(await page
      .getByRole("button", { name: "Odpri dogodek: Preizkusni koncert" })
      .count())
  )
    await goToEventMonth(page);
  const trigger = page.getByRole("button", {
    name: "Odpri dogodek: Preizkusni koncert",
  });
  if (test.info().project.name === "phone") await trigger.tap();
  else await trigger.click();
  await expect(
    page.getByRole("dialog", { name: "Preizkusni koncert" }),
  ).toBeVisible();
  return page.getByRole("dialog");
}
async function times(form, arrival, finish) {
  await form.getByLabel("Prihod", { exact: true }).fill(arrival);
  await form.getByLabel("Predvideni zaključek", { exact: true }).fill(finish);
}
test("calendar click/tap opens a usable dialog, Escape closes and restores focus", async ({
  page,
}, testInfo) => {
  await login(page);
  const dialog = await open(page);
  await expect(
    dialog.getByRole("heading", { name: "Preizkusni koncert" }),
  ).toBeVisible();
  expect(await dialog.evaluate((el) => el.matches(":modal"))).toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("event-dialog.png") });
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Odpri dogodek: Preizkusni koncert" }),
  ).toBeFocused();
  await open(page);
  await page.getByRole("button", { name: "Zapri", exact: true }).click();
  await expect(dialog).not.toBeVisible();
});
test("accounting item and independent named hours persist after reload, including external staff", async ({
  page,
}) => {
  await login(page);
  let dialog = await open(page);
  await dialog.getByRole("button", { name: "Uredi dogodek" }).click();
  await dialog.getByLabel("Računovodska postavka").selectOption("111");
  await dialog.getByRole("button", { name: "Shrani dogodek" }).click();
  await expect(dialog).not.toBeVisible();
  dialog = await open(page);
  await expect(dialog.getByText("111", { exact: true })).toBeVisible();
  const add = dialog.getByRole("form", { name: "Dodaj člana ekipe" });
  await add
    .getByRole("combobox", { name: "Oseba", exact: true })
    .selectOption({ label: "Tine Tehnik · tehnik" });
  await times(add, "2026-11-12T16:00", "2026-11-13T01:00");
  await add.getByRole("button", { name: "Dodaj v razpored" }).click();
  await expect(
    dialog.getByRole("article", { name: "Tine Tehnik" }),
  ).toBeVisible();
  await add
    .getByRole("combobox", { name: "Oseba", exact: true })
    .selectOption({ label: "Hana Hostesa · hostesa" });
  await times(add, "2026-11-12T18:00", "2026-11-12T22:00");
  await add.getByRole("button", { name: "Dodaj v razpored" }).click();
  await expect(
    dialog.getByRole("article", { name: "Hana Hostesa" }),
  ).toBeVisible();
  const external = dialog.getByRole("form", {
    name: "Dodaj zunanjega sodelavca",
  });
  await external.getByLabel("Ime in priimek").fill("Zunanji Sodelavec");
  await external
    .getByRole("combobox", { name: "Vloga", exact: true })
    .selectOption("tehnik");
  await times(external, "2026-11-12T15:00", "2026-11-12T23:00");
  await external
    .getByRole("button", { name: "Dodaj zunanjega sodelavca" })
    .click();
  await expect(
    dialog.getByRole("article", { name: "Zunanji Sodelavec" }),
  ).toBeVisible();
  await page.reload();
  dialog = await open(page);
  await expect(dialog.getByText("111", { exact: true })).toBeVisible();
  await expect(
    dialog
      .getByRole("article", { name: "Tine Tehnik" })
      .getByLabel("Prihod", { exact: true }),
  ).toHaveValue("2026-11-12T16:00");
  await expect(
    dialog
      .getByRole("article", { name: "Tine Tehnik" })
      .getByLabel("Predvideni zaključek"),
  ).toHaveValue("2026-11-13T01:00");
  await expect(
    dialog
      .getByRole("article", { name: "Hana Hostesa" })
      .getByLabel("Prihod", { exact: true }),
  ).toHaveValue("2026-11-12T18:00");
  await expect(
    dialog
      .getByRole("article", { name: "Zunanji Sodelavec" })
      .getByLabel("Prihod", { exact: true }),
  ).toHaveValue("2026-11-12T15:00");
  const person = dialog.getByRole("article", { name: "Hana Hostesa" });
  await times(person, "2026-11-12T17:45", "2026-11-12T22:30");
  await person.getByRole("button", { name: "Shrani ure" }).click();
  await expect(dialog.getByRole("status")).toHaveText("Razpored je shranjen.");
  await page.reload();
  dialog = await open(page);
  await expect(
    dialog
      .getByRole("article", { name: "Hana Hostesa" })
      .getByLabel("Prihod", { exact: true }),
  ).toHaveValue("2026-11-12T17:45");
  await dialog.getByRole("button", { name: "Uredi dogodek" }).click();
  await expect(dialog.getByLabel("Računovodska postavka")).toHaveValue("111");
  await dialog.getByLabel("Računovodska postavka").selectOption("110");
  await dialog.getByLabel("Začetek (vaš lokalni čas)").fill("2026-11-12T20:00");
  await dialog
    .getByLabel("Zaključek", { exact: true })
    .fill("2026-11-12T23:00");
  await dialog.getByRole("button", { name: "Shrani dogodek" }).click();
  await expect(dialog).not.toBeVisible();
  await page.reload();
  dialog = await open(page);
  await expect(dialog.getByText("110", { exact: true })).toBeVisible();
  await expect(
    dialog
      .getByRole("article", { name: "Tine Tehnik" })
      .getByLabel("Prihod", { exact: true }),
  ).toHaveValue("2026-11-12T16:00");
});
test("technician self-signup edits only own hours and can cancel", async ({
  page,
}) => {
  await login(page, "tech");
  let dialog = await open(page);
  const calendarEvent = page.locator(".calendar-grid .event");
  await expect(calendarEvent).toHaveClass(/is-neutral/);
  await expect(
    dialog.getByRole("form", { name: "Dodaj člana ekipe" }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "Uredi dogodek" }),
  ).toHaveCount(0);
  const signup = dialog.getByRole("form", { name: "Samoprijava tehnika" });
  await times(signup, "2026-11-12T16:00", "2026-11-12T23:00");
  await signup.getByRole("button", { name: "Prijavi se na dogodek" }).click();
  await expect(
    dialog.getByRole("article", { name: "Tine Tehnik" }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("article", { name: "Rok Tehnik" }).getByRole("button"),
  ).toHaveCount(0);
  await expect(calendarEvent).toHaveClass(/is-working/);
  await expect(calendarEvent).toContainText("Delam");
  await page.reload();
  dialog = await open(page);
  await expect(calendarEvent).toHaveClass(/is-working/);
  const own = dialog.getByRole("article", { name: "Tine Tehnik" });
  await times(own, "2026-11-12T15:30", "2026-11-13T00:30");
  await own.getByRole("button", { name: "Shrani ure" }).click();
  await expect(dialog.getByRole("status")).toHaveText("Razpored je shranjen.");
  await own.getByRole("button", { name: "Odjavi se" }).click();
  await expect(own).toHaveCount(0);
  await expect(calendarEvent).toHaveClass(/is-neutral/);
  await expect(calendarEvent).not.toContainText("Delam");
  await expect(
    dialog.getByRole("form", { name: "Samoprijava tehnika" }),
  ).toBeVisible();
});
test("hostess can read event and assigned names but cannot edit staffing", async ({
  page,
}) => {
  await login(page, "hostess");
  const dialog = await open(page);
  await expect(
    dialog.getByRole("article", { name: "Rok Tehnik" }),
  ).toBeVisible();
  await expect(dialog.locator("input,select")).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "Uredi dogodek" }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "Prijavi se na dogodek" }),
  ).toHaveCount(0);
});

test("administrator creates a new event with required accounting item", async ({
  page,
}) => {
  await login(page);
  await goToEventMonth(page);
  await page.getByRole("button", { name: "Nov dogodek", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Nov dogodek" });
  await dialog.getByLabel("Naslov dogodka").fill("Nov dogodek s postavko");
  await dialog.getByLabel("Začetek (vaš lokalni čas)").fill("2026-11-12T18:00");
  await dialog
    .getByLabel("Zaključek", { exact: true })
    .fill("2026-11-12T22:00");
  await dialog.getByLabel("Računovodska postavka").selectOption("110");
  await dialog.getByRole("button", { name: "Shrani dogodek" }).click();
  await expect(dialog).not.toBeVisible();
  const trigger = page.getByRole("button", {
    name: "Odpri dogodek: Nov dogodek s postavko",
  });
  await expect(trigger).toBeVisible();
  await trigger.click();
  await expect(
    page.getByRole("dialog").getByText("110", { exact: true }),
  ).toBeVisible();
});

test("calendar remains interactive when the browser date differs from prerendering", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.setFixedTime(new Date("2030-01-12T10:00:00Z"));
  await login(page);
  await expect(
    page.getByRole("heading", { name: "januar 2030", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Prejšnji mesec" }).click();
  await expect(
    page.getByRole("heading", { name: "december 2029", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

for (const role of ["tech", "hostess", "admin"])
  test(`${role}: personal calendar marks only own assignments and refreshes administrator changes`, async ({
    page,
  }, testInfo) => {
    await data.db.exec("reset role");
    const userId = role === "hostess" ? ids.hostess : ids.tech;
    await data.db.query(
      "insert into assignments(event_id,user_id,arrives_at,finishes_at) select id,$2,starts_at,ends_at from events where id=$1",
      [ids.event, userId],
    );
    await data.db.query(
      "insert into events(id,title,starts_at,ends_at,location,accounting_code) select $1,'Drug dogodek',starts_at,ends_at,'Druga lokacija','110' from events where id=$2",
      ["10000000-0000-0000-0000-000000000002", ids.event],
    );
    await page.clock.install();
    await login(page, role);
    await goToEventMonth(page);
    const assigned = page
      .locator(".calendar-grid .event")
      .filter({ hasText: "Preizkusni koncert" });
    const other = page
      .locator(".calendar-grid .event")
      .filter({ hasText: "Drug dogodek" });
    await expect(other).toBeVisible();
    if (role === "admin") {
      await expect(assigned).toHaveClass(/color-0/);
      await expect(other).toHaveClass(/color-2/);
      await expect(page.locator(".working-label")).toHaveCount(0);
      return;
    }
    await expect(assigned).toHaveClass(/is-working/);
    await expect(assigned).toHaveAccessibleName(
      "Odpri dogodek: Preizkusni koncert – Delam",
    );
    await expect(assigned).toContainText("Delam");
    await expect(other).toHaveClass(/is-neutral/);
    await expect(other).not.toContainText("Delam");
    await expect(
      page.locator(".event-row").filter({ hasText: "Preizkusni koncert" }),
    ).toHaveClass(/is-working/);
    await page
      .getByRole("button", { name: "Moj razpored", exact: true })
      .click();
    await expect(assigned).toHaveClass(/is-working/);
    await expect(other).toHaveCount(0);
    await page.getByRole("button", { name: "Koledar", exact: true }).click();
    await expect(other).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("personal-calendar.png"),
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    // Simulate an administrator changing staffing in another client.
    await data.db.exec("reset role");
    await data.db.query(
      "delete from assignments where event_id=$1 and user_id=$2",
      [ids.event, userId],
    );
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(assigned).toHaveClass(/is-neutral/);
    await expect(assigned).not.toContainText("Delam");
    // The other technician is still assigned: the colour is personal, not global.
    await expect(assigned).toBeVisible();
    await data.db.exec("reset role");
    await data.db.query(
      "insert into assignments(event_id,user_id,arrives_at,finishes_at) select id,$2,starts_at,ends_at from events where id=$1",
      [ids.event, userId],
    );
    await page.clock.fastForward(30_000);
    await expect(assigned).toHaveClass(/is-working/);
    await page.reload();
    await goToEventMonth(page);
    await expect(assigned).toHaveClass(/is-working/);
  });
