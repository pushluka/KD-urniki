import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  reporter: "list",
  use: {
    // Auth emulation is page-routed; real service-worker coverage uses playwright.pwa.config.ts.
    serviceWorkers: "block",
    baseURL: "http://localhost:3100",
    timezoneId: "Europe/Ljubljana",
    trace: "retain-on-failure",
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    },
  },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1000 },
      },
    },
    { name: "phone", use: { ...devices["Pixel 7"] } },
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
