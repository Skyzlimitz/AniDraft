import { expect, test } from "./auth";
import { e2eDb, seedLeague } from "./seed";
import { TEST_USER } from "./session";

/**
 * End-to-end coverage and browser artifact for the public lobby listing
 * (issue #31).
 *
 * The `auth` fixture signs in as the seeded e2e user (`TEST_USER`). To exercise
 * a real "join someone else's open league" path, `beforeAll` seeds a second
 * commissioner who owns a fresh **public** league (no invite code — public
 * leagues are joined straight from the lobby by id), then the test drives
 * `TEST_USER` (not yet a member) through the lobby's Join button.
 *
 * Captures the lobby list and the post-join state, and confirms the membership
 * row landed as a `player` — the artifacts the issue calls for.
 */

const OWNER = {
  id: "e2e-lobby-owner",
  name: "Lobby Owner",
  email: "lobby-owner@anidraft.test",
} as const;

const LEAGUE_ID = "e2e-public-lobby";
const LEAGUE_NAME = "E2E Open Lobby";

test.beforeAll(async () => {
  // A second commissioner owns a public league (no invite code — public leagues
  // are joined straight from the lobby by id); `TEST_USER` then joins it.
  // Idempotent, so a retry re-running `beforeAll` after the join starts clean.
  await seedLeague({
    id: LEAGUE_ID,
    name: LEAGUE_NAME,
    visibility: "public",
    commissioner: OWNER,
  });
});

test("a signed-in user browses the lobby and joins a public league", async ({
  page,
}) => {
  await page.goto("/lobbies");

  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Open lobbies",
  );
  // The seeded public league shows up with its commissioner and seat count.
  const card = page.getByRole("listitem").filter({ hasText: LEAGUE_NAME });
  await expect(card).toBeVisible();
  await expect(card).toContainText("Lobby Owner");
  await page.screenshot({ path: "screenshots/lobbies-list.png", fullPage: true });

  // Join it. The button's success state ("You're in 🎉") may be replaced by the
  // revalidated server-rendered member badge ("You're in 👍") once the join's
  // `revalidatePath('/lobbies')` lands — either confirms the join, so match both.
  await card.getByRole("button", { name: `Join ${LEAGUE_NAME}` }).click();
  await expect(card.getByText(/You're in/)).toBeVisible();
  await page.screenshot({
    path: "screenshots/lobbies-joined.png",
    fullPage: true,
  });

  // The membership row landed for the signed-in user as a player.
  const db = e2eDb();
  try {
    const result = await db.execute({
      sql: "SELECT role FROM league_members WHERE league_id = ? AND user_id = ?",
      args: [LEAGUE_ID, TEST_USER.id],
    });
    expect(result.rows[0]?.role).toBe("player");
  } finally {
    db.close();
  }
});
