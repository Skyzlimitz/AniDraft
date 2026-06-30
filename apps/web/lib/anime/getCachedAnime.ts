import { eq } from "drizzle-orm";
import {
  anime,
  episodes,
  type AnimeFormat,
  type AnimeSeason,
  type Db,
} from "@anidraft/db";

/**
 * Cache reader for the `/api/anime/[id]` endpoint (issue #45).
 *
 * Reads anime metadata + per-episode scores from the local `anime` / `episodes`
 * mirror (issue #39) and **nothing else** — it imports `@anidraft/db` only,
 * never `@anidraft/anilist`. That import boundary is the "never hits AniList
 * live" guarantee: a user request can never trigger an upstream fetch, so it
 * can't burn the AniList rate limit. The cache is populated out of band by the
 * season-pool fetcher (#43) and the cron worker.
 *
 * Kept HTTP/Next-free so the route stays a thin adapter and this stays
 * unit-testable against a real migrated libSQL database.
 */

/** Cache staleness window: data last fetched longer ago than this is `stale`. */
export const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

/** One per-episode score row, as the endpoint exposes it. */
export interface CachedEpisode {
  episodeNumber: number;
  /** When the episode aired (or is scheduled to); null until AniList schedules it. */
  airDate: Date | null;
  /** Show-level `averageScore` (0–100) captured at last fetch; null before any votes. */
  score: number | null;
  /** When this episode row was last pulled from AniList. */
  fetchedAt: Date;
}

/** Show-level metadata, mirroring the modeled `anime` columns (not the raw blob). */
export interface CachedAnimeMetadata {
  id: number;
  title: string;
  romajiTitle: string;
  englishTitle: string | null;
  format: AnimeFormat | null;
  season: AnimeSeason | null;
  seasonYear: number | null;
  startDate: Date | null;
  episodesPlanned: number | null;
  coverImageUrl: string | null;
  isAdult: boolean;
}

/** The full cached view of one anime: metadata + episode scores + cache freshness. */
export interface CachedAnime {
  anime: CachedAnimeMetadata;
  episodes: CachedEpisode[];
  /**
   * The most recent `episodes.fetched_at` — "when this anime was last
   * refreshed". Null when the anime has no episode rows yet (metadata-only).
   */
  fetchedAt: Date | null;
  /**
   * True when the cache is older than {@link STALE_AFTER_MS} — or when there is
   * no episode data at all (no freshness signal). The endpoint still serves the
   * data; this just flags that a refresh is due.
   */
  stale: boolean;
}

/**
 * Read one anime from the cache by its AniList media id, or `null` when the id
 * isn't cached yet (the route maps that to a 404).
 *
 * `now` is injectable so the staleness boundary is testable without leaning on
 * the wall clock; production callers omit it.
 */
export async function getCachedAnime(
  db: Db,
  animeId: number,
  now: Date = new Date(),
): Promise<CachedAnime | null> {
  const [row] = await db
    .select()
    .from(anime)
    .where(eq(anime.id, animeId))
    .limit(1);
  if (!row) {
    return null;
  }

  // Per-episode scores, episode-number order — the natural display order and
  // what the leading PK column already sorts by.
  const episodeRows = await db
    .select({
      episodeNumber: episodes.episodeNumber,
      airDate: episodes.airDate,
      score: episodes.scoreWhenLastFetched,
      fetchedAt: episodes.fetchedAt,
    })
    .from(episodes)
    .where(eq(episodes.animeId, animeId))
    .orderBy(episodes.episodeNumber);

  // "When this anime was last refreshed" is the freshest episode fetch; episodes
  // are pulled together, so the newest stamp represents the whole row. Null when
  // there are no episodes — there's no freshness signal to report.
  const fetchedAt = episodeRows.reduce<Date | null>(
    (latest, episode) =>
      latest === null || episode.fetchedAt > latest
        ? episode.fetchedAt
        : latest,
    null,
  );

  // No episode data ⇒ no freshness signal ⇒ treat as stale (a refresh is due).
  const stale =
    fetchedAt === null || now.getTime() - fetchedAt.getTime() > STALE_AFTER_MS;

  return {
    anime: {
      id: row.id,
      title: row.title,
      romajiTitle: row.romajiTitle,
      englishTitle: row.englishTitle,
      format: row.format,
      season: row.season,
      seasonYear: row.seasonYear,
      startDate: row.startDate,
      episodesPlanned: row.episodesPlanned,
      coverImageUrl: row.coverImageUrl,
      isAdult: row.isAdult,
    },
    episodes: episodeRows,
    fetchedAt,
    stale,
  };
}
