import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { createDb, type Db } from "../index";
import { anime, episodes } from "./anime";
import { users } from "./auth";

/**
 * Round-trip test for the anime / episodes schema and the app-specific user
 * columns (issue #39).
 *
 * Like the other schema tests, this applies the committed drizzle-kit
 * migrations to a fresh in-memory libsql database — which doubles as the
 * "migration 0003 applies cleanly on top of 0000–0002" check (including the
 * `ALTER TABLE user ADD …` statements) — then exercises the new tables and
 * columns with insert/select round-trips, the composite primary key, and the
 * FK cascade from anime to its episodes.
 */

const MIGRATIONS = [
  "0000_true_nighthawk.sql",
  "0001_tough_talkback.sql",
  "0002_flashy_inhumans.sql",
  "0003_tense_masque.sql",
];

function firstRow<T>(rows: T[]): T {
  const row = rows[0];
  if (row === undefined) throw new Error("expected at least one row");
  return row;
}

async function applyMigrations(db: Db): Promise<void> {
  await db.run("PRAGMA foreign_keys = ON");
  for (const file of MIGRATIONS) {
    const path = fileURLToPath(
      new URL(`../../drizzle/${file}`, import.meta.url),
    );
    const sql = readFileSync(path, "utf8");
    for (const statement of sql.split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (trimmed) await db.run(trimmed);
    }
  }
}

describe("anime + episodes schema round-trips", () => {
  let db: Db;

  beforeAll(async () => {
    db = createDb(":memory:");
    await applyMigrations(db);
  });

  it("round-trips an anime row, preserving enums, the JSON blob, and dates", async () => {
    const startDate = new Date("2026-04-05T00:00:00.000Z");
    const created = firstRow(
      await db
        .insert(anime)
        .values({
          // The AniList media id is the primary key — supplied, not generated.
          id: 176496,
          title: "Sample Show",
          romajiTitle: "Sample Show",
          englishTitle: null,
          format: "TV",
          season: "SPRING",
          seasonYear: 2026,
          startDate,
          episodesPlanned: 12,
          coverImageUrl: "https://s4.anilist.co/cover.jpg",
          isAdult: false,
          rawMetadata: { id: 176496, popularity: 42, genres: ["Action"] },
        })
        .returning(),
    );

    expect(created.id).toBe(176496);
    expect(created.format).toBe("TV");
    expect(created.isAdult).toBe(false);
    // JSON mode hands back the parsed object, not a string.
    expect(created.rawMetadata).toEqual({
      id: 176496,
      popularity: 42,
      genres: ["Action"],
    });

    const fetched = firstRow(
      await db.select().from(anime).where(eq(anime.id, 176496)),
    );
    expect(fetched.romajiTitle).toBe("Sample Show");
    expect(fetched.englishTitle).toBeNull();
    expect(fetched.season).toBe("SPRING");
    expect(fetched.seasonYear).toBe(2026);
    expect(fetched.episodesPlanned).toBe(12);
    // timestamp_ms columns deserialize back into Date instances.
    expect(fetched.startDate).toBeInstanceOf(Date);
    expect(fetched.startDate?.getTime()).toBe(startDate.getTime());
  });

  it("defaults is_adult to false and allows null optional columns", async () => {
    const created = firstRow(
      await db
        .insert(anime)
        .values({
          id: 1,
          title: "Minimal",
          romajiTitle: "Minimal",
          rawMetadata: {},
        })
        .returning(),
    );

    expect(created.isAdult).toBe(false);
    expect(created.format).toBeNull();
    expect(created.season).toBeNull();
    expect(created.startDate).toBeNull();
    expect(created.episodesPlanned).toBeNull();
    expect(created.coverImageUrl).toBeNull();
  });

  it("round-trips episodes and auto-stamps fetched_at", async () => {
    const airDate = new Date("2026-04-12T14:30:00.000Z");
    const created = firstRow(
      await db
        .insert(episodes)
        .values({
          animeId: 176496,
          episodeNumber: 1,
          airDate,
          scoreWhenLastFetched: 78,
        })
        .returning(),
    );

    expect(created.animeId).toBe(176496);
    expect(created.episodeNumber).toBe(1);
    expect(created.scoreWhenLastFetched).toBe(78);
    // fetched_at is populated by the $defaultFn without the caller passing it.
    expect(created.fetchedAt).toBeInstanceOf(Date);

    const fetched = firstRow(
      await db
        .select()
        .from(episodes)
        .where(
          and(eq(episodes.animeId, 176496), eq(episodes.episodeNumber, 1)),
        ),
    );
    expect(fetched.airDate?.getTime()).toBe(airDate.getTime());
  });

  it("rejects a duplicate (anime, episode) via the composite primary key", async () => {
    await expect(
      db.insert(episodes).values({
        animeId: 176496,
        episodeNumber: 1,
        scoreWhenLastFetched: 80,
      }),
    ).rejects.toThrow();
  });

  it("cascades episode deletes when the anime is removed", async () => {
    await db.insert(anime).values({
      id: 999,
      title: "Doomed",
      romajiTitle: "Doomed",
      rawMetadata: {},
    });
    await db.insert(episodes).values([
      { animeId: 999, episodeNumber: 1 },
      { animeId: 999, episodeNumber: 2 },
    ]);

    await db.delete(anime).where(eq(anime.id, 999));

    const remaining = await db
      .select()
      .from(episodes)
      .where(eq(episodes.animeId, 999));
    expect(remaining).toHaveLength(0);
  });
});

describe("app-specific user columns", () => {
  let db: Db;

  beforeAll(async () => {
    db = createDb(":memory:");
    await applyMigrations(db);
  });

  it("stores display_name / avatar_url and auto-stamps created_at", async () => {
    const created = firstRow(
      await db
        .insert(users)
        .values({
          id: crypto.randomUUID(),
          email: "profile@anidraft.test",
          displayName: "Captain",
          avatarUrl: "https://anidraft.test/me.png",
        })
        .returning(),
    );

    expect(created.displayName).toBe("Captain");
    expect(created.avatarUrl).toBe("https://anidraft.test/me.png");
    // created_at is NOT NULL with a $defaultFn — filled even when omitted.
    expect(created.createdAt).toBeInstanceOf(Date);
  });

  it("leaves display_name / avatar_url null when only adapter columns are set", async () => {
    const created = firstRow(
      await db
        .insert(users)
        .values({ id: crypto.randomUUID(), email: "bare@anidraft.test" })
        .returning(),
    );

    expect(created.displayName).toBeNull();
    expect(created.avatarUrl).toBeNull();
    expect(created.createdAt).toBeInstanceOf(Date);
  });
});
