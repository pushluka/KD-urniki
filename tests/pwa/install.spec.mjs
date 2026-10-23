import { test, expect } from "@playwright/test";
async function controlled(page) {
  await page.goto("/");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise((resolve) =>
        navigator.serviceWorker.addEventListener("controllerchange", resolve, {
          once: true,
        }),
      );
  });
}
test("manifest, Apple metadata, PNG icons and Slovenian installation instructions", async ({
  page,
  request,
}) => {
  await controlled(page);
  const viewport = page.locator('meta[name="viewport"]');
  await expect(viewport).toHaveCount(1);
  await expect(viewport).toHaveAttribute("content", /width=device-width/);
  await expect(viewport).toHaveAttribute("content", /initial-scale=1/);
  expect(await viewport.getAttribute("content")).not.toMatch(
    /user-scalable=no|maximum-scale/,
  );
  expect(await page.evaluate(() => innerWidth)).toBe(page.viewportSize().width);
  expect(await page.evaluate(() => visualViewport.scale)).toBe(1);
  const manifest = await (await request.get("/manifest.webmanifest")).json();
  expect(manifest.name).toBe("KD Grosuplje – Urniki");
  expect(manifest.short_name).toBe("KD Urniki");
  expect(manifest.display).toBe("standalone");
  expect(manifest.scope).toBe("/");
  expect(manifest.icons.some((i) => i.purpose === "maskable")).toBe(true);
  for (const icon of [
    ...manifest.icons,
    { src: "/icons/apple-touch-icon.png", sizes: "180x180" },
  ]) {
    const response = await request.get(icon.src);
    const png = await response.body();
    const size = Number(icon.sizes.split("x")[0]);
    expect(png.readUInt32BE(16)).toBe(size);
    expect(png.readUInt32BE(20)).toBe(size);
  }
  await expect(
    page.locator('meta[name="apple-mobile-web-app-capable"]'),
  ).toHaveAttribute("content", "yes");
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute(
    "content",
    "#e96b2c",
  );
  await page.getByRole("link", { name: "Namestitev na telefon" }).click();
  await expect(
    page.getByRole("heading", { name: "Android · Chrome" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "iPhone · Safari" }),
  ).toBeVisible();
  await expect(page.getByText("Različica prikaza: mobilni-v3.")).toBeVisible();
  await expect(
    page.getByText(`Širina strani: ${page.viewportSize().width} CSS px.`, {
      exact: false,
    }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("real worker never caches private responses; offline navigation has only a public fallback", async ({
  page,
  context,
  request,
}) => {
  await controlled(page);
  const supportsPush = await page.evaluate(async () => {
    const r = await navigator.serviceWorker.ready;
    return new Promise((resolve) => {
      const channel = new MessageChannel();
      const timeout = setTimeout(() => resolve(false), 2000);
      channel.port1.onmessage = (e) => {
        clearTimeout(timeout);
        channel.port1.close();
        resolve(e.data?.push === true);
      };
      r.active.postMessage({ type: "PUSH_CAPABILITIES" }, [channel.port2]);
    });
  });
  expect(supportsPush).toBe(true);
  const response = await request.get("/sw.js");
  expect(response.headers()["cache-control"]).toContain("no-store");
  await page.evaluate(async () => {
    await fetch("/api/auth/password-status");
    await fetch("/api/staff");
    await fetch("/api/push/history");
    await fetch("/private.pdf?token=sensitive");
    await fetch("/osebje");
  });
  const entries = await page.evaluate(async () => {
    const result = [];
    for (const name of await caches.keys())
      for (const req of await (await caches.open(name)).keys())
        result.push(new URL(req.url).pathname);
    return result;
  });
  expect(entries).toEqual(["/offline.html"]);
  await context.setOffline(true);
  await expect(page.getByRole("status")).toContainText(
    "Ni internetne povezave",
  );
  expect(
    await page.evaluate(async () => {
      try {
        await fetch("/api/staff");
        await fetch("/api/push/history");
        return "leaked";
      } catch {
        return "network failure";
      }
    }),
  ).toBe("network failure");
  await page.goto("/osebje");
  await expect(
    page.getByRole("heading", { name: "Ni internetne povezave" }),
  ).toBeVisible();
  await expect(
    page.getByText("Ti podatki niso na voljo brez povezave.", { exact: false }),
  ).toBeVisible();
  await context.setOffline(false);
  await page.getByRole("link", { name: "Odpri aplikacijo" }).click();
  await expect(
    page.getByRole("heading", { name: "Koledar dogodkov" }),
  ).toBeVisible();
});

test("phone diagnostics distinguish a desktop-width viewport without disabling zoom", async ({
  page,
  context,
}, info) => {
  test.skip(info.project.name === "desktop");
  await page.goto("/namestitev");
  const diagnostics = page.getByRole("region", { name: "Preverjanje prikaza" });
  await expect(diagnostics).toContainText("Postavitev: mobilna.");
  // setViewportSize also resizes screen.width. CDP preserves the phone screen
  // separately while reproducing a desktop-sized layout viewport, not Chrome's
  // menu implementation. The measurements themselves remain real browser values.
  const screenWidth = await page.evaluate(() => screen.width);
  const cdp = await context.newCDPSession(page);
  try {
    for (const width of [980, 320]) {
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width,
        height: 900,
        screenWidth,
        screenHeight: 900,
        deviceScaleFactor: 1,
        mobile: true,
      });
      if (width === 980)
        await expect(diagnostics.getByRole("alert")).toContainText(
          "Telefon uporablja namizno širino strani",
        );
      else await expect(diagnostics.getByRole("alert")).toHaveCount(0);
    }
    await expect(diagnostics).toContainText("Širina strani: 320 CSS px.");
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(320);
  } finally {
    await cdp.detach();
  }
});
