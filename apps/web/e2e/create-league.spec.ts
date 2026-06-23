import { createClient } from "@libsql/client";

import { expect, test } from "./auth";
import { TEST_USER } from "./session";

/**
 * End-to-end coverage and browser artifact for the create-league flow
 * (issue #29). Runs as the seeded e2e commissioner (the `auth` fixture injects
 * a real Auth.js session cookie), so `/leagues/new` renders instead of bouncing
 * to sign-in.
 *
 * Captures two screenshots — the empty form and the post-submit success panel
 * with the invite code — and confirms the new league landed in the database in
 * `setup` state, the artifact the issue calls for.
 */
test("commissioner creates a private league and gets a working invite code", async ({
  page,
}) => {
  await page.goto("/leagues/new");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Create a league",
  );
  await page.screenshot({
    path: "screenshots/create-league-form.png",
    fullPage: true,
  });

  // Private is the default visibility, so this exercises the invite-code path.
  await page.getByLabel("League name").fill("E2E Spring Showdown");
  await page.getByLabel("Max players").fill("8");
  await page.getByRole("button", { name: "Create league" }).click();

  // Success panel: invite code shown for a private league.
  await expect(page.getByText("League created")).toBeVisible();
  await expect(page.locator("code")).toHaveText(/^[A-Z2-9]{8}$/);
  await page.screenshot({
    path: "screenshots/create-league-success.png",
    fullPage: true,
  });

  // The issue's artifact also calls for confirming state=setup in the DB.
  const url = process.env.DATABASE_URL ?? "file:./dev.db";
  const db = createClient({ url });
  try {
    const result = await db.execute({
      sql: "SELECT status, visibility FROM leagues WHERE commissioner_id = ? ORDER BY created_at DESC LIMIT 1",
      args: [TEST_USER.id],
    });
    expect(result.rows[0]?.status).toBe("setup");
    expect(result.rows[0]?.visibility).toBe("private");
  } finally {
    db.close();
  }
});
