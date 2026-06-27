import { afterEach, describe, expect, it, vi } from "vitest";
import { calculateWeeklyScore, type ScoringResult } from "@anidraft/scoring";
import { fetchSeasonAnime, type AniListMedia } from "@anidraft/anilist";

/**
 * Integration test: the scoring pipeline.
 *
 * Anime metrics flow `@anidraft/anilist` -> `@anidraft/scoring`. This test
 * pins the contract between the two packages (the shape AniList produces is
 * the shape scoring consumes) so that as either side is implemented the
 * boundary stays stable.
 *
 * NOTE: `calculateWeeklyScore` is currently a stub that returns 0. These
 * assertions check the *contract* (types/shape), not a specific formula, so
 * they keep passing once Issue #59 lands the real implementation.
 *
 * `fetchSeasonAnime` now makes a real GraphQL request (issue #36), so the
 * season-fetch test stubs `fetch` rather than hitting the network — keeping the
 * boundary it exercises (AniList parsing -> scoring) hermetic.
 */

function mediaToScoringInput(media: AniListMedia) {
  return {
    averageScore: media.averageScore ?? 0,
    popularity: media.popularity,
    trending: media.trending,
    favourites: media.favourites,
    episodesAired: media.episodes ?? 0,
  };
}

const sampleMedia: AniListMedia = {
  id: 1,
  title: { romaji: "Sample Anime", english: "Sample Anime", native: null },
  coverImage: { large: "large.jpg", medium: "medium.jpg" },
  bannerImage: null,
  averageScore: 85,
  popularity: 120000,
  trending: 340,
  favourites: 9000,
  episodes: 12,
  status: "RELEASING",
  season: "SPRING",
  seasonYear: 2026,
  genres: ["Action", "Adventure"],
  studios: { nodes: [{ id: 1, name: "Studio Example" }] },
};

describe("scoring pipeline (anilist media -> scoring)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps AniList media into a scorable input and returns a valid result", () => {
    const input = mediaToScoringInput(sampleMedia);
    const result: ScoringResult = calculateWeeklyScore(input);

    expect(typeof result.weeklyScore).toBe("number");
    expect(Number.isFinite(result.weeklyScore)).toBe(true);
    expect(result.weeklyScore).toBeGreaterThanOrEqual(0);
    expect(result.breakdown).toBeTypeOf("object");
    expect(result.breakdown).not.toBeNull();
  });

  it("handles media with null/missing optional metrics", () => {
    const sparse: AniListMedia = {
      ...sampleMedia,
      averageScore: null,
      episodes: null,
    };

    const result = calculateWeeklyScore(mediaToScoringInput(sparse));
    expect(Number.isFinite(result.weeklyScore)).toBe(true);
    expect(result.weeklyScore).toBeGreaterThanOrEqual(0);
  });

  it("scores every anime returned by a season fetch", async () => {
    // Stub the network: `fetchSeasonAnime` parses this AniList `Page` shape, and
    // the pipeline must score every media it yields. One page (hasNextPage:
    // false) keeps the fetch to a single request.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({
          data: {
            Page: {
              pageInfo: { currentPage: 1, hasNextPage: false },
              media: [sampleMedia, { ...sampleMedia, id: 2 }],
            },
          },
        }),
      })),
    );

    const season = await fetchSeasonAnime("SPRING", 2026);
    expect(Array.isArray(season)).toBe(true);
    expect(season).toHaveLength(2);

    const scores = season.map((media) =>
      calculateWeeklyScore(mediaToScoringInput(media)),
    );
    expect(scores).toHaveLength(season.length);
    for (const score of scores) {
      expect(Number.isFinite(score.weeklyScore)).toBe(true);
    }
  });
});
