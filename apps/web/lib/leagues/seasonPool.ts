import {
  fetchSeasonAnime,
  searchAnime,
  type AniListMedia,
  type AniListSeason,
} from "@anidraft/anilist";

import type { PoolShow } from "./poolEditor";

/**
 * Adapters wiring the AniList client to the pool-editor domain layer (issue
 * #36). The editor only needs a show's id, a display title, and a cover image,
 * so these flatten the rich {@link AniListMedia} down to a {@link PoolShow}.
 * Keeping the mapping here (not in `poolEditor.ts`) lets the domain logic stay
 * client-agnostic and unit-testable with a plain fake fetcher/searcher.
 */

/** Best display title: English when present, else romaji. */
function displayTitle(media: AniListMedia): string {
  return media.title.english ?? media.title.romaji;
}

function toPoolShow(media: AniListMedia): PoolShow {
  return {
    anilistId: media.id,
    title: displayTitle(media),
    coverImage: media.coverImage.large ?? media.coverImage.medium ?? null,
  };
}

/** The league's auto-fetched season pool, flattened for the editor. */
export async function fetchSeasonPool(
  season: AniListSeason,
  year: number,
): Promise<PoolShow[]> {
  const media = await fetchSeasonAnime(season, year);
  return media.map(toPoolShow);
}

/** AniList title search, flattened for the "add a show" picker. */
export async function searchPool(query: string): Promise<PoolShow[]> {
  const media = await searchAnime(query);
  return media.map(toPoolShow);
}
