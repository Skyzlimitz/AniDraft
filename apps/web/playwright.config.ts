import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for the web app's end-to-end screenshot checks.
 *
 * The `webServer` block builds-then-serves the production app: CI runs
 * `pnpm --filter web build` first, then Playwright starts `next start` and
 * waits for it to be reachable before running specs. Screenshots are written
 * to `screenshots/` and uploaded as a CI artifact.
 *
 * The `e2e/` directory carries its own `package.json` with `"type": "module"`
 * so Playwright transpiles these specs/helpers as ESM. The app itself is CJS,
 * but the e2e helpers import `@libsql/client` and `next-auth/jwt`, whose
 * `require` builds are `.js` files inside `"type": "module"` packages and so
 * only load via a real ESM `import` (a CJS `require` throws "exports is not
 * defined in ES module scope").
 */
export default defineConfig({
  testDir: "./e2e",
  // Only `.spec.ts` files are Playwright specs; `.test.ts` under `e2e/` (e.g.
  // `session.test.ts`) are vitest unit tests and must not be run here.
  testMatch: "**/*.spec.ts",
  // Seeds the throwaway libsql DB (migrations + the e2e commissioner) so
  // authenticated write flows like creating a league succeed. See the file.
  globalSetup: "./e2e/global-setup.ts",
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
    // `next start` outside Vercel doesn't trust the request host, so Auth.js
    // (called by the route-protection proxy) would reject every request with
    // UntrustedHost and the proxy could never redirect. Vercel sets this
    // implicitly in real deploys; the test server needs it set explicitly.
    env: { AUTH_TRUST_HOST: "true" },
  },
});
