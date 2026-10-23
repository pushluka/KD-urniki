import { test, expect } from "@playwright/test";
import { token } from "../helpers/server-fixture.mjs";
import { backend } from "../e2e/backend.mjs";
import { ids, asUser } from "../helpers/database.mjs";
const title =
  "Gledališki večer za vse generacije – " +
  "ZeloDolgNaslovBrezPresledkov".repeat(4);
let data;
test.beforeEach(async ({ page }) => {
  // Keep the visual starting state independent of host browser permission policy.
  // Permission requests/delivery are covered by the existing Push E2E suite.
  await page.addInitScript(() => {
    if ("Notification" in window)
      Object.defineProperty(Notification, "permission", {
        configurable: true,
        get: () => "default",
      });
  });
  data = await backend(page);
  await asUser(data.db, ids.admin);
  await data.db.query("update events set title=$1 where id=$2", [
    title,
    ids.event,
  ]);
  await data.db.query(
    "insert into assignments(event_id,user_id,arrives_at,finishes_at) select id,$2,starts_at-interval '2 hours',ends_at+interval '1 hour' from events where id=$1",
    [ids.event, ids.tech],
  );
  await data.db.query(
    "insert into assignments(event_id,user_id,arrives_at,finishes_at) select id,$2,starts_at-interval '1 hour',ends_at from events where id=$1",
    [ids.event, ids.hostess],
  );
});
test.afterEach(async () => {
  await data?.close();
});
async function login(page, role) {
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
}
// A Link click may finish while Next is still fetching/compiling the destination.
// Both pages contain .login, so require recovery-specific content before measuring.
async function openForgotPassword(page) {
  await page
    .getByRole("link", { name: "Pozabljeno geslo", exact: true })
    .click();
  await expect(page).toHaveURL(/\/pozabljeno-geslo$/, { timeout: 15000 });
  const panel = page.locator("main.auth-page > .login").filter({
    has: page.getByRole("heading", {
      name: "Pozabljeno geslo",
      exact: true,
      level: 1,
    }),
  });
  await expect(panel.getByLabel("E-pošta", { exact: true })).toBeVisible({
    timeout: 15000,
  });
  return panel;
}
async function month(page) {
  const diff =
    (2026 - new Date().getFullYear()) * 12 + 10 - new Date().getMonth();
  for (let i = 0; i < Math.abs(diff); i++)
    await page
      .getByRole("button", {
        name: diff > 0 ? "Naslednji mesec" : "Prejšnji mesec",
      })
      .click();
  await expect(page.locator(".calendar-grid .event")).toHaveCount(1);
}
async function readable(page, root = page.locator("body")) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  const issues = await root.evaluate((el) => {
    const issues = [];
    const luminance = (color) => {
      const rgb = color
        .match(/[\d.]+/g)
        ?.slice(0, 3)
        .map(Number) ?? [255, 255, 255];
      const linear = rgb.map((v) => {
        const c = v / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
    };
    const contrast = (node) => {
      let current = node,
        background = "rgb(255,255,255)";
      while (current) {
        const bg = getComputedStyle(current).backgroundColor;
        if (bg !== "transparent" && !bg.endsWith(", 0)")) {
          background = bg;
          break;
        }
        current = current.parentElement;
      }
      const a = luminance(getComputedStyle(node).color),
        b = luminance(background);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    };
    for (const n of el.querySelectorAll("button,a,input,select,textarea")) {
      const r = n.getBoundingClientRect(),
        s = getComputedStyle(n);
      if (!r.width || !r.height || s.visibility === "hidden") continue;
      if (r.width < 43.5 || r.height < 43.5)
        issues.push(
          `${n.tagName} ${n.textContent?.trim().slice(0, 35)}: ${r.width}x${r.height}`,
        );
      if (
        ["INPUT", "SELECT", "TEXTAREA"].includes(n.tagName) &&
        parseFloat(s.fontSize) < 16
      )
        issues.push("small input: " + s.fontSize);
      if (
        n.scrollWidth > n.clientWidth + 2 &&
        !["INPUT", "SELECT", "TEXTAREA"].includes(n.tagName)
      )
        issues.push("clipped control: " + n.textContent?.slice(0, 35));
    }
    for (const n of el.querySelectorAll(
      "p,label,small,strong,h1,h2,h3,h4,.badge,.eyebrow,.legend,.calendar-footer,time",
    )) {
      if (
        n.getBoundingClientRect().width &&
        getComputedStyle(n).visibility !== "hidden" &&
        parseFloat(getComputedStyle(n).fontSize) < 14
      )
        issues.push(
          "small text: " + n.className + " " + getComputedStyle(n).fontSize,
        );
    }
    for (const n of el.querySelectorAll(
      "p,label,small,.badge,.calendar-footer,.primary",
    )) {
      const r = n.getBoundingClientRect();
      if (r.width && r.height && !n.closest(":disabled") && contrast(n) < 4.5)
        issues.push("low text contrast: " + n.className);
    }
    if (el.scrollWidth > el.clientWidth + 2) issues.push("container overflow");
    return issues;
  });
  expect(issues).toEqual([]);
}
const visual = {
  style: ".day:has(.current) .mobile-day-label { color: #292c30 !important; }",
};
for (const role of ["admin", "tech", "hostess"])
  test(`${role}: calendar, long event, schedules, settings and role-specific screens remain readable`, async ({
    page,
  }, info) => {
    test.skip(info.project.name === "desktop");
    await login(page, role);
    await month(page);
    await readable(page);
    await expect(page.locator(".calendar")).toHaveScreenshot(
      `${role}-calendar.png`,
      visual,
    );
    const card = page.getByRole("button", {
      name: `Odpri dogodek: ${title}${role === "admin" ? "" : " – Delam"}`,
      exact: true,
    });
    await card.tap();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await readable(page, dialog);
    await expect(
      dialog.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    expect(
      await dialog
        .locator("h2")
        .evaluate((el) => el.scrollHeight <= el.clientHeight + 1),
    ).toBe(true);
    await expect(dialog).toHaveScreenshot(`${role}-event.png`);
    await dialog.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await expect(
      dialog.getByRole("button", { name: "Zapri", exact: true }),
    ).toBeInViewport();
    await dialog.evaluate((el) => {
      el.scrollTop = 0;
    });
    if (role === "tech") {
      const form = dialog
        .getByRole("article", { name: "Tine Tehnik", exact: true })
        .locator("form");
      await expect(form).toBeVisible();
      {
        await form
          .getByLabel("Prihod", { exact: true })
          .fill("2026-11-12T15:00");
        await form
          .getByRole("button", { name: "Shrani ure", exact: true })
          .click();
        await expect(dialog.getByRole("status")).toHaveText(
          "Razpored je shranjen.",
        );
      }
    }
    await dialog.getByRole("button", { name: "Zapri", exact: true }).click();
    await page
      .getByRole("button", { name: "Moj razpored", exact: true })
      .click();
    await readable(page);
    await page.getByRole("button", { name: "Ekipa", exact: true }).click();
    await readable(page);
    await page.getByRole("link", { name: "Nastavitve", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Nastavitve obvestil" }),
    ).toBeVisible();
    await readable(page);
    await expect(page.locator(".install-guide")).toHaveScreenshot(
      `${role}-settings.png`,
    );
    await page.getByRole("link", { name: "Nazaj na urnike" }).click();
    if (role === "admin") {
      await page.getByRole("link", { name: "Obvestila", exact: true }).click();
      await expect(page.getByRole("article").first()).toBeVisible();
      await readable(page);
      const notice = page.getByRole("article").first();
      await notice
        .getByRole("button", { name: "Označi kot prebrano", exact: true })
        .click();
      await expect(notice).toContainText("Prebrano");
      await expect(page.locator(".notification-history")).toHaveScreenshot(
        "admin-notifications.png",
        { mask: [page.locator("time")] },
      );
      await page.getByRole("link", { name: "Nazaj na urnike" }).click();
      await page.getByRole("link", { name: "Osebje", exact: true }).click();
      await expect(page.locator(".staff-person").first()).toBeVisible();
      await readable(page);
      await page
        .getByRole("button", { name: "Dodaj sodelavca", exact: true })
        .click();
      await readable(page, page.getByRole("dialog"));
      await expect(page.getByRole("dialog")).toHaveScreenshot(
        "admin-account-form.png",
      );
      await page.getByRole("button", { name: "Zapri", exact: true }).click();
      await page.getByRole("link", { name: "Nazaj na koledar" }).click();
      await page
        .getByRole("button", { name: "Nov dogodek", exact: true })
        .click();
      await readable(page, page.getByRole("dialog"));
      await expect(page.getByRole("dialog")).toHaveScreenshot(
        "admin-event-form.png",
      );
    }
  });
test("login, password forms and 200% text scaling preserve touch targets, reflow and zoom", async ({
  page,
}, info) => {
  test.skip(info.project.name === "desktop");
  await page.goto("/");
  await expect(page.locator(".login")).toBeVisible();
  await readable(page);
  await expect(page.locator(".login")).toHaveScreenshot("login.png");
  await page.getByLabel("Uporabniško ime ali e-pošta", { exact: true }).focus();
  await expect(
    page.getByLabel("Uporabniško ime ali e-pošta", { exact: true }),
  ).toHaveCSS("outline-style", "solid");
  const viewport = await page
    .locator('meta[name="viewport"]')
    .getAttribute("content");
  expect(viewport).not.toMatch(/user-scalable=no|maximum-scale=1(?:,|$)/);
  const recovery = await openForgotPassword(page);
  await readable(page);
  await expect(recovery).toHaveScreenshot("forgot-password.png");
  await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
  const recoveryEmail = recovery.getByLabel("E-pošta", { exact: true });
  await expect(recoveryEmail).toHaveCSS("font-size", "32px");
  await recoveryEmail.focus();
  await expect(recoveryEmail).toHaveCSS("outline-style", "solid");
  await readable(page);
  const sendRecovery = recovery.getByRole("button", {
    name: "Pošlji povezavo",
    exact: true,
  });
  await sendRecovery.scrollIntoViewIfNeeded();
  await expect(sendRecovery).toBeInViewport();
  await login(page, "admin");
  await month(page);
  await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
  await readable(page);
  await expect(page.getByRole("button", { name: "Naslednji mesec" })).toHaveCSS(
    "font-size",
    "32px",
  );
  await page
    .getByRole("button", { name: `Odpri dogodek: ${title}`, exact: true })
    .click();
  await readable(page, page.getByRole("dialog"));
  await expect(page.getByRole("dialog")).toHaveScreenshot("text-200-event.png");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Zapri", exact: true })
    .click();
  await page.getByRole("link", { name: "Nastavitve", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Nastavitve obvestil" }),
  ).toBeVisible();
  await page.addStyleTag({ content: "html {font-size:200% !important;}" });
  await readable(page);
});
test("desktop retains the original typography and seven-column month grid", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "desktop");
  await login(page, "admin");
  await month(page);
  expect(
    await page.locator("body").evaluate((el) => getComputedStyle(el).fontSize),
  ).toBe("14px");
  expect(
    await page
      .locator(".calendar-grid")
      .evaluate(
        (el) => getComputedStyle(el).gridTemplateColumns.split(" ").length,
      ),
  ).toBe(7);
  await expect(page.locator(".mobile-calendar-hint")).not.toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await expect(page.locator(".calendar")).toHaveScreenshot(
    "desktop-calendar.png",
    {
      style:
        ".current {background: transparent !important; color: #77797e !important;}",
    },
  );
});

test("new password and recovery forms keep readable fields and usable actions", async ({
  page,
}, info) => {
  test.skip(info.project.name === "desktop");
  await page.goto(
    `/ponastavitev-gesla#type=recovery&access_token=${token(ids.tech)}&refresh_token=test-refresh`,
  );
  await expect(page.getByLabel("Novo geslo", { exact: true })).toBeVisible();
  await readable(page);
  await expect(page.locator(".login")).toHaveScreenshot(
    "recovery-password.png",
  );
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
        role: "tehnik",
        password: "initial-password-123",
      }),
    }),
  );
  expect(response.status).toBe(201);
  await page.evaluate(() => localStorage.clear());
  await page.goto("/");
  await page
    .getByLabel("Uporabniško ime ali e-pošta", { exact: true })
    .fill("nova.oseba");
  await page.getByLabel("Geslo", { exact: true }).fill("initial-password-123");
  await page.getByRole("button", { name: "Prijava", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Nastavi novo geslo" }),
  ).toBeVisible();
  await readable(page);
  await expect(page.locator(".login")).toHaveScreenshot("initial-password.png");
});

// Hold the route until the test explicitly releases it: no machine-speed assumptions.
test("recovery screenshot waits for its destination during delayed client navigation", async ({
  page,
}, info) => {
  test.skip(info.project.name === "desktop");
  let release,
    requestHeld = false;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  await page.route("**/pozabljeno-geslo*", async (route) => {
    requestHeld = true;
    await gate;
    await route.continue();
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Prijava v urnike", exact: true }),
  ).toBeVisible();
  let completed = false;
  const navigation = openForgotPassword(page).then((panel) => {
    completed = true;
    return panel;
  });
  try {
    await expect.poll(() => requestHeld).toBe(true);
    await expect(
      page.getByLabel("Uporabniško ime ali e-pošta", { exact: true }),
    ).toBeVisible();
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    expect(
      completed,
      "must not accept the old sign-in form as the recovery page",
    ).toBe(false);
  } finally {
    release();
  }
  const recovery = await navigation;
  await readable(page, recovery);
  await expect(recovery).toHaveScreenshot("forgot-password.png");
});
