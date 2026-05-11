/**
 * AniList GraphQL API client — stub.
 *
 * This package wraps the AniList v2 GraphQL API:
 * https://anilist.gitbook.io/anilist-apiv2-docs
 *
 * Features (to be implemented):
 * - Rate limiting (90 requests/minute)
 * - Response caching (via packages/db anilist_cache table)
 * - Stale-cache fallback when API is down (Issue #61)
 */

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

/**
 * Query the AniList GraphQL API.
 * Stub — will be implemented with proper rate limiting and caching.
 */
export async function queryAniList<T>(
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const response = await fetch(ANILIST_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(`AniList API error: ${response.status} ${response.statusText}`);
  }

  const json = (await response.json()) as { data: T };
  return json.data;
}

/**
 * Fetch currently airing anime for a given season/year.
 * Stub — to be fully implemented.
 */
export async function fetchSeasonAnime(
  _season: string,
  _year: number
): Promise<AniListMedia[]> {
  // TODO: Implement with proper GraphQL query
  return [];
}
