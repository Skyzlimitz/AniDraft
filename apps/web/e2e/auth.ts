import { test as base } from "@playwright/test";

import { SESSION_COOKIE_NAME, mintSessionCookieValue } from "./session";

/**
 * `test` extended so every spec that imports it runs as the seeded e2e
 * commissioner: the minted Auth.js session cookie (see `session.ts`) is added
 * to the browser context before the test body, so protected routes like
 * `/leagues/new` render the authenticated UI instead of redirecting to
 * `/sign-in`.
 *
 * Specs that want the signed-out path keep importing from `@playwright/test`.
 */
export const test = base.extend({
  // The second arg is Playwright's "provide the fixture value" callback; named
  // `provide` (not the conventional `use`) so eslint's react-hooks rule doesn't
  // mistake it for React's `use` hook.
  context: async ({ context, baseURL }, provide) => {
    const value = await mintSessionCookieValue();
    await context.addCookies([
      {
        name: SESSION_COOKIE_NAME,
        value,
        url: baseURL ?? "http://localhost:3000",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    await provide(context);
  },
});

export { expect } from "@playwright/test";
