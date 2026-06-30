/**
 * Hand-written types for the AniList GraphQL client (issue #42).
 *
 * AniList ships no official TypeScript types, and codegen would add a build step
 * and a schema-download dependency the MVP does not need. We hand-write the
 * narrow slice of the `Media` type the app actually selects (see `queries.ts`),
 * so a query and its return type stay reviewable side by side. When a new field
 * is needed, add it to both the query and the type here.
 *
 * The enum unions (`AniListSeason`, `AniListFormat`) are mirrored by hand in
 * `@anidraft/db` (`ANIME_SEASONS` / `ANIME_FORMATS`) and `packages/db`'s schema
 * — there is no compile-time link keeping them in sync, by design.
 */

/** AniList airing seasons, as the GraphQL `MediaSeason` enum spells them. */
export type AniListSeason = "WINTER" | "SPRING" | "SUMMER" | "FALL";

/**
 * AniList `MediaFormat` values that apply to anime. Mirrors the GraphQL enum;
 * the manga-only members (`MANGA`, `NOVEL`, `ONE_SHOT`) are omitted since every
 * query in this package pins `type: ANIME`.
 */
export type AniListFormat =
  | "TV"
  | "TV_SHORT"
  | "MOVIE"
  | "SPECIAL"
  | "OVA"
  | "ONA"
  | "MUSIC";

export interface AnimeTitle {
  romaji: string;
  english: string | null;
  native: string | null;
}

export interface AnimeCoverImage {
  extraLarge: string | null;
  large: string | null;
  medium: string | null;
  color: string | null;
}

/** A possibly-partial AniList date (any component may be unknown → null). */
export interface AnimeDate {
  year: number | null;
  month: number | null;
  day: number | null;
}

/**
 * The show-level anime metadata returned by `getAnimeById` and
 * `searchSeasonPool`. A direct mapping of the `MEDIA_FIELDS` selection — every
 * field here is selected in `queries.ts`.
 */
export interface Anime {
  id: number;
  title: AnimeTitle;
  /** Null when AniList has no format on record (rare, but possible mid-season). */
  format: AniListFormat | null;
  /** AniList `MediaStatus` (e.g. `RELEASING`, `FINISHED`); kept as a string. */
  status: string | null;
  description: string | null;
  season: AniListSeason | null;
  seasonYear: number | null;
  startDate: AnimeDate | null;
  /** Total planned episode count; null while AniList still reports it unknown. */
  episodes: number | null;
  /** Community average score, 0–100; null before any votes are in. */
  averageScore: number | null;
  meanScore: number | null;
  popularity: number | null;
  isAdult: boolean;
  genres: string[];
  coverImage: AnimeCoverImage;
  bannerImage: string | null;
  siteUrl: string | null;
}

/**
 * One per-episode score row, the shape the weekly scoring job consumes (mirrors
 * `episodes` in `@anidraft/db`).
 *
 * AniList exposes no *per-episode* community rating — only a single show-level
 * `averageScore`. So `score` is that show-level value captured at fetch time
 * (exactly what `episodes.score_when_last_fetched` stores), repeated per
 * episode; `airedAt` is the episode's own airing time from the airing schedule.
 * See docs/research/anilist-episode-scores.md for the spike that confirmed this
 * and the alternatives (AniDB/TMDB/Trakt/OMDb) that were considered and rejected.
 */
export interface EpisodeScore {
  /** 1-based episode number. */
  episode: number;
  /** When the episode aired (or is scheduled to); null when unscheduled. */
  airedAt: Date | null;
  /** Show-level `averageScore` (0–100) at fetch time; null before any votes. */
  score: number | null;
}

/** Filters for `searchSeasonPool`. The pool is always TV-format, non-adult. */
export interface SeasonPoolFilter {
  season: AniListSeason;
  year: number;
  /**
   * Page cap for the walk (AniList caps `perPage` at 50). A busy season rarely
   * exceeds a few hundred TV titles, so the default bounds the worst case while
   * still capturing the full pool.
   */
  maxPages?: number;
}
