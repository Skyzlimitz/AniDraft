import { createClient } from "@libsql/client";

import { expect, test } from "./auth";
import { TEST_USER } from "./session";

/**
 * End-to-end coverage and browser artifact for the kick-player flow (issue #35).
 * Runs as the seeded e2e commissioner (the `auth` fixture injects a real Auth.js
 * session cookie), so `/leagues/[id]/settings` renders the editable view.
 *
 * The spec seeds a private league in `setup` owned by the commissioner plus one
 * extra player directly in the DB, then drives the UI: open settings → confirm
 * the player is on the roster → click Remove → confirm the modal → confirm the
 * player is gone. Three screenshots (roster, confirm modal, roster after) are
 * the artifact the issue calls for, and a final DB read asserts the soft delete
 * (`kicked_at` stamped) actually happened.
 */

const LEAGUE_ID = "e2e-kick-league";
const PLAYER = {
  id: "e2e-kick-player",
  name: "E2E Player",
  email: "e2e-kick-player@anidraft.test",
} as const;

test("commissioner kicks a player and they leave the member list", async ({
  page,
}) => {
  const url = process.env.DATABASE_URL ?? "file:./dev.db";
  const db = createClient({ url });

  // Seed a private setup league with the commissioner + one player.
  //
  // Idempotent: CI retries (`playwright.config.ts` sets `retries: 1`) re-run
  // this body, and the test itself mutates the membership (the kick), so clear
  // any prior fixture state first and use `INSERT OR IGNORE` for the user —
  // otherwise a retry trips a UNIQUE constraint and masks the real failure.
  await db.execute({
    sql: "DELETE FROM league_members WHERE league_id = ?",
    args: [LEAGUE_ID],
  });
  await db.execute({
    sql: "DELETE FROM leagues WHERE id = ?",
    args: [LEAGUE_ID],
  });
  await db.execute({
    sql: "INSERT OR IGNORE INTO user (id, name, email, created_at) VALUES (?, ?, ?, ?)",
    args: [PLAYER.id, PLAYER.name, PLAYER.email, Date.now()],
  });
  // `created_at` / `updated_at` / `joined_at` are populated by drizzle's
  // `$defaultFn` in app code, not by a SQL default, so the raw seed must set
  // them explicitly (timestamp_ms columns).
  const now = Date.now();
  await db.execute({
    sql: "INSERT INTO leagues (id, name, visibility, commissioner_id, season, season_year, max_players, status, created_at, updated_at) VALUES (?, ?, 'private', ?, 'SPRING', 2026, 8, 'setup', ?, ?)",
    args: [LEAGUE_ID, "E2E Kick League", TEST_USER.id, now, now],
  });
  await db.execute({
    sql: "INSERT INTO league_members (league_id, user_id, role, joined_at) VALUES (?, ?, 'commissioner', ?)",
    args: [LEAGUE_ID, TEST_USER.id, now],
  });
  await db.execute({
    sql: "INSERT INTO league_members (league_id, user_id, role, joined_at) VALUES (?, ?, 'player', ?)",
    args: [LEAGUE_ID, PLAYER.id, now + 1],
  });

  try {
    await page.goto(`/leagues/${LEAGUE_ID}/settings`);

    // The player is on the roster to start with.
    const roster = page.getByRole("region", { name: "Members" });
    await expect(roster.getByText(PLAYER.name)).toBeVisible();
    await page.screenshot({
      path: "screenshots/kick-player-roster.png",
      fullPage: true,
    });

    // Open the confirmation modal.
    await page.getByRole("button", { name: "Remove" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(PLAYER.name);
    await page.screenshot({
      path: "screenshots/kick-player-confirm.png",
      fullPage: true,
    });

    // Confirm the kick — the player drops off the roster immediately.
    await dialog.getByRole("button", { name: "Remove player" }).click();
    await expect(dialog).toBeHidden();
    await expect(roster.getByText(PLAYER.name)).toBeHidden();
    await page.screenshot({
      path: "screenshots/kick-player-after.png",
      fullPage: true,
    });

    // The artifact also calls for confirming the soft delete in the DB.
    const result = await db.execute({
      sql: "SELECT kicked_at FROM league_members WHERE league_id = ? AND user_id = ?",
      args: [LEAGUE_ID, PLAYER.id],
    });
    expect(result.rows[0]?.kicked_at).not.toBeNull();
  } finally {
    db.close();
  }
});
