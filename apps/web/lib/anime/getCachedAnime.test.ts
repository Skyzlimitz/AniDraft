import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { anime, episodes, type Db } from "@anidraft/db";
import { createMigratedDb } from "@anidraft/db/testing";

import { getCachedAnime, STALE_AFTER_MS } from "./getCachedAnime";

/**
 * Unit tests for the `/api/anime/[id]` cache reader. Runs against a fresh
 * in-memory libSQL database migrated from the committed drizzle-kit SQL, so the
 * read exercises the real `anime` / `episodes` schema (issue #45).
 *
 * Migrations 0000–0003 are the set that lands `anime` + `episodes`; 0003 also
 * ALTERs `user`, which 0000 creates, so the chain must start at 0000.
 */

const ANIME_ID = 12345;
const NOW = new Date("2026-05-01T00:00:00.000Z");

async function seedAnime(
  db: Db,
  overrides: Partial<typeof anime.$inferInsert> = {},
): Promise<void> {
  await db.insert(anime).values({
    id: ANIME_ID,
    title: "Sample Show",
    romajiTitle: "Sample Show",
    englishTitle: "Sample Show (EN)",
    format: "TV",
    season: "SPRING",
    seasonYear: 2026,
    startDate: new Date("2026-04-05T00:00:00.000Z"),
    episodesPlanned: 12,
    coverImageUrl: "https://s4.anilist.co/cover.jpg",
    isAdult: false,
    rawMetadata: { id: ANIME_ID, popularity: 42 },
    ...overrides,
  });
}

describe("getCachedAnime", () => {
  let db: Db;

  beforeEach(async () => {
    db = await createMigratedDb();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns null when the anime is not in the cache", async () => {
    expect(await getCachedAnime(db, ANIME_ID, NOW)).toBeNull();
  });

  it("returns the modeled metadata (not the raw blob) for a cached anime", async () => {
    await seedAnime(db);

    const result = await getCachedAnime(db, ANIME_ID, NOW);

    expect(result).not.toBeNull();
    expect(result!.anime).toEqual({
      id: ANIME_ID,
      title: "Sample Show",
      romajiTitle: "Sample Show",
      englishTitle: "Sample Show (EN)",
      format: "TV",
      season: "SPRING",
      seasonYear: 2026,
      startDate: new Date("2026-04-05T00:00:00.000Z"),
      episodesPlanned: 12,
      coverImageUrl: "https://s4.anilist.co/cover.jpg",
      isAdult: false,
    });
    // The internal raw payload is never surfaced.
    expect(result).not.toHaveProperty("anime.rawMetadata");
  });

  it("returns per-episode scores ordered by episode number", async () => {
    await seedAnime(db);
    const fetchedAt = new Date(NOW.getTime() - 60 * 60 * 1000); // 1h ago — fresh
    // Insert out of order to prove the reader sorts.
    await db.insert(episodes).values([
      {
        animeId: ANIME_ID,
        episodeNumber: 2,
        airDate: new Date("2026-04-19T00:00:00.000Z"),
        scoreWhenLastFetched: 81,
        fetchedAt,
      },
      {
        animeId: ANIME_ID,
        episodeNumber: 1,
        airDate: new Date("2026-04-12T00:00:00.000Z"),
        scoreWhenLastFetched: 78,
        fetchedAt,
      },
    ]);

    const result = await getCachedAnime(db, ANIME_ID, NOW);

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
  });

  it("reports the most recent episode fetch as the representative fetchedAt", async () => {
    await seedAnime(db);
    const older = new Date(NOW.getTime() - 3 * 24 * 60 * 60 * 1000);
    const newer = new Date(NOW.getTime() - 1 * 24 * 60 * 60 * 1000);
    await db.insert(episodes).values([
      { animeId: ANIME_ID, episodeNumber: 1, fetchedAt: older },
      { animeId: ANIME_ID, episodeNumber: 2, fetchedAt: newer },
    ]);

    const result = await getCachedAnime(db, ANIME_ID, NOW);

    expect(result!.fetchedAt).toEqual(newer);
    expect(result!.stale).toBe(false);
  });

  it("flags fresh data (within 7 days) as not stale", async () => {
    await seedAnime(db);
    // Exactly one millisecond inside the window.
    const fetchedAt = new Date(NOW.getTime() - (STALE_AFTER_MS - 1));
    await db
      .insert(episodes)
      .values({ animeId: ANIME_ID, episodeNumber: 1, fetchedAt });

    const result = await getCachedAnime(db, ANIME_ID, NOW);
    expect(result!.stale).toBe(false);
  });

  it("flags data older than 7 days as stale", async () => {
    await seedAnime(db);
    // One millisecond past the window.
    const fetchedAt = new Date(NOW.getTime() - (STALE_AFTER_MS + 1));
    await db
      .insert(episodes)
      .values({ animeId: ANIME_ID, episodeNumber: 1, fetchedAt });

    const result = await getCachedAnime(db, ANIME_ID, NOW);
    expect(result!.stale).toBe(true);
  });

  it("treats an anime with no episode data as stale with a null fetchedAt", async () => {
    await seedAnime(db);

    const result = await getCachedAnime(db, ANIME_ID, NOW);

    expect(result!.episodes).toEqual([]);
    expect(result!.fetchedAt).toBeNull();
    expect(result!.stale).toBe(true);
  });

  it("serves cached data without touching the network (no live AniList call)", async () => {
    await seedAnime(db);
    await db.insert(episodes).values({
      animeId: ANIME_ID,
      episodeNumber: 1,
      scoreWhenLastFetched: 90,
    });

    // Any accidental outbound fetch (i.e. an AniList call) would throw here.
    const fetchSpy = vi.fn(() => {
      throw new Error("network is unavailable");
    });
    vi.stubGlobal("fetch", fetchSpy);

    const result = await getCachedAnime(db, ANIME_ID, NOW);

    expect(result!.anime.id).toBe(ANIME_ID);
    expect(result!.episodes[0]?.score).toBe(90);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
