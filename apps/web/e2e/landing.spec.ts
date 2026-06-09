import { expect, test } from "@playwright/test";

test("landing page renders the placeholder and captures a screenshot", async ({
  page,
}) => {
  await page.goto("/");

  // Sanity-check the placeholder copy so a broken render fails the job
  // instead of silently uploading a blank screenshot.
  await expect(
    page.getByRole("heading", { level: 1 }),
  ).toContainText("coming soon");

  await page.screenshot({ path: "screenshots/landing.png", fullPage: true });
});
