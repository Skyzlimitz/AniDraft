import { expect, test } from "@playwright/test";

/**
 * End-to-end coverage for the route-protection proxy (`proxy.ts`). Runs against
 * the production build with no session cookie, so it exercises the real
 * unauthenticated path and doubles as the issue's browser artifact: visiting a
 * protected route bounces to `/sign-in` with a `callbackUrl` back to it.
 */
test("unauthenticated visit to a protected route redirects to sign-in", async ({
  page,
}) => {
  await page.goto("/leagues");

  // Landed on the sign-in page, carrying where we were headed in callbackUrl
  // (percent-encoded: `/leagues` → `%2Fleagues`).
  await expect(page).toHaveURL(/\/sign-in\?callbackUrl=%2Fleagues$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Sign in",
  );

  await page.screenshot({
    path: "screenshots/protected-redirect.png",
    fullPage: true,
  });
});

test("public routes stay reachable without a session", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/$/);

  await page.goto("/sign-in");
  await expect(page).toHaveURL(/\/sign-in$/);
});
