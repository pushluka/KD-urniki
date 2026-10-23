import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/mobile",
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  reporter: "list",
  snapshotPathTemplate: "{testDir}/__screenshots__/{projectName}/{arg}{ext}",
  expect: {
    toHaveScreenshot: {
      animations: "disabled",
      stylePath: "./tests/mobile/screenshot.css",
      maxDiffPixelRatio: 0.01,
    },
  },
  use: {
    ...devices["Pixel 7"],
    serviceWorkers: "block",
    baseURL: "http://localhost:3100",
    timezoneId: "Europe/Ljubljana",
    locale: "sl-SI",
    trace: "retain-on-failure",
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    },
  },
  projects: [
    ...[320, 375, 430].map((width) => ({
      name: `mobile-${width}`,
      use: {
        ...devices[width === 430 ? "Pixel 7" : "iPhone 13"],
        browserName: "chromium" as const,
        viewport: { width, height: 900 },
        deviceScaleFactor: 1,
      },
    })),
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1000 },
      },
    },
  ],
  webServer: {
    command: "npm run dev -- --port 3100",
    url: "http://localhost:3100",
    reuseExistingServer: false,
    timeout: 60000,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: "https://e2e.supabase.test",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test-public-key",
    },
  },
});
