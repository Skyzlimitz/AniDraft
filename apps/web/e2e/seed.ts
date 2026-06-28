import { createClient, type Client } from "@libsql/client";

/**
 * Shared seeding helpers for the e2e specs.
 *
 * Several specs need the same thing: a league owned by some commissioner, seeded
 * straight into the throwaway libSQL DB (`e2e/global-setup.ts` migrates it and
 * seeds `TEST_USER`) so an authed page has real data to render. Rather than each
 * spec re-implementing the delete-then-insert sequence, they share
 * {@link seedLeague} here. Keep this module free of `@playwright/test` imports so
 * it stays a plain data helper.
 */

/** A league lifecycle status, mirroring `LEAGUE_STATUSES` in `@anidraft/db`. */
type LeagueStatus =
  | "setup"
  | "finalized"
  | "drafting"
  | "in_season"
  | "completed";

/** Open a client against the same `file:` DB `next start` reads in e2e. */
export function e2eDb(): Client {
  const url = process.env.DATABASE_URL ?? "file:./dev.db";
  return createClient({ url });
}

export interface SeedLeagueOptions {
  /** Stable league id; pick a distinct value per spec to avoid collisions. */
  id: string;
  name: string;
  visibility: "public" | "private";
  /**
   * The league's commissioner. Pass `name`/`email` to seed the user too (e.g. a
   * second owner the signed-in `TEST_USER` then joins); omit them when the
   * commissioner is already seeded (like `TEST_USER` from global-setup).
   */
  commissioner: { id: string; name?: string; email?: string };
  /** Defaults mirror the create-league defaults / schema column defaults. */
  maxPlayers?: number;
  pickTimerSeconds?: number;
  /** Draft start as epoch ms (the `draft_starts_at` `timestamp_ms` column), or null. */
  draftStartsAtMs?: number | null;
  status?: LeagueStatus;
  season?: string;
  seasonYear?: number;
  /** When set, also seed an `invite_codes` row for the league (private joins). */
  inviteCode?: string;
}

/**
 * Seed one league (plus its commissioner membership, and optionally the owner
 * user and an invite code) in a known state.
 *
 * Idempotent: it clears any prior rows for the same league first, so a Playwright
 * retry — or a test body that re-runs the seed — starts clean instead of
 * tripping unique constraints or stacking membership rows. Opens and closes its
 * own connection so callers can seed several leagues without managing one.
 */
export async function seedLeague(options: SeedLeagueOptions): Promise<void> {
  const {
    id,
    name,
    visibility,
    commissioner,
    maxPlayers = 8,
    pickTimerSeconds = 60,
    draftStartsAtMs = null,
    status = "setup",
    season = "SPRING",
    seasonYear = 2026,
    inviteCode,
  } = options;

  const db = e2eDb();
  const now = Date.now();
  try {
    // Clear prior state for this fixture (FKs make order matter): memberships
    // and invite codes reference the league, so drop them before the league.
    await db.execute({
      sql: "DELETE FROM league_members WHERE league_id = ?",
      args: [id],
    });
    await db.execute({
      sql: "DELETE FROM invite_codes WHERE league_id = ?",
      args: [id],
    });
    await db.execute({
      sql: "DELETE FROM leagues WHERE id = ?",
      args: [id],
    });

    if (commissioner.name && commissioner.email) {
      // INSERT OR IGNORE so a retry doesn't trip the unique email constraint.
      // `created_at` is NOT NULL with only a drizzle-side $defaultFn, so this
      // raw insert must supply it (timestamp_ms) or OR IGNORE silently drops
      // the row and the leagues FK below fails.
      await db.execute({
        sql: "INSERT OR IGNORE INTO user (id, name, email, created_at) VALUES (?, ?, ?, ?)",
        args: [
          commissioner.id,
          commissioner.name,
          commissioner.email,
          Date.now(),
        ],
      });
    }

    await db.execute({
      sql: `INSERT INTO leagues
              (id, name, visibility, commissioner_id, season, season_year,
               max_players, pick_timer_seconds, draft_starts_at, status,
               created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id,
        name,
        visibility,
        commissioner.id,
        season,
        seasonYear,
        maxPlayers,
        pickTimerSeconds,
        draftStartsAtMs,
        status,
        now,
        now,
      ],
    });

    await db.execute({
      sql: "INSERT INTO league_members (league_id, user_id, role, joined_at) VALUES (?, ?, 'commissioner', ?)",
      args: [id, commissioner.id, now],
    });

    if (inviteCode) {
      await db.execute({
        sql: "INSERT INTO invite_codes (code, league_id, uses, created_at) VALUES (?, ?, 0, ?)",
        args: [inviteCode, id, now],
      });
    }
  } finally {
    db.close();
  }
}
