import { expect, test } from "@playwright/test";

/**
 * Captures the `/sign-in` page at desktop and mobile widths for the issue's
 * screenshot artifacts, and asserts both provider buttons render so a broken
 * page fails the job instead of uploading a blank image.
 */
test("sign-in page renders both providers (desktop)", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/sign-in");

  await expect(
    page.getByRole("heading", { level: 1 }),
  ).toContainText("Sign in");
  await expect(page.getByRole("button", { name: /Continue with Google/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Continue with Discord/i })).toBeVisible();

  await page.screenshot({ path: "screenshots/sign-in-desktop.png", fullPage: true });
});

test("sign-in page renders both providers (mobile)", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/sign-in");

  await expect(page.getByRole("button", { name: /Continue with Google/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Continue with Discord/i })).toBeVisible();

  await page.screenshot({ path: "screenshots/sign-in-mobile.png", fullPage: true });
});
