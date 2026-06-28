/**
 * Named GraphQL queries for the AniList client (issue #42).
 *
 * Kept as plain template strings (no codegen) so a query reads next to the
 * hand-written type it maps to in `types.ts`. The `MEDIA_FIELDS` selection is
 * shared by the show-level queries so they all return the same `Anime` shape.
 */

/**
 * The show-level field selection every `Media`-returning query uses. Mirrors the
 * `Anime` interface in `types.ts` field-for-field.
 */
export const MEDIA_FIELDS = `
  id
  title { romaji english native }
  format
  status
  description(asHtml: false)
  season
  seasonYear
  startDate { year month day }
  episodes
  averageScore
  meanScore
  popularity
  isAdult
  genres
  coverImage { extraLarge large medium color }
  bannerImage
  siteUrl
`;

/** `getAnimeById` — a single show by its AniList media id. */
export const GET_ANIME_BY_ID_QUERY = `
  query GetAnimeById($id: Int) {
    Media(id: $id, type: ANIME) {
      ${MEDIA_FIELDS}
    }
  }
`;

/**
 * `searchSeasonPool` — one page of the per-season draftable pool. Filters to
 * TV-format, non-adult titles, most popular first, so the result is the league's
 * default draft pool. Pagination is driven by the client (AniList caps `perPage`
 * at 50).
 */
export const SEARCH_SEASON_POOL_QUERY = `
  query SearchSeasonPool(
    $season: MediaSeason
    $seasonYear: Int
    $page: Int
    $perPage: Int
  ) {
    Page(page: $page, perPage: $perPage) {
      pageInfo { currentPage hasNextPage }
      media(
        season: $season
        seasonYear: $seasonYear
        type: ANIME
        format: TV
        isAdult: false
        sort: POPULARITY_DESC
      ) {
        ${MEDIA_FIELDS}
      }
    }
  }
`;

/**
 * `getEpisodeScores` — the per-episode airing schedule plus the show-level
 * `averageScore`. AniList exposes no per-episode rating, so the client pairs each
 * scheduled episode with the show-level score at fetch time (see `EpisodeScore`).
 */
export const GET_EPISODE_SCORES_QUERY = `
  query GetEpisodeScores($id: Int) {
    Media(id: $id, type: ANIME) {
      id
      episodes
      averageScore
      airingSchedule { nodes { episode airingAt } }
    }
  }
`;
