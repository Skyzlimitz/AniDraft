import { createClient } from "@libsql/client";

import { expect, test } from "./auth";
import { TEST_USER } from "./session";

/**
 * Authenticated, data-dependent screenshot harness for the league settings
 * pages (issue #95).
 *
 * `apps/web/AGENTS.md` and the Definition of Done require a screenshot artifact
 * for every UI-touching change, but the settings forms sit behind auth and need
 * a seeded league, so they shipped without automated visual verification. This
 * spec closes that gap: it seeds one **public** lobby and one **private** league
 * (both owned by the seeded e2e commissioner, both in `setup`), loads
 * `/leagues/[id]/settings` for each, and captures a full-page screenshot — the
 * paired public-vs-private artifact reviewers can diff at a glance.
 *
 * The `auth` fixture injects the commissioner's session cookie, so both pages
 * render the editable form (not the read-only viewer or a sign-in redirect).
 *
 * ## Why seed in the test body (not `beforeAll`)
 *
 * Seeding happens inside the test, mirroring `kick-player.spec.ts`, rather than
 * a file-scope `test.beforeAll`. Both leagues are independent fixtures with no
 * shared setup to hoist, and keeping the seed inline sidesteps the
 * `base.extend()`-derived `test` hook quirk noted on the issue.
 *
 * ## Determinism
 *
 * Screenshots must be stable across machines, so the seeded `draftStartsAt` is a
 * fixed UTC instant and the Playwright project pins `timezoneId: "UTC"` (with a
 * matching `TZ=UTC` on the web server) — see `playwright.config.ts`. Without
 * that pin the `datetime-local` input would render the instant in the runner's
 * local timezone and the screenshot would drift.
 */

const PUBLIC_LEAGUE = {
  id: "e2e-settings-public",
  name: "E2E Public Lobby Settings",
} as const;

const PRIVATE_LEAGUE = {
  id: "e2e-settings-private",
  name: "E2E Private League Settings",
} as const;

// A fixed future instant for the seeded draft start. Pinned (not `Date.now()`
// relative) so the rendered `datetime-local` value is identical every run; with
// the UTC timezone pin this shows as `2026-09-01T18:00` in both inputs.
const DRAFT_STARTS_AT_MS = Date.UTC(2026, 8, 1, 18, 0, 0); // 2026-09-01T18:00:00Z

function e2eDb() {
  const url = process.env.DATABASE_URL ?? "file:./dev.db";
  return createClient({ url });
}

/**
 * Seed one league owned by the e2e commissioner in `setup` state. Idempotent so
 * a Playwright retry re-running the test body starts from a clean fixture.
 */
async function seedLeague(
  league: { id: string; name: string },
  visibility: "public" | "private",
): Promise<void> {
  const db = e2eDb();
  const now = Date.now();
  try {
    await db.execute({
      sql: "DELETE FROM league_members WHERE league_id = ?",
      args: [league.id],
    });
    await db.execute({
      sql: "DELETE FROM leagues WHERE id = ?",
      args: [league.id],
    });
    await db.execute({
      sql: `INSERT INTO leagues
              (id, name, visibility, commissioner_id, season, season_year,
               max_players, pick_timer_seconds, draft_starts_at, status,
               created_at, updated_at)
            VALUES (?, ?, ?, ?, 'SPRING', 2026, 8, 90, ?, 'setup', ?, ?)`,
      args: [
        league.id,
        league.name,
        visibility,
        TEST_USER.id,
        DRAFT_STARTS_AT_MS,
        now,
        now,
      ],
    });
    await db.execute({
      sql: "INSERT INTO league_members (league_id, user_id, role, joined_at) VALUES (?, ?, 'commissioner', ?)",
      args: [league.id, TEST_USER.id, now],
    });
  } finally {
    db.close();
  }
}

test("commissioner sees the stripped public-lobby settings form", async ({
  page,
}) => {
  await seedLeague(PUBLIC_LEAGUE, "public");

  await page.goto(`/leagues/${PUBLIC_LEAGUE.id}/settings`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Lobby settings",
  );

  // Public lobbies expose only max players + draft start, plus the fixed-rules
  // panel — and never the private-only fields.
  await expect(page.getByLabel("Max players")).toBeVisible();
  await expect(page.getByLabel(/Draft start/)).toBeVisible();
  await expect(page.getByText("Fixed lobby rules")).toBeVisible();
  await expect(page.getByLabel("League name")).toHaveCount(0);
  await expect(page.getByLabel("Pick timer (seconds)")).toHaveCount(0);

  await page.screenshot({
    path: "screenshots/settings-public-lobby.png",
    fullPage: true,
  });
});

test("commissioner sees the full private-league settings form", async ({
  page,
}) => {
  await seedLeague(PRIVATE_LEAGUE, "private");

  await page.goto(`/leagues/${PRIVATE_LEAGUE.id}/settings`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "League settings",
  );

  // Private leagues expose the full form: name + max players + pick timer +
  // draft start, and no fixed-rules panel.
  await expect(page.getByLabel("League name")).toBeVisible();
  await expect(page.getByLabel("Max players")).toBeVisible();
  await expect(page.getByLabel("Pick timer (seconds)")).toBeVisible();
  await expect(page.getByLabel(/Draft start/)).toBeVisible();
  await expect(page.getByText("Fixed lobby rules")).toHaveCount(0);

  await page.screenshot({
    path: "screenshots/settings-private-league.png",
    fullPage: true,
  });
});
