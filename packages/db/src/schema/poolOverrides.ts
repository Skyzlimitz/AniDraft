import {
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { leagues } from "./leagues";

/**
 * Commissioner pool overrides for a private league (issue #36).
 *
 * The draftable show pool for a league is, by default, the set of anime AniList
 * returns for the league's `season`/`seasonYear`. Before finalizing, a private
 * league's commissioner can tweak that auto-fetched pool two ways:
 *
 * - **exclude** a show that the auto-filter pulled in (e.g. a sequel nobody
 *   wants), or
 * - **add** a show the auto-filter missed (e.g. an off-season carry-over).
 *
 * Both kinds of tweak are stored here, one row per (league, AniList media),
 * distinguished by `kind`. The effective pool is then
 * `(auto_pool − exclusions) ∪ additions`, computed at read time — we never
 * materialise the whole pool, so an upstream AniList change still flows through.
 * Overrides are frozen when the league finalizes (enforced in the domain layer,
 * `updatePoolOverrides`); this table just records them.
 *
 * ## Why a snapshot title/cover on additions
 *
 * An *exclusion* names a show already in the auto pool, so its title/cover are
 * available from that fetch — we only need the id. An *addition* names a show
 * that is **not** in the season fetch, so there is nothing to join against to
 * render it. We snapshot `title` + `coverImage` at add-time so the editor (and
 * later the draft board) can show the added show without a second AniList
 * lookup per id. These columns are null for exclusions.
 *
 * ## Encoding
 *
 * `kind` follows the same readable-`text`-enum convention as the league tables
 * (issue #27): self-describing rows over an int↔label mapping. `anilistId` is
 * the AniList media id (an integer), stored as-is.
 *
 * Migration: drizzle-kit, same as the other schema files — `db:generate` emits
 * the forward-only SQL into `drizzle/`.
 */

/** Whether an override adds a show to, or removes one from, the auto pool. */
export const POOL_OVERRIDE_KINDS = ["addition", "exclusion"] as const;
export type PoolOverrideKind = (typeof POOL_OVERRIDE_KINDS)[number];

export const poolOverrides = sqliteTable(
  "pool_overrides",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    leagueId: text("league_id")
      .notNull()
      .references(() => leagues.id, { onDelete: "cascade" }),
    // The AniList media id this override applies to. A given show is either
    // added or excluded for a league, never both — the domain layer rebuilds the
    // whole override set on each save, so it can't write a contradictory pair.
    // The `(league_id, anilist_id)` unique index below makes that invariant a
    // DB-level guarantee, not just an application convention.
    anilistId: integer("anilist_id").notNull(),
    kind: text("kind", { enum: POOL_OVERRIDE_KINDS }).notNull(),
    // Snapshot of the show, populated only for additions (null for exclusions),
    // so the editor can render an added show that isn't in the season fetch.
    title: text("title"),
    coverImage: text("cover_image"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    // At most one override row per (league, show): a show is added or excluded,
    // never both and never duplicated. The domain layer already rebuilds the
    // whole set per save, but this makes the invariant unbreakable for any future
    // write path — and doubles as the FK-covering index for "all overrides for
    // this league" (the only access pattern), since its leading column is
    // `league_id`, so no separate index is needed.
    leagueShowIdx: uniqueIndex("pool_overrides_league_id_anilist_id_idx").on(
      table.leagueId,
      table.anilistId,
    ),
  }),
);
