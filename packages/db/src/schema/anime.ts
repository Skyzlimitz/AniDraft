import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

/**
 * AniList-backed anime + per-episode schema (issue #39).
 *
 * `anime` is a local mirror of the AniList `Media` records the app draws from —
 * keyed by the real AniList media id, not a synthetic one, so a row maps 1:1 to
 * its upstream show and we never invent ids. `episodes` holds the per-episode
 * airing + scoring data the weekly scoring job reads.
 *
 * ## Why there is no separate `anilist_cache` table
 *
 * The original issue floated an `anilist_cache` table alongside `episodes`. We
 * collapsed it: caching AniList responses *is* what these two tables do. `anime`
 * caches the show-level metadata (with the full upstream payload kept in
 * `raw_metadata` so a new field never needs a migration to be readable), and
 * `episodes.fetched_at` / `score_when_last_fetched` cache the episode-level
 * airing + score data with the staleness stamp a cache needs. A third generic
 * cache table would only duplicate that, so it is deliberately omitted.
 *
 * ## Encoding
 *
 * Enums (`format`, `season`) follow the readable-`text`-enum convention the
 * league tables established (issue #27): self-describing rows over an int↔label
 * mapping. The enum values are spelled exactly as the AniList GraphQL
 * `MediaFormat` / `MediaSeason` enums spell them, so a fetched value stores
 * as-is. Calendar dates (`start_date`, `air_date`) use the same
 * `timestamp_ms` integer encoding as every other date column in the schema.
 *
 * Migration: drizzle-kit, same as the other schema files — `db:generate` emits
 * the forward-only SQL into `drizzle/`.
 */

/**
 * AniList `MediaFormat` values that apply to anime. Mirrors the GraphQL enum;
 * the manga-only members (`MANGA`, `NOVEL`, `ONE_SHOT`) are intentionally
 * omitted since this table only ever holds `type: ANIME` media.
 */
export const ANIME_FORMATS = [
  "TV",
  "TV_SHORT",
  "MOVIE",
  "SPECIAL",
  "OVA",
  "ONA",
  "MUSIC",
] as const;
export type AnimeFormat = (typeof ANIME_FORMATS)[number];

/**
 * AniList airing seasons, as the GraphQL `MediaSeason` enum spells them. Mirrors
 * `LEAGUE_SEASONS` in `leagues.ts` and `AniListSeason` in `@anidraft/anilist` by
 * hand — there is no compile-time link keeping the three in sync.
 */
export const ANIME_SEASONS = ["WINTER", "SPRING", "SUMMER", "FALL"] as const;
export type AnimeSeason = (typeof ANIME_SEASONS)[number];

export const anime = sqliteTable(
  "anime",
  {
    // The AniList media id, used verbatim as the primary key. Not autoincrement:
    // a row is the local mirror of one upstream show and shares its identity.
    id: integer("id").primaryKey(),
    // Display title (AniList resolves this per the viewer's title-language
    // preference; we store the romaji form as the canonical default). The
    // language-specific variants are kept alongside for search/display.
    title: text("title").notNull(),
    romajiTitle: text("romaji_title").notNull(),
    // English + native titles are frequently absent on AniList, so nullable.
    englishTitle: text("english_title"),
    // Null when AniList has no format on record (rare, but possible mid-season).
    format: text("format", { enum: ANIME_FORMATS }),
    season: text("season", { enum: ANIME_SEASONS }),
    seasonYear: integer("season_year"),
    // AniList `startDate` can be a partial/unknown date; null when unknown.
    startDate: integer("start_date", { mode: "timestamp_ms" }),
    // Total planned episode count; null while AniList still reports it unknown
    // (e.g. long-running or not-yet-announced shows).
    episodesPlanned: integer("episodes_planned"),
    coverImageUrl: text("cover_image_url"),
    // AniList `isAdult`; stored as a 0/1 integer (SQLite has no boolean).
    isAdult: integer("is_adult", { mode: "boolean" }).notNull().default(false),
    // The full upstream AniList payload, kept verbatim so any field the app
    // doesn't yet model is still readable without a re-fetch or a migration.
    rawMetadata: text("raw_metadata", { mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull(),
  },
  (table) => ({
    // The per-season pool fetch (`fetchSeasonAnime`) filters on
    // (season, season_year); SQLite won't index that for us.
    seasonIdx: index("anime_season_season_year_idx").on(
      table.season,
      table.seasonYear,
    ),
  }),
);

export const episodes = sqliteTable(
  "episodes",
  {
    animeId: integer("anime_id")
      .notNull()
      .references(() => anime.id, { onDelete: "cascade" }),
    episodeNumber: integer("episode_number").notNull(),
    // When the episode aired (or is scheduled to); null until AniList schedules
    // it. Same `timestamp_ms` encoding as the rest of the schema.
    airDate: integer("air_date", { mode: "timestamp_ms" }),
    // AniList `averageScore` (0–100 integer) captured the last time this episode
    // row was refreshed — the value the scoring job reads. Null before the first
    // score is available. AniList exposes no per-episode rating, so this is the
    // show-level score repeated per episode; see
    // docs/research/anilist-episode-scores.md for why.
    scoreWhenLastFetched: integer("score_when_last_fetched"),
    // Cache staleness stamp: when this episode row was last pulled from AniList.
    fetchedAt: integer("fetched_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    // One row per (anime, episode); also the natural lookup key, and its leading
    // `anime_id` column covers "all episodes for this anime" (the only access
    // pattern), so no separate FK-covering index is needed.
    compositePk: primaryKey({
      columns: [table.animeId, table.episodeNumber],
    }),
  }),
);
