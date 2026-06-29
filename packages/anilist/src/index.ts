/**
 * AniList GraphQL API client.
 *
 * This package wraps the AniList v2 GraphQL API:
 * https://anilist.gitbook.io/anilist-apiv2-docs
 *
 * Scope of this module: the read queries the app needs — the per-season pool
 * fetch (`fetchSeasonAnime`) and a title search (`searchAnime`) used by the
 * commissioner pool editor (issue #36). Cross-cutting concerns are deliberately
 * left to their own issues so this stays a thin, testable transport:
 * - Rate limiting (90 requests/minute)
 * - Response caching (via the `anilist_cache` table in packages/db)
 * - Stale-cache fallback when the API is down (issue #61)
 */

import type { AniListSeason } from "./types";

const ANILIST_API_URL = "https://graphql.anilist.co";

export interface AniListMedia {
  id: number;
  title: {
    romaji: string;
    english: string | null;
    native: string | null;
  };
  coverImage: {
    large: string;
    medium: string;
  };
  bannerImage: string | null;
  averageScore: number | null;
  popularity: number;
  trending: number;
  favourites: number;
  episodes: number | null;
  status: string;
  season: string | null;
  seasonYear: number | null;
  genres: string[];
  studios: {
    nodes: Array<{ id: number; name: string }>;
  };
}

/** The media fields every query in this module selects. */
const MEDIA_FIELDS = `
  id
  title { romaji english native }
  coverImage { large medium }
  bannerImage
  averageScore
  popularity
  trending
  favourites
  episodes
  status
  season
  seasonYear
  genres
  studios { nodes { id name } }
`;

interface PageResponse {
  Page: {
    pageInfo: { currentPage: number; hasNextPage: boolean };
    media: AniListMedia[];
  };
}

/**
 * Query the AniList GraphQL API.
 *
 * A thin POST wrapper: it throws on a non-2xx HTTP status and on a GraphQL-level
 * `errors` array (AniList answers 200 with `errors` for things like an invalid
 * field), so callers can treat a resolved value as real `data`.
 */
export async function queryAniList<T>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(ANILIST_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(
      `AniList API error: ${response.status} ${response.statusText}`,
    );
  }

  const json = (await response.json()) as {
    data: T;
    errors?: Array<{ message: string }>;
  };
  if (json.errors && json.errors.length > 0) {
    throw new Error(
      `AniList GraphQL error: ${json.errors.map((e) => e.message).join("; ")}`,
    );
  }
  return json.data;
}

const SEASON_QUERY = `
  query SeasonAnime($season: MediaSeason, $seasonYear: Int, $page: Int) {
    Page(page: $page, perPage: 50) {
      pageInfo { currentPage hasNextPage }
      media(
        season: $season
        seasonYear: $seasonYear
        type: ANIME
        sort: POPULARITY_DESC
      ) {
        ${MEDIA_FIELDS}
      }
    }
  }
`;

/**
 * Fetch the anime airing in a given season/year, most popular first.
 *
 * This is the league's auto-fetched default pool: every page is walked (AniList
 * caps `perPage` at 50) up to `maxPages` so a busy season isn't silently
 * truncated, while the cap bounds the worst case. Duplicate-free by construction
 * — AniList paginates a stable sort.
 */
export async function fetchSeasonAnime(
  season: AniListSeason,
  year: number,
  maxPages = 5,
): Promise<AniListMedia[]> {
  const all: AniListMedia[] = [];
  let page = 1;
  for (; page <= maxPages; page++) {
    const data = await queryAniList<PageResponse>(SEASON_QUERY, {
      season,
      seasonYear: year,
      page,
    });
    all.push(...data.Page.media);
    if (!data.Page.pageInfo.hasNextPage) break;
  }
  return all;
}

const SEARCH_QUERY = `
  query SearchAnime($search: String, $perPage: Int) {
    Page(page: 1, perPage: $perPage) {
      pageInfo { currentPage hasNextPage }
      media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
        ${MEDIA_FIELDS}
      }
    }
  }
`;

/**
 * Search AniList for anime by title — the "add a show the auto-filter missed"
 * half of the commissioner pool editor (issue #36). Returns at most `perPage`
 * best-match results (default 20); an empty/whitespace query short-circuits to
 * `[]` so a cleared search box doesn't fire a wildcard request.
 */
export async function searchAnime(
  search: string,
  perPage = 20,
): Promise<AniListMedia[]> {
  const trimmed = search.trim();
  if (trimmed === "") return [];
  const data = await queryAniList<PageResponse>(SEARCH_QUERY, {
    search: trimmed,
    perPage,
  });
  return data.Page.media;
}

/**
 * Issue #42 — the retry/backoff/paced client and its hand-written types. The
 * legacy thin transport above (`queryAniList`, `fetchSeasonAnime`,
 * `searchAnime`, `AniListMedia`) predates it and is kept for its existing
 * consumers; new callers should prefer the `AniListClient` and the
 * `getAnimeById` / `searchSeasonPool` / `getEpisodeScores` helpers below.
 */
export * from "./types";
export * from "./queries";
export * from "./pacer";
export * from "./client";
export * from "./seasonPool";
