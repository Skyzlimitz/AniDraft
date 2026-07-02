import { and, eq, isNull } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { type Db } from "../index";
import { createMigratedDb } from "../testing";
import { anime } from "./anime";
import { users } from "./auth";
import { leagues } from "./leagues";
import { rosterSwaps, rosters } from "./roster";

/**
 * Round-trip test for the roster schema (issue #40).
 *
 * Each test runs against its own fresh in-memory libsql database, migrated from
 * the committed drizzle-kit SQL, so applying the chain doubles as the
 * "migration 0004 applies cleanly" check. Beyond the insert/select round-trips,
 * this covers the history shape (a dropped row keeps its `released_at`, and the
 * same show can be re-acquired) and confirms the hot per-(league, user) reads
 * hit their composite index via `EXPLAIN QUERY PLAN`.
 */

function firstRow<T>(rows: T[]): T {
  const row = rows[0];
  if (row === undefined) throw new Error("expected at least one row");
  return row;
}

/** Seed the league + user + anime rows a roster/swap depends on. */
async function seedFixtures(db: Db): Promise<{
  leagueId: string;
  userId: string;
  animeIds: number[];
}> {
  const userId = crypto.randomUUID();
  await db.insert(users).values({ id: userId, email: "owner@anidraft.test" });

  const league = firstRow(
    await db
      .insert(leagues)
      .values({
        name: "Roster League",
        commissionerId: userId,
        season: "FALL",
        seasonYear: 2026,
        maxPlayers: 4,
      })
      .returning(),
  );

  const animeIds = [201, 202, 203];
  for (const id of animeIds) {
    await db.insert(anime).values({
      id,
      title: `Show ${id}`,
      romajiTitle: `Show ${id}`,
      rawMetadata: {},
    });
  }

  return { leagueId: league.id, userId, animeIds };
}

describe("roster schema round-trips", () => {
  let db: Db;

  beforeEach(async () => {
    db = await createMigratedDb();
  });

  it("round-trips a roster row and auto-stamps acquired_at", async () => {
    const { leagueId, userId, animeIds } = await seedFixtures(db);

    const created = firstRow(
      await db
        .insert(rosters)
        .values({ leagueId, userId, animeId: animeIds[0]! })
        .returning(),
    );

    expect(created.id).toBeTruthy();
    // acquired_at comes from the schema default; a live holding has no release.
    expect(created.acquiredAt).toBeInstanceOf(Date);
    expect(created.releasedAt).toBeNull();

    const fetched = firstRow(
      await db.select().from(rosters).where(eq(rosters.id, created.id)),
    );
    expect(fetched.leagueId).toBe(leagueId);
    expect(fetched.userId).toBe(userId);
    expect(fetched.animeId).toBe(animeIds[0]);
  });

  it("keeps history: a show can be released and re-acquired", async () => {
    const { leagueId, userId, animeIds } = await seedFixtures(db);
    const animeId = animeIds[0]!;

    // Acquire, then drop (stamp released_at), then re-acquire — three rows for
    // the same (league, user, anime), which the absence of a unique key allows.
    const first = firstRow(
      await db
        .insert(rosters)
        .values({ leagueId, userId, animeId })
        .returning(),
    );
    await db
      .update(rosters)
      .set({ releasedAt: new Date() })
      .where(eq(rosters.id, first.id));
    await db.insert(rosters).values({ leagueId, userId, animeId });

    const allRows = await db
      .select()
      .from(rosters)
      .where(and(eq(rosters.leagueId, leagueId), eq(rosters.animeId, animeId)));
    expect(allRows).toHaveLength(2);

    // The "current roster" query filters to the still-held row.
    const live = await db
      .select()
      .from(rosters)
      .where(and(eq(rosters.userId, userId), isNull(rosters.releasedAt)));
    expect(live).toHaveLength(1);
  });

  it("rejects a second live holding of the same show (partial unique index)", async () => {
    const { leagueId, userId, animeIds } = await seedFixtures(db);
    const animeId = animeIds[0]!;
    await db.insert(rosters).values({ leagueId, userId, animeId });

    // A second un-released row for the same (league, user, anime) would let the
    // current-roster read double-count the show; the partial unique index on
    // `WHERE released_at IS NULL` rejects it.
    await expect(
      db.insert(rosters).values({ leagueId, userId, animeId }),
    ).rejects.toThrow();
  });

  it("allows re-acquiring a show once the prior holding is released", async () => {
    const { leagueId, userId, animeIds } = await seedFixtures(db);
    const animeId = animeIds[0]!;
    const first = firstRow(
      await db
        .insert(rosters)
        .values({ leagueId, userId, animeId })
        .returning(),
    );

    // Dropping the first holding moves it out of the partial index's scope, so
    // the re-acquire is accepted — history accumulates without tripping the
    // live-holding invariant.
    await db
      .update(rosters)
      .set({ releasedAt: new Date() })
      .where(eq(rosters.id, first.id));

    await expect(
      db.insert(rosters).values({ leagueId, userId, animeId }),
    ).resolves.toBeDefined();
  });

  it("round-trips a roster swap with both anime references", async () => {
    const { leagueId, userId, animeIds } = await seedFixtures(db);

    const created = firstRow(
      await db
        .insert(rosterSwaps)
        .values({
          leagueId,
          userId,
          droppedAnimeId: animeIds[0]!,
          pickedUpAnimeId: animeIds[1]!,
          weekNumber: 3,
        })
        .returning(),
    );

    expect(created.droppedAnimeId).toBe(animeIds[0]);
    expect(created.pickedUpAnimeId).toBe(animeIds[1]);
    expect(created.weekNumber).toBe(3);
    expect(created.swappedAt).toBeInstanceOf(Date);

    const fetched = firstRow(
      await db.select().from(rosterSwaps).where(eq(rosterSwaps.id, created.id)),
    );
    expect(fetched.userId).toBe(userId);
  });

  it("cascades roster + swap deletes when the league is removed", async () => {
    const { leagueId, userId, animeIds } = await seedFixtures(db);
    await db
      .insert(rosters)
      .values({ leagueId, userId, animeId: animeIds[0]! });
    await db.insert(rosterSwaps).values({
      leagueId,
      userId,
      droppedAnimeId: animeIds[0]!,
      pickedUpAnimeId: animeIds[1]!,
      weekNumber: 1,
    });

    await db.delete(leagues).where(eq(leagues.id, leagueId));

    expect(
      await db.select().from(rosters).where(eq(rosters.leagueId, leagueId)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(rosterSwaps)
        .where(eq(rosterSwaps.leagueId, leagueId)),
    ).toHaveLength(0);
  });

  it("uses the composite index for the per-(league, user) roster read (EXPLAIN)", async () => {
    const { leagueId, userId, animeIds } = await seedFixtures(db);
    await db
      .insert(rosters)
      .values({ leagueId, userId, animeId: animeIds[0]! });

    const plan = await db.all<{ detail: string }>(
      `EXPLAIN QUERY PLAN SELECT * FROM rosters WHERE league_id = '${leagueId}' AND user_id = '${userId}'`,
    );
    const detail = plan.map((r) => r.detail).join(" ");
    expect(detail).toContain("rosters_league_id_user_id_idx");
    expect(detail).not.toMatch(/SCAN rosters\b/);
  });
});
