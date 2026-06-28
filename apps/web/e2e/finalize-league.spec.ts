import { expect, test } from "./auth";
import { e2eDb, seedLeague } from "./seed";
import { TEST_USER } from "./session";

/**
 * End-to-end coverage and browser artifact for the finalize-league flow (issue
 * #37). Runs as the seeded e2e commissioner (the `auth` fixture injects a real
 * Auth.js session cookie), so `/leagues/[id]/settings` renders the editable view
 * with the commissioner's Finalize control.
 *
 * ## Why these screenshots, and why they're network-free
 *
 * The finalize *success* path sizes the draft pool against the live AniList
 * season fetch, and the screenshot workflow deliberately reaches no real
 * services (see `.github/workflows/web-screenshot.yml`). So rather than drive a
 * live finalize, this spec captures the three states that are fully deterministic
 * and together prove the feature:
 *
 * 1. `finalize-ready` — a ready private league showing the "Finalize league"
 *    button alongside the editable settings form.
 * 2. `finalize-blocked` — finalizing a league that's missing its draft start time
 *    surfaces the precondition error in the confirm modal. This path returns 422
 *    *before* any pool fetch (the domain logic checks the network-free
 *    preconditions first), so it's deterministic and service-free.
 * 3. `finalize-locked` — a league seeded already `finalized` renders the settings
 *    locked: name / max players / pick timer disabled, the finalized banner shown,
 *    and only the draft start still editable. This is the "verify locks engage"
 *    artifact the issue calls for.
 *
 * Determinism mirrors `settings.spec.ts`: a pinned future `draftStartsAt` plus the
 * UTC timezone pin in `playwright.config.ts`.
 */

// Each test seeds its own league (two write connections: the shared
// `seedLeague` plus an extra player). Run them serially so this file never has
// concurrent writers against the single local libSQL file, which otherwise
// surfaces as a flaky `SQLITE_BUSY` during seeding.
test.describe.configure({ mode: "serial" });

const READY_LEAGUE = {
  id: "e2e-finalize-ready",
  name: "E2E Finalize Ready",
} as const;
const BLOCKED_LEAGUE = {
  id: "e2e-finalize-blocked",
  name: "E2E Finalize Blocked",
} as const;
const LOCKED_LEAGUE = {
  id: "e2e-finalize-locked",
  name: "E2E Finalize Locked",
} as const;

const PLAYER = {
  id: "e2e-finalize-player",
  name: "E2E Finalize Player",
  email: "e2e-finalize-player@anidraft.test",
} as const;

// A fixed future instant for the seeded draft start (mirrors settings.spec.ts).
const DRAFT_STARTS_AT_MS = Date.UTC(2026, 8, 1, 18, 0, 0); // 2026-09-01T18:00:00Z

/** Add a second active player to a seeded league so it clears the member floor. */
async function seedExtraPlayer(leagueId: string): Promise<void> {
  const db = e2eDb();
  try {
    await db.execute({
      sql: "INSERT OR IGNORE INTO user (id, name, email) VALUES (?, ?, ?)",
      args: [PLAYER.id, PLAYER.name, PLAYER.email],
    });
    await db.execute({
      sql: "INSERT INTO league_members (league_id, user_id, role, joined_at) VALUES (?, ?, 'player', ?)",
      args: [leagueId, PLAYER.id, Date.now() + 1],
    });
  } finally {
    db.close();
  }
}

test("commissioner sees the Finalize control on a ready league", async ({
  page,
}) => {
  await seedLeague({
    ...READY_LEAGUE,
    visibility: "private",
    commissioner: { id: TEST_USER.id },
    draftStartsAtMs: DRAFT_STARTS_AT_MS,
  });
  await seedExtraPlayer(READY_LEAGUE.id);

  await page.goto(`/leagues/${READY_LEAGUE.id}/settings`);

  const finalize = page.getByRole("region", { name: "Finalize league" });
  await expect(
    finalize.getByRole("button", { name: "Finalize league" }),
  ).toBeVisible();
  await page.screenshot({
    path: "screenshots/finalize-ready.png",
    fullPage: true,
  });

  // Open the confirmation modal so the artifact shows the warning copy.
  await finalize.getByRole("button", { name: "Finalize league" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Finalize this league?");
});

test("finalize is blocked with a clear message when preconditions fail", async ({
  page,
}) => {
  // Two members but no draft start time → not ready. The missing-draft-time
  // precondition is evaluated without any pool fetch, so this is deterministic.
  await seedLeague({
    ...BLOCKED_LEAGUE,
    visibility: "private",
    commissioner: { id: TEST_USER.id },
    draftStartsAtMs: null,
  });
  await seedExtraPlayer(BLOCKED_LEAGUE.id);

  await page.goto(`/leagues/${BLOCKED_LEAGUE.id}/settings`);

  await page
    .getByRole("region", { name: "Finalize league" })
    .getByRole("button", { name: "Finalize league" })
    .click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  // Confirm — the server rejects it and the modal lists what to fix.
  await dialog.getByRole("button", { name: "Finalize league" }).click();
  await expect(dialog).toContainText("Not ready to finalize yet");
  await expect(dialog).toContainText(
    "Set a draft start time before finalizing",
  );
  await page.screenshot({
    path: "screenshots/finalize-blocked.png",
    fullPage: true,
  });

  // The league stays in setup — nothing was finalized.
  const db = e2eDb();
  try {
    const result = await db.execute({
      sql: "SELECT status FROM leagues WHERE id = ?",
      args: [BLOCKED_LEAGUE.id],
    });
    expect(result.rows[0]?.status).toBe("setup");
  } finally {
    db.close();
  }
});

test("a finalized league renders with its settings locked", async ({
  page,
}) => {
  // Seed straight into `finalized` so the page renders the post-finalize lock
  // without driving the (network-bound) transition.
  await seedLeague({
    ...LOCKED_LEAGUE,
    visibility: "private",
    commissioner: { id: TEST_USER.id },
    draftStartsAtMs: DRAFT_STARTS_AT_MS,
    status: "finalized",
  });
  await seedExtraPlayer(LOCKED_LEAGUE.id);

  await page.goto(`/leagues/${LOCKED_LEAGUE.id}/settings`);

  // The finalized banner is shown, and the locked fields are disabled while the
  // draft start stays editable.
  await expect(page.getByText("League finalized.")).toBeVisible();
  await expect(page.getByLabel("League name")).toBeDisabled();
  await expect(page.getByLabel("Max players")).toBeDisabled();
  await expect(page.getByLabel("Pick timer (seconds)")).toBeDisabled();
  await expect(page.getByLabel(/Draft start/)).toBeEnabled();
  // The finalize control is gone once the league has left setup.
  await expect(
    page.getByRole("region", { name: "Finalize league" }),
  ).toHaveCount(0);

  await page.screenshot({
    path: "screenshots/finalize-locked.png",
    fullPage: true,
  });
});
