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
for (const role of ["tehnik", "hostesa"])
  test(`${role} first login requires a different password and cannot be bypassed by refresh or direct navigation`, async ({
    page,
  }, testInfo) => {
    const response = await data.api.create(
      new Request("http://localhost:3100/api/staff", {
        method: "POST",
        headers: {
          Origin: "http://localhost:3100",
          Authorization: "Bearer " + token(ids.admin),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          first_name: "Nova",
          last_name: "Oseba",
          username: "nova.oseba",
          role,
          password: "initial-password-123",
        }),
      }),
    );
    expect(response.status).toBe(201);
    await page.goto("/");
    await page
      .getByLabel("Uporabniško ime ali e-pošta", { exact: true })
      .fill("nova.oseba");
    await page
      .getByLabel("Geslo", { exact: true })
      .fill("initial-password-123");
    await page.getByRole("button", { name: "Prijava", exact: true }).click();
    await expect(page).toHaveURL(/nastavi-geslo/);
    await expect(
      page.getByRole("heading", { name: "Nastavi novo geslo" }),
    ).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Novo geslo", { exact: true })).toBeVisible();
    await page.goto("/");
    await expect(page).toHaveURL(/nastavi-geslo/);
    const rows = await page.evaluate(async () => {
      const session = JSON.parse(localStorage.getItem("sb-e2e-auth-token"));
      const r = await fetch(
        "https://e2e.supabase.test/rest/v1/events?select=*",
        {
          headers: {
            Authorization: "Bearer " + session.access_token,
            apikey: "test-public-key",
          },
        },
      );
      return r.json();
    });
    expect(rows).toEqual([]);
    await page
      .getByLabel("Novo geslo", { exact: true })
      .fill("initial-password-123");
    await page
      .getByLabel("Potrditev novega gesla")
      .fill("initial-password-123");
    await page.getByRole("button", { name: "Shrani novo geslo" }).click();
    await expect(page.locator('p[role="alert"]')).toContainText("drugačno");
    await page
      .getByLabel("Novo geslo", { exact: true })
      .fill("new-personal-password");
    await page.getByLabel("Potrditev novega gesla").fill("mismatched-password");
    await page.getByRole("button", { name: "Shrani novo geslo" }).click();
    await expect(page.locator('p[role="alert"]')).toContainText("ne ujemata");
    await page.screenshot({
      path: testInfo.outputPath("initial-password.png"),
    });
    await page
      .getByLabel("Novo geslo", { exact: true })
      .fill("new-personal-password");
    await page
      .getByLabel("Potrditev novega gesla")
      .fill("new-personal-password");
    await page.getByRole("button", { name: "Shrani novo geslo" }).click();
    await expect(page.locator(".user strong")).toHaveText("Nova Oseba");
    await page.reload();
    await expect(page.locator(".user strong")).toHaveText("Nova Oseba");
    await expect(
      page.getByRole("heading", { name: "Koledar dogodkov" }),
    ).toBeVisible();
  });
for (const pending of [false, true])
  test(`${pending ? "flagged staff" : "legacy administrator"} recovery keeps the existing email recovery page usable`, async ({
    page,
  }) => {
    if (pending) {
      const response = await data.api.create(
        new Request("http://localhost:3100/api/staff", {
          method: "POST",
          headers: {
            Origin: "http://localhost:3100",
            Authorization: "Bearer " + token(ids.admin),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            first_name: "Nova",
            last_name: "Oseba",
            username: "nova.oseba",
            role: "hostesa",
            password: "initial-password-123",
          }),
        }),
      );
      expect(response.status).toBe(201);
    }
    const identity = pending ? "nova.oseba" : "admin@example.test",
      password = pending ? "initial-password-123" : "test-password";
    const response = await data.api.login(
      new Request("http://localhost:3100/api/auth/login", {
        method: "POST",
        headers: {
          Origin: "http://localhost:3100",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ identity, password }),
      }),
    );
    expect(response.status).toBe(200);
    const session = await response.json();
    const hash = new URLSearchParams({
      type: "recovery",
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    });
    await page.goto("/ponastavitev-gesla#" + hash.toString());
    await expect(page.getByLabel("Novo geslo", { exact: true })).toBeVisible();
    await page
      .getByLabel("Novo geslo", { exact: true })
      .fill("recovered-personal-password");
    await page
      .getByLabel("Potrdite novo geslo", { exact: true })
      .fill("recovered-personal-password");
    await page.getByRole("button", { name: "Shrani novo geslo" }).click();
    await expect(
      page.getByRole("heading", { name: "Prijava v urnike", exact: true }),
    ).toBeVisible();
    await page
      .getByLabel("Uporabniško ime ali e-pošta", { exact: true })
      .fill(identity);
    await page
      .getByLabel("Geslo", { exact: true })
      .fill("recovered-personal-password");
    await page.getByRole("button", { name: "Prijava", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Koledar dogodkov", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".user strong")).toHaveText(
      pending ? "Nova Oseba" : "Ana Administrator",
    );
    await expect(page).not.toHaveURL(/nastavi-geslo/);
  });
