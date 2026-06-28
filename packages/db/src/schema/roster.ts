import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { anime } from "./anime";
import { users } from "./auth";
import { leagues } from "./leagues";

/**
 * Roster schema: a league's materialised rosters and the in-season swap log
 * (issue #40).
 *
 * A roster is conceptually *derived* — it is the set of shows a user currently
 * holds, computable from their draft `picks` plus every `roster_swap` applied
 * since. We materialise it anyway, one row per (user, show) acquisition, so the
 * hot "what is on this user's roster right now" query is a single indexed read
 * instead of a fold over the pick + swap history. The derivation tables stay
 * the source of truth; this table is the cache kept in step with them.
 *
 * ## History, not just current state
 *
 * `released_at` is nullable: a live holding has `released_at = NULL`, and a
 * dropped one keeps its row with the drop time stamped. So a user can hold,
 * drop, then re-acquire the same show and accumulate several rows for it over a
 * season — which is why there is deliberately **no** unique constraint on
 * (league, user, anime). The `roster_swaps` table records the paired
 * drop/pick-up that drives those `released_at` / new-row transitions.
 *
 * ## Encoding
 *
 * `anime_id`, `dropped_anime_id`, and `picked_up_anime_id` are AniList media
 * ids (integers), referencing the local `anime` mirror. Dates use the same
 * `timestamp_ms` integer encoding as every other date column in the schema.
 *
 * Migration: drizzle-kit, same as the other schema files — `db:generate` emits
 * the forward-only SQL into `drizzle/`.
 */

export const rosters = sqliteTable(
  "rosters",
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
    animeId: integer("anime_id")
      .notNull()
      .references(() => anime.id, { onDelete: "cascade" }),
    acquiredAt: integer("acquired_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    // Null while the show is on the roster; stamped when it is dropped. Kept
    // (rather than deleting the row) so the roster's history is queryable.
    releasedAt: integer("released_at", { mode: "timestamp_ms" }),
  },
  (table) => ({
    // The hot read is "this user's roster in this league"; the composite index
    // serves it and, via its leading `league_id`, also covers "all rosters in
    // this league" and the league_id FK — so no separate index is needed.
    leagueUserIdx: index("rosters_league_id_user_id_idx").on(
      table.leagueId,
      table.userId,
    ),
  }),
);

export const rosterSwaps = sqliteTable(
  "roster_swaps",
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
    // The show dropped and the show picked up in this single waiver move. Both
    // reference the local `anime` mirror.
    droppedAnimeId: integer("dropped_anime_id")
      .notNull()
      .references(() => anime.id, { onDelete: "cascade" }),
    pickedUpAnimeId: integer("picked_up_anime_id")
      .notNull()
      .references(() => anime.id, { onDelete: "cascade" }),
    // The season week (1-based) the swap took effect in; scoring reads it to
    // attribute episodes to the right holder.
    weekNumber: integer("week_number").notNull(),
    swappedAt: integer("swapped_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    // Mirrors the rosters hot path: "this user's swaps in this league", with the
    // leading `league_id` also covering "all swaps in this league" + the FK.
    leagueUserIdx: index("roster_swaps_league_id_user_id_idx").on(
      table.leagueId,
      table.userId,
    ),
  }),
);
