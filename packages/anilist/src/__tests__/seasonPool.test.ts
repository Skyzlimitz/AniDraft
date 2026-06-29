import { describe, expect, it, vi } from "vitest";

import { AniListClient } from "../client";
import { Pacer } from "../pacer";
import { fetchSeasonPoolRows, type SeasonPoolAnime } from "../seasonPool";
import type { Anime } from "../types";

/**
 * Tests for the season pool fetcher (issue #43). `fetch` is injected into an
 * isolated, zero-gap client so no real network call is made, and we assert: the
 * AniList -> `anime`-row mapping, the TV/non-adult eligibility filter, and that
 * pagination is walked (delegated to `searchSeasonPool`).
 */

function anime(id: number, overrides: Partial<Anime> = {}): Anime {
  return {
    id,
    title: { romaji: `Show ${id}`, english: `English ${id}`, native: null },
    format: "TV",
    status: "RELEASING",
    description: null,
    season: "SPRING",
    seasonYear: 2026,
    startDate: { year: 2026, month: 4, day: 1 },
    episodes: 12,
    averageScore: 80,
    meanScore: 81,
    popularity: 1000,
    isAdult: false,
    genres: ["Action"],
    coverImage: { extraLarge: "xl", large: "l", medium: "m", color: null },
    bannerImage: null,
    siteUrl: `https://anilist.co/anime/${id}`,
    ...overrides,
  };
}

function pageResponse(
  media: Anime[],
  hasNextPage: boolean,
  currentPage = 1,
): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: new Headers(),
    json: async () => ({
      data: { Page: { pageInfo: { currentPage, hasNextPage }, media } },
    }),
  } as unknown as Response;
}

/** A client wired with an injected fetch and an isolated zero-gap pacer. */
function testClient(fetchImpl: typeof fetch): AniListClient {
  return new AniListClient({ fetchImpl, pacer: new Pacer(0) });
}

describe("fetchSeasonPoolRows", () => {
  it("maps AniList media onto anime-table insert rows", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(pageResponse([anime(1)], false));

    const pool = await fetchSeasonPoolRows({
      season: "SPRING",
      year: 2026,
      client: testClient(fetchImpl),
    });

    expect(pool).toHaveLength(1);
    const row: SeasonPoolAnime = pool[0]!;
    expect(row).toMatchObject({
      id: 1,
      title: "Show 1",
      romajiTitle: "Show 1",
      englishTitle: "English 1",
      format: "TV",
      season: "SPRING",
      seasonYear: 2026,
      episodesPlanned: 12,
      coverImageUrl: "xl",
      isAdult: false,
    });
    // startDate becomes a UTC timestamp the timestamp_ms column can store.
    expect(row.startDate).toEqual(new Date(Date.UTC(2026, 3, 1)));
    // The full upstream payload is retained verbatim.
    expect(row.rawMetadata).toMatchObject({ id: 1, popularity: 1000 });
  });

  it("prefers the largest available cover image, falling back in order", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      pageResponse(
        [
          anime(1, {
            coverImage: { extraLarge: null, large: "l", medium: "m", color: null },
          }),
          anime(2, {
            coverImage: { extraLarge: null, large: null, medium: "m", color: null },
          }),
          anime(3, {
            coverImage: { extraLarge: null, large: null, medium: null, color: null },
          }),
        ],
        false,
      ),
    );

    const pool = await fetchSeasonPoolRows({
      season: "SPRING",
      year: 2026,
      client: testClient(fetchImpl),
    });

    expect(pool.map((r) => r.coverImageUrl)).toEqual(["l", "m", null]);
  });

  it("keeps a null startDate when AniList has no year", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      pageResponse(
        [anime(1, { startDate: { year: null, month: null, day: null } })],
        false,
      ),
    );

    const pool = await fetchSeasonPoolRows({
      season: "SPRING",
      year: 2026,
      client: testClient(fetchImpl),
    });

    expect(pool[0]!.startDate).toBeNull();
  });

  it("defaults a partial startDate's missing month/day to January 1st", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      pageResponse(
        [anime(1, { startDate: { year: 2026, month: null, day: null } })],
        false,
      ),
    );

    const pool = await fetchSeasonPoolRows({
      season: "SPRING",
      year: 2026,
      client: testClient(fetchImpl),
    });

    expect(pool[0]!.startDate).toEqual(new Date(Date.UTC(2026, 0, 1)));
  });

  it("excludes adult and non-TV titles even if the API returns them", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      pageResponse(
        [
          anime(1), // eligible
          anime(2, { isAdult: true }), // adult -> excluded
          anime(3, { format: "MOVIE" }), // non-TV -> excluded
          anime(4, { format: null }), // unknown format -> excluded
          anime(5), // eligible
        ],
        false,
      ),
    );

    const pool = await fetchSeasonPoolRows({
      season: "SPRING",
      year: 2026,
      client: testClient(fetchImpl),
    });

    expect(pool.map((r) => r.id)).toEqual([1, 5]);
  });

  it("walks every page of the season pool", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(pageResponse([anime(1), anime(2)], true, 1))
      .mockResolvedValueOnce(pageResponse([anime(3)], false, 2));

    const pool = await fetchSeasonPoolRows({
      season: "FALL",
      year: 2025,
      client: testClient(fetchImpl),
    });

    expect(pool.map((r) => r.id)).toEqual([1, 2, 3]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(
      (fetchImpl.mock.calls[0]![1] as RequestInit).body as string,
    );
    expect(firstBody.variables).toMatchObject({
      season: "FALL",
      seasonYear: 2025,
      page: 1,
      perPage: 50,
    });
  });

  it("de-duplicates by id so the rows are safe to insert (PK is the id)", async () => {
    // POPULARITY_DESC pages can repeat a show when ranks shift mid-walk; the
    // first (most popular) occurrence must win and the order is preserved.
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(pageResponse([anime(1), anime(2)], true, 1))
      .mockResolvedValueOnce(pageResponse([anime(2), anime(3)], false, 2));

    const pool = await fetchSeasonPoolRows({
      season: "SPRING",
      year: 2026,
      client: testClient(fetchImpl),
    });

    expect(pool.map((r) => r.id)).toEqual([1, 2, 3]);
  });

  it("returns an empty array when the season has no eligible anime", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(pageResponse([], false));

    const pool = await fetchSeasonPoolRows({
      season: "WINTER",
      year: 2030,
      client: testClient(fetchImpl),
    });

    expect(pool).toEqual([]);
  });
});
