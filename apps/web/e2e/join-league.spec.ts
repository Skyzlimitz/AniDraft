import { createClient } from "@libsql/client";

import { expect, test } from "./auth";
import { TEST_USER } from "./session";

/**
 * End-to-end coverage and browser artifact for the join-league flow (issue #30).
 *
 * The `auth` fixture signs the test in as the seeded e2e user (`TEST_USER`). To
 * exercise a genuine "join someone else's league" path, the test seeds a second
 * commissioner who owns a fresh private league + invite code directly in the e2e
 * database, then drives `TEST_USER` (who is NOT a member) through `/join/[code]`.
 *
 * Captures the success panel, confirms the membership landed in `setup`, and
 * verifies a re-visit is idempotent (the "already a member" message), the
 * acceptance criteria the issue calls for.
 */

const OWNER = {
  id: "e2e-join-owner",
  email: "join-owner@anidraft.test",
} as const;

const LEAGUE_ID = "e2e-join-league";
const INVITE_CODE = "JOINME23";

function e2eDb() {
  const url = process.env.DATABASE_URL ?? "file:./dev.db";
  return createClient({ url });
}

test.beforeAll(async () => {
  const db = e2eDb();
  const now = Date.now();
  try {
    await db.execute({
      sql: "INSERT INTO user (id, name, email) VALUES (?, ?, ?)",
      args: [OWNER.id, "Join Owner", OWNER.email],
    });
    await db.execute({
      sql: `INSERT INTO leagues
              (id, name, visibility, commissioner_id, season, season_year, max_players, status, created_at, updated_at)
            VALUES (?, ?, 'private', ?, 'SPRING', 2026, 8, 'setup', ?, ?)`,
      args: [LEAGUE_ID, "E2E Join League", OWNER.id, now, now],
    });
    await db.execute({
      sql: "INSERT INTO league_members (league_id, user_id, role, joined_at) VALUES (?, ?, 'commissioner', ?)",
      args: [LEAGUE_ID, OWNER.id, now],
    });
    await db.execute({
      sql: "INSERT INTO invite_codes (code, league_id, uses, created_at) VALUES (?, ?, 0, ?)",
      args: [INVITE_CODE, LEAGUE_ID, now],
    });
  } finally {
    db.close();
  }
});

test("a signed-in user joins a private league via its invite code", async ({
  page,
}) => {
  await page.goto(`/join/${INVITE_CODE}`);

  // Success panel for a first-time join.
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "You're in!",
  );
  await page.screenshot({
    path: "screenshots/join-league-success.png",
    fullPage: true,
  });

  // The membership row landed for the signed-in user (not the owner).
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

  // Re-visiting is idempotent: the already-member message, not a second row.
  await page.goto(`/join/${INVITE_CODE}`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "already in this league",
  );
  await page.screenshot({
    path: "screenshots/join-league-already-member.png",
    fullPage: true,
  });
});
