/**
 * Season pool fetcher (issue #43).
 *
 * Given a `{ season, year }`, fetch the eligible draft pool from AniList and
 * return it already shaped like the `anime` table in `@anidraft/db` — so the
 * league-creation flow (and the commissioner pool-override page) can persist the
 * result without a second mapping pass. Persisting is out of scope here; this
 * module only fetches and maps.
 *
 * ## Naming
 *
 * This returns `anime`-insert *rows*, not the editor's flattened `PoolShow`. The
 * web app already has a `fetchSeasonPool(season, year) -> PoolShow[]`
 * (`apps/web/lib/leagues/seasonPool.ts`) wired into the pool editor; this
 * package-level function is deliberately named `fetchSeasonPoolRows` so the two
 * never get confused — a caller picks the row variant explicitly.
 *
 * ## Eligibility
 *
 * The pool is TV-format, non-adult anime matching the given season/year. The
 * `searchSeasonPool` GraphQL query already pins `format: TV` and
 * `isAdult: false` server-side, but we re-apply the predicate client-side too:
 * it keeps the eligibility rule visible and testable in one place, and guards
 * against AniList ever returning an off-filter row.
 *
 * Shows that span seasons (carryovers) are included iff AniList tags them as
 * this season — we trust the upstream `season`/`seasonYear` tag (which the query
 * filters on) and leave any adjustment to the commissioner override page (per
 * the issue's Q8 hybrid resolution).
 *
 * ## Insert-safety
 *
 * The result is de-duplicated by AniList id (first occurrence wins, preserving
 * the popularity order). `searchSeasonPool` walks `POPULARITY_DESC` pages and
 * concatenates them, and popularity ranks can shift mid-walk, so the same media
 * can appear on two pages. Since `anime.id` is the primary key, returning the
 * raw concatenation could make a downstream `db.insert(anime).values(rows)`
 * throw a PK violation — deduping here keeps the "ready-to-persist" contract true.
 *
 * ## Return shape
 *
 * Each item is a `typeof anime.$inferInsert` row, so it matches the DB schema by
 * construction (a compile error here means the schema and this mapper drifted).
 * The full upstream payload is kept verbatim in `rawMetadata`, mirroring the
 * schema's intent that any not-yet-modelled field stays readable without a
 * re-fetch.
 */

import { AniListClient } from "./client";
import type { Anime, AniListSeason, AnimeDate } from "./types";
// Type-only import: we use the table solely to derive its insert-row type. The
// derived type is re-exported (public surface), so `@anidraft/db` is a regular
// `dependency` in package.json even though nothing is imported at runtime.
import type { anime } from "@anidraft/db/schema";

/**
 * One eligible-pool row, shaped exactly like an `anime` insert in `@anidraft/db`.
 * Derived from the table so it cannot drift from the schema.
 */
export type SeasonPoolAnime = typeof anime.$inferInsert;

export interface FetchSeasonPoolRowsOptions {
  season: AniListSeason;
  year: number;
  /**
   * Page cap forwarded to `searchSeasonPool` (AniList caps `perPage` at 50). The
   * client default (10 → up to 500 titles) comfortably covers a normal season;
   * an unusually large season could be truncated at the cap, so raise this if a
   * pool is ever expected to exceed it.
   */
  maxPages?: number;
  /**
   * Client to fetch with. Defaults to a fresh `AniListClient` (env token,
   * process-wide pacer). Injectable so tests can supply a stubbed transport.
   */
  client?: AniListClient;
}

/**
 * Convert AniList's possibly-partial `startDate` into a `Date` for the
 * `timestamp_ms` column. Returns null unless at least the year is known; missing
 * month/day default to January 1st. UTC so the stored instant is timezone-free,
 * matching the rest of the schema's date columns.
 */
function startDateToTimestamp(date: AnimeDate | null): Date | null {
  if (!date || date.year === null) return null;
  return new Date(Date.UTC(date.year, (date.month ?? 1) - 1, date.day ?? 1));
}

/** Map one AniList `Anime` onto an `anime`-table insert row. */
function toPoolRow(media: Anime): SeasonPoolAnime {
  return {
    id: media.id,
    // The schema's canonical display title is the romaji form.
    title: media.title.romaji,
    romajiTitle: media.title.romaji,
    englishTitle: media.title.english,
    format: media.format,
    season: media.season,
    seasonYear: media.seasonYear,
    startDate: startDateToTimestamp(media.startDate),
    episodesPlanned: media.episodes,
    coverImageUrl:
      media.coverImage.extraLarge ??
      media.coverImage.large ??
      media.coverImage.medium ??
      null,
    isAdult: media.isAdult,
    // Keep the full upstream payload so any unmodelled field stays readable.
    rawMetadata: media as unknown as Record<string, unknown>,
  };
}

/**
 * Fetch the eligible draft pool for a season/year as ready-to-persist `anime`
 * rows: TV-format, non-adult, season-tagged, most popular first, de-duplicated
 * by id. Walks every AniList page (via {@link AniListClient.searchSeasonPool})
 * and maps each result onto the `@anidraft/db` `anime` insert shape.
 */
export async function fetchSeasonPoolRows({
  season,
  year,
  maxPages,
  client,
}: FetchSeasonPoolRowsOptions): Promise<SeasonPoolAnime[]> {
  const aniList = client ?? new AniListClient();
  const media = await aniList.searchSeasonPool({ season, year, maxPages });

  const rows: SeasonPoolAnime[] = [];
  const seen = new Set<number>();
  for (const m of media) {
    if (m.format !== "TV" || m.isAdult) continue;
    if (seen.has(m.id)) continue; // dedupe: first (most popular) occurrence wins
    seen.add(m.id);
    rows.push(toPoolRow(m));
  }
  return rows;
}
