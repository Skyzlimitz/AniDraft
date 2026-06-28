import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchSeasonPool, type SeasonPoolAnime } from "@anidraft/anilist";
import { anime, createDb, type Db } from "@anidraft/db";

/**
 * Integration test: the season pool fetcher (`@anidraft/anilist`) ↔ the `anime`
 * table (`@anidraft/db`) (issue #43).
 *
 * `fetchSeasonPool` exists to feed the league-creation / pool-override flow, and
 * its contract is that what it returns is directly persistable as `anime` rows.
 * This test pins that seam end to end: stub the AniList HTTP response, run
 * `fetchSeasonPool`, then insert the result straight into a real `anime` table
 * built from the committed migration chain and read it back. If the mapper ever
 * drifts from the schema (a missing not-null column, a wrong type), the insert
 * fails here — not in production.
 *
 * The network is stubbed (per the integration-test rules); the *real* SPRING
 * 2026 fetch is captured as a one-off verification artifact in the PR, not run
 * in CI.
 */

const DB_MIGRATIONS = [
  "0000_true_nighthawk.sql",
  "0001_tough_talkback.sql",
  "0002_flashy_inhumans.sql",
  "0003_tense_masque.sql",
  "0004_unusual_vampiro.sql",
  "0005_supreme_kate_bishop.sql",
  "0006_first_nemesis.sql",
];

async function applyMigrations(db: Db): Promise<void> {
  await db.run("PRAGMA foreign_keys = ON");
  for (const file of DB_MIGRATIONS) {
    const path = fileURLToPath(
      new URL(`../../../packages/db/drizzle/${file}`, import.meta.url),
    );
    const sql = readFileSync(path, "utf8");
    for (const statement of sql.split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (trimmed) await db.run(trimmed);
    }
  }
}

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
    db = createDb(":memory:");
    await applyMigrations(db);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns rows that insert cleanly into the anime table", async () => {
    stubAniListPages([mediaNode(1), mediaNode(2)], [mediaNode(3)]);

    const pool: SeasonPoolAnime[] = await fetchSeasonPool({
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

  it("persists only the eligible (TV, non-adult) pool", async () => {
    stubAniListPages([
      mediaNode(1),
      mediaNode(2, { isAdult: true }),
      mediaNode(3, { format: "MOVIE" }),
      mediaNode(4),
    ]);

    const pool = await fetchSeasonPool({ season: "SPRING", year: 2026 });
    await db.insert(anime).values(pool);

    const stored = await db.select().from(anime);
    expect(stored.map((r) => r.id).sort((a, b) => a - b)).toEqual([1, 4]);
  });
});
