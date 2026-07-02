import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchSeasonPoolRows, type SeasonPoolAnime } from "@anidraft/anilist";
import { anime, type Db } from "@anidraft/db";
import { createMigratedDb } from "@anidraft/db/testing";

/**
 * Integration test: the season pool fetcher (`@anidraft/anilist`) ↔ the `anime`
 * table (`@anidraft/db`) (issue #43).
 *
 * `fetchSeasonPoolRows` exists to feed the league-creation / pool-override flow, and
 * its contract is that what it returns is directly persistable as `anime` rows.
 * This test pins that seam end to end: stub the AniList HTTP response, run
 * `fetchSeasonPoolRows`, then insert the result straight into a real `anime` table
 * built from the committed migration chain and read it back. If the mapper ever
 * drifts from the schema (a missing not-null column, a wrong type), the insert
 * fails here — not in production.
 *
 * The network is stubbed (per the integration-test rules); the *real* SPRING
 * 2026 fetch is captured as a one-off verification artifact in the PR, not run
 * in CI.
 */

/** Build one AniList `Media` JSON node, the shape the client parses. */
function mediaNode(id: number, overrides: Record<string, unknown> = {}) {
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
    popularity: 1000 + id,
    isAdult: false,
    genres: ["Action"],
    coverImage: { extraLarge: "xl", large: "l", medium: "m", color: null },
    bannerImage: null,
    siteUrl: `https://anilist.co/anime/${id}`,
    ...overrides,
  };
}

function stubAniListPages(...pages: Array<ReturnType<typeof mediaNode>[]>) {
  const fetchMock = vi.fn();
  pages.forEach((media, i) => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers(),
      json: async () => ({
        data: {
          Page: {
            pageInfo: { currentPage: i + 1, hasNextPage: i < pages.length - 1 },
            media,
          },
        },
      }),
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("season pool fetcher ↔ anime table boundary", () => {
  let db: Db;

  beforeEach(async () => {
    db = await createMigratedDb();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns rows that insert cleanly into the anime table", async () => {
    stubAniListPages([mediaNode(1), mediaNode(2)], [mediaNode(3)]);

    const pool: SeasonPoolAnime[] = await fetchSeasonPoolRows({
      season: "SPRING",
      year: 2026,
    });

    expect(pool.map((r) => r.id)).toEqual([1, 2, 3]);

    // The contract under test: the mapper's output is a valid `anime` insert.
    await db.insert(anime).values(pool);

    const stored = await db.select().from(anime).where(eq(anime.id, 1));
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
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
    expect(stored[0]!.startDate).toEqual(new Date(Date.UTC(2026, 3, 1)));
    // The verbatim upstream payload survives the round-trip through the JSON column.
    expect(stored[0]!.rawMetadata).toMatchObject({ id: 1, popularity: 1001 });
  });

  it("inserts cleanly even when AniList repeats a show across pages", async () => {
    // POPULARITY_DESC pagination can return the same id on two pages. Without
    // dedupe this insert would throw a PK violation on `anime.id`.
    stubAniListPages(
      [mediaNode(1), mediaNode(2)],
      [mediaNode(2), mediaNode(3)],
    );

    const pool = await fetchSeasonPoolRows({ season: "SPRING", year: 2026 });
    expect(pool.map((r) => r.id)).toEqual([1, 2, 3]);

    await db.insert(anime).values(pool);
    const stored = await db.select().from(anime);
    expect(stored.map((r) => r.id).sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });

  it("persists only the eligible (TV, non-adult) pool", async () => {
    stubAniListPages([
      mediaNode(1),
      mediaNode(2, { isAdult: true }),
      mediaNode(3, { format: "MOVIE" }),
      mediaNode(4),
    ]);

    const pool = await fetchSeasonPoolRows({ season: "SPRING", year: 2026 });
    await db.insert(anime).values(pool);

    const stored = await db.select().from(anime);
    expect(stored.map((r) => r.id).sort((a, b) => a - b)).toEqual([1, 4]);
  });
});
