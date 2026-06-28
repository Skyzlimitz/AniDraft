import {
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { users } from "./auth";
import { leagues } from "./leagues";

/**
 * Scoring history schema: the weekly snapshot of every player's score (issue
 * #41).
 *
 * Each `weekly_snapshots` row is one user's standing in one league at the close
 * of one season week, written once by the weekly snapshot worker and never
 * touched again. The table is **append-only / immutable**: it is the historical
 * record scoring trends and the standings timeline are drawn from, so a row,
 * once written, is a fixed fact about that week. There are deliberately no
 * `updated_at` column and no update paths — a correction is a new week's
 * snapshot, not a rewrite of an old one. (SQLite cannot itself forbid an
 * `UPDATE`; immutability is an application invariant the writer upholds, the way
 * the draft `picks` log is append-only.)
 *
 * ## Encoding
 *
 * `score_value` is the user's total score for the week, stored as an integer in
 * the same whole-number units the scoring formula (`@anidraft/scoring`) emits.
 * `anime_breakdown_json` is the per-show contribution that sums to that total —
 * always read and written whole (the standings UI loads a snapshot and expands
 * its breakdown), never queried into, so a JSON `text` column (`mode: "json"`)
 * beats a per-show child table. It is keyed by AniList media id; the `$type`
 * pins the shape the inferred row exposes. `week_number` is the 1-based season
 * week, matching `roster_swaps.week_number`. Dates use the same `timestamp_ms`
 * integer encoding as every other date column in the schema.
 *
 * Migration: drizzle-kit, same as the other schema files — `db:generate` emits
 * the forward-only SQL into `drizzle/`.
 */

/**
 * Per-show breakdown of a weekly snapshot's total: the score each anime on the
 * user's roster contributed that week, keyed by AniList media id. Stored whole
 * in `anime_breakdown_json`; the keys are the same media ids the `anime` mirror
 * uses (JSON object keys are strings, so the id is stringified).
 */
export type AnimeScoreBreakdown = Record<string, number>;

export const weeklySnapshots = sqliteTable(
  "weekly_snapshots",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    leagueId: text("league_id")
      .notNull()
      .references(() => leagues.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // The 1-based season week this snapshot captures; matches
    // `roster_swaps.week_number`.
    weekNumber: integer("week_number").notNull(),
    // The user's total score for the week, in the scoring formula's whole-number
    // units (`@anidraft/scoring`).
    scoreValue: integer("score_value").notNull(),
    // Per-show contributions that sum to `score_value`. Read/written whole, never
    // queried into, so a JSON column beats a child table. Keyed by AniList id.
    animeBreakdownJson: text("anime_breakdown_json", { mode: "json" })
      .$type<AnimeScoreBreakdown>()
      .notNull(),
    snapshottedAt: integer("snapshotted_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    // One snapshot per (league, user, week): the snapshot worker writes each
    // user's week exactly once, and this makes that a DB-level guarantee while
    // also serving as the FK-covering / "this user's history in this league"
    // index via its leading (league_id, user_id) prefix.
    leagueUserWeekIdx: uniqueIndex(
      "weekly_snapshots_league_id_user_id_week_number_idx",
    ).on(table.leagueId, table.userId, table.weekNumber),
  }),
);
