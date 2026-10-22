import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/pwa",
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3101",
    serviceWorkers: "allow",
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    },
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "android", use: { ...devices["Pixel 7"] } },
    // Chromium tests iPhone layout; native Safari installation needs a real device.
    {
      name: "iphone-layout",
      use: { ...devices["iPhone 13"], browserName: "chromium" },
    },
  ],
  webServer: {
    command: "npm run start -- --port 3101",
    url: "http://localhost:3101",
    reuseExistingServer: false,
  },
});
