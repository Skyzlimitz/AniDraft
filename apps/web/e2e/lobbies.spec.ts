import { createClient } from "@libsql/client";

import { expect, test } from "./auth";
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
  email: "lobby-owner@anidraft.test",
} as const;

const LEAGUE_ID = "e2e-public-lobby";
const LEAGUE_NAME = "E2E Open Lobby";

function e2eDb() {
  const url = process.env.DATABASE_URL ?? "file:./dev.db";
  return createClient({ url });
}

test.beforeAll(async () => {
  const db = e2eDb();
  const now = Date.now();
  try {
    // Idempotent: `beforeAll` re-runs on a Playwright retry, and the join adds a
    // membership row, so clear any prior state for this fixture first.
    await db.execute({
      sql: "DELETE FROM league_members WHERE league_id = ?",
      args: [LEAGUE_ID],
    });
    await db.execute({
      sql: "DELETE FROM leagues WHERE id = ?",
      args: [LEAGUE_ID],
    });
    await db.execute({
      sql: "INSERT OR IGNORE INTO user (id, name, email) VALUES (?, ?, ?)",
      args: [OWNER.id, "Lobby Owner", OWNER.email],
    });
    await db.execute({
      sql: `INSERT INTO leagues
              (id, name, visibility, commissioner_id, season, season_year, max_players, status, created_at, updated_at)
            VALUES (?, ?, 'public', ?, 'SPRING', 2026, 8, 'setup', ?, ?)`,
      args: [LEAGUE_ID, LEAGUE_NAME, OWNER.id, now, now],
    });
    await db.execute({
      sql: "INSERT INTO league_members (league_id, user_id, role, joined_at) VALUES (?, ?, 'commissioner', ?)",
      args: [LEAGUE_ID, OWNER.id, now],
    });
  } finally {
    db.close();
  }
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
