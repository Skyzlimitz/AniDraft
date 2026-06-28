import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  fetchSeasonAnime,
  queryAniList,
  searchAnime,
  type AniListMedia,
} from "./index";

/**
 * Tests for the AniList transport (issue #36). `fetch` is stubbed so no real
 * network call is made; we assert pagination, the empty-search short-circuit,
 * and error surfacing for HTTP and GraphQL-level failures.
 */

function media(id: number): AniListMedia {
  return {
    id,
    title: { romaji: `Show ${id}`, english: null, native: null },
    coverImage: { large: `https://img/${id}-l.jpg`, medium: `m` },
    bannerImage: null,
    averageScore: null,
    popularity: 0,
    trending: 0,
    favourites: 0,
    episodes: null,
    status: "RELEASING",
    season: "SPRING",
    seasonYear: 2026,
    genres: [],
    studios: { nodes: [] },
  };
}

/** Build a `fetch` response wrapping a GraphQL `Page`. */
function pageResponse(
  mediaList: AniListMedia[],
  hasNextPage: boolean,
  currentPage = 1,
) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => ({
      data: {
        Page: { pageInfo: { currentPage, hasNextPage }, media: mediaList },
      },
    }),
  } as Response;
}

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("queryAniList", () => {
  it("throws on a non-2xx HTTP status", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
    } as Response);

    await expect(queryAniList("query {}")).rejects.toThrow("429");
  });

  it("throws when the GraphQL response carries errors", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ data: null, errors: [{ message: "bad field" }] }),
    } as Response);

    await expect(queryAniList("query {}")).rejects.toThrow("bad field");
  });
});

describe("fetchSeasonAnime", () => {
  it("walks every page until hasNextPage is false", async () => {
    fetchMock
      .mockResolvedValueOnce(pageResponse([media(1), media(2)], true, 1))
      .mockResolvedValueOnce(pageResponse([media(3)], false, 2));

    const result = await fetchSeasonAnime("SPRING", 2026);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.map((m) => m.id)).toEqual([1, 2, 3]);
  });

  it("stops at maxPages even if more pages remain", async () => {
    fetchMock.mockResolvedValue(pageResponse([media(1)], true));

    const result = await fetchSeasonAnime("SPRING", 2026, 2);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(2);
  });
});

describe("searchAnime", () => {
  it("short-circuits an empty query without calling fetch", async () => {
    const result = await searchAnime("   ");
    expect(result).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns the matched media for a non-empty query", async () => {
    fetchMock.mockResolvedValue(pageResponse([media(42)], false));

    const result = await searchAnime("naruto");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.map((m) => m.id)).toEqual([42]);
  });
});
