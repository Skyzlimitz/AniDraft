import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for the web app's end-to-end screenshot checks.
 *
 * The `webServer` block builds-then-serves the production app: CI runs
 * `pnpm --filter web build` first, then Playwright starts `next start` and
 * waits for it to be reachable before running specs. Screenshots are written
 * to `screenshots/` and uploaded as a CI artifact.
 */
export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["html", { open: "never" }], ["list"]] : "list",
  use: {
    baseURL: "http://localhost:3000",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "pnpm start",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
