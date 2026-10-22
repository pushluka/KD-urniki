import { test, expect } from "@playwright/test";
test("an update preserves unsaved input until the user explicitly accepts a reload", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const container = new EventTarget();
    container.controller = {};
    const registration = new EventTarget();
    registration.waiting = null;
    registration.installing = null;
    registration.update = async () => {};
    container.register = async () => registration;
    Object.defineProperty(navigator, "serviceWorker", { value: container });
    window.pwaUpdatedElsewhere = () =>
      container.dispatchEvent(new Event("controllerchange"));
    window.offerPwaUpdate = () => {
      const worker = new EventTarget();
      worker.postMessage = (data) => {
        if (data.type !== "ACTIVATE_UPDATE")
          throw new Error("Unexpected message");
        sessionStorage.setItem("update-accepted", "yes");
        container.dispatchEvent(new Event("controllerchange"));
      };
      registration.installing = worker;
      registration.dispatchEvent(new Event("updatefound"));
      registration.waiting = worker;
      worker.dispatchEvent(new Event("statechange"));
    };
  });
  await page.goto("/");
  const input = page.getByLabel("Uporabniško ime ali e-pošta", { exact: true });
  await input.fill("neshranjen-vnos");
  await page.evaluate(() => window.offerPwaUpdate());
  const update = page.getByRole("button", { name: "Posodobi aplikacijo" });
  await expect(update).toBeVisible();
  await expect(input).toHaveValue("neshranjen-vnos");
  await expect(
    page.getByText(
      "Na voljo je nova različica. Pred posodobitvijo shranite spremembe.",
    ),
  ).toBeVisible();
  await page.evaluate(() => window.pwaUpdatedElsewhere());
  await expect(update).toHaveCount(0);
  await expect(input).toHaveValue("neshranjen-vnos");
  await page.evaluate(() => window.offerPwaUpdate());
  await expect(update).toBeVisible();
  await Promise.all([page.waitForEvent("load"), update.click()]);
  expect(
    await page.evaluate(() => sessionStorage.getItem("update-accepted")),
  ).toBe("yes");
  await expect(input).toHaveValue("");
});
