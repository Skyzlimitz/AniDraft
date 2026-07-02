import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { anime, episodes, type Db } from "@anidraft/db";
import { createMigratedDb } from "@anidraft/db/testing";

/**
 * Integration test: the cache-backed `/api/anime/[id]` reader ↔ the `anime` /
 * `episodes` tables (`@anidraft/db`) (issue #45).
 *
 * The web endpoint's contract is that it serves anime metadata + per-episode
 * scores out of the local mirror **without ever calling AniList**. This test
 * pins that seam against a real database built from the committed migration
 * chain: seed `anime` + `episodes` through `@anidraft/db`, then run the same
 * join + staleness derivation `apps/web/lib/anime/getCachedAnime.ts` performs
 * and assert the data reads back intact.
 *
 * `apps/web` is not a workspace dependency here, so `readCachedAnime` mirrors
 * the web reader (the convention the other `*-flow` integration tests follow).
 * `fetch` is stubbed to throw for the whole suite, so any accidental AniList
 * call from this read path fails the test — that is the issue's verification
 * artifact ("with the AniList client erroring, the endpoint still serves
 * cached data").
 */

// 0000–0003 is the set that lands `anime` + `episodes` (0003 also ALTERs
// `user`, which 0000 creates). Kept identical to the reader's unit-test list.
const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

/** Mirrors `apps/web/lib/anime/getCachedAnime.ts` against the real db. */
async function readCachedAnime(db: Db, animeId: number, now: Date) {
  // Same shape as the reader: concurrent metadata (projected, no `raw_metadata`)
  // + episodes reads keyed off `animeId`.
  const [[row], episodeRows] = await Promise.all([
    db
      .select({
        id: anime.id,
        title: anime.title,
        romajiTitle: anime.romajiTitle,
        englishTitle: anime.englishTitle,
        format: anime.format,
        season: anime.season,
        seasonYear: anime.seasonYear,
        startDate: anime.startDate,
        episodesPlanned: anime.episodesPlanned,
        coverImageUrl: anime.coverImageUrl,
        isAdult: anime.isAdult,
      })
      .from(anime)
      .where(eq(anime.id, animeId))
      .limit(1),
    db
      .select({
        episodeNumber: episodes.episodeNumber,
        airDate: episodes.airDate,
        score: episodes.scoreWhenLastFetched,
        fetchedAt: episodes.fetchedAt,
      })
      .from(episodes)
      .where(eq(episodes.animeId, animeId))
      .orderBy(episodes.episodeNumber),
  ]);
  if (!row) return null;

  const fetchedAt = episodeRows.reduce<Date | null>(
    (latest, episode) =>
      latest === null || episode.fetchedAt > latest
        ? episode.fetchedAt
        : latest,
    null,
  );
  const stale =
    fetchedAt === null || now.getTime() - fetchedAt.getTime() > STALE_AFTER_MS;

  // The projection is exactly the response's `anime` shape — return it directly.
  return {
    anime: row,
    episodes: episodeRows,
    fetchedAt,
    stale,
  };
}

const ANIME_ID = 12345;
const NOW = new Date("2026-05-01T00:00:00.000Z");

describe("cached anime reader ↔ anime/episodes tables boundary", () => {
  let db: Db;

  beforeEach(async () => {
    db = await createMigratedDb();
    // The read path must never reach the network; make any fetch a hard failure.
    vi.stubGlobal("fetch", () => {
      throw new Error("AniList must not be called by the cache reader");
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns null for an anime that was never cached", async () => {
    expect(await readCachedAnime(db, ANIME_ID, NOW)).toBeNull();
  });

  it("reads metadata + per-episode scores back intact from the cache", async () => {
    await db.insert(anime).values({
      id: ANIME_ID,
      title: "Cached Show",
      romajiTitle: "Cached Show",
      englishTitle: "Cached Show (EN)",
      format: "TV",
      season: "SPRING",
      seasonYear: 2026,
      startDate: new Date("2026-04-05T00:00:00.000Z"),
      episodesPlanned: 12,
      coverImageUrl: "https://s4.anilist.co/cover.jpg",
      isAdult: false,
      rawMetadata: { id: ANIME_ID, popularity: 99 },
    });
    const fetchedAt = new Date(NOW.getTime() - 60 * 60 * 1000); // 1h ago
    await db.insert(episodes).values([
      {
        animeId: ANIME_ID,
        episodeNumber: 1,
        airDate: new Date("2026-04-12T00:00:00.000Z"),
        scoreWhenLastFetched: 78,
        fetchedAt,
      },
      {
        animeId: ANIME_ID,
        episodeNumber: 2,
        airDate: new Date("2026-04-19T00:00:00.000Z"),
        scoreWhenLastFetched: 81,
        fetchedAt,
      },
    ]);

    const result = await readCachedAnime(db, ANIME_ID, NOW);

    expect(result!.anime).toMatchObject({
      id: ANIME_ID,
      title: "Cached Show",
      englishTitle: "Cached Show (EN)",
      format: "TV",
      season: "SPRING",
      seasonYear: 2026,
      episodesPlanned: 12,
    });
    expect(result!.episodes).toEqual([
      {
        episodeNumber: 1,
        airDate: new Date("2026-04-12T00:00:00.000Z"),
        score: 78,
        fetchedAt,
      },
      {
        episodeNumber: 2,
        airDate: new Date("2026-04-19T00:00:00.000Z"),
        score: 81,
        fetchedAt,
      },
    ]);
    expect(result!.stale).toBe(false);
  });

  it("flags data older than 7 days as stale", async () => {
    await db.insert(anime).values({
      id: ANIME_ID,
      title: "Stale Show",
      romajiTitle: "Stale Show",
      rawMetadata: {},
    });
    await db.insert(episodes).values({
      animeId: ANIME_ID,
      episodeNumber: 1,
      scoreWhenLastFetched: 70,
      fetchedAt: new Date(NOW.getTime() - (STALE_AFTER_MS + 1)),
    });

    const result = await readCachedAnime(db, ANIME_ID, NOW);

    expect(result!.stale).toBe(true);
    // Stale or not, the cached data is still served.
    expect(result!.episodes[0]?.score).toBe(70);
  });
});
