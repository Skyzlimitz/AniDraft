import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { type Db } from "../index";
import { createMigratedDb } from "../testing";
import { anime } from "./anime";
import { users } from "./auth";
import { drafts, picks } from "./draft";
import { leagues } from "./leagues";

/**
 * Round-trip test for the draft schema (issue #40).
 *
 * Each test runs against its own fresh in-memory libsql database, migrated from
 * the committed drizzle-kit SQL — so applying the full chain doubles as the
 * "migration 0004 applies cleanly on top of 0000–0003" check: if the generated
 * SQL is malformed or drifts from the schema, table creation throws here. Each
 * table is then exercised with insert/select round-trips, the DB-level
 * invariants (unique pick number / no double-draft) are probed, and the hot-read
 * indexes are confirmed via `EXPLAIN QUERY PLAN`.
 */

function firstRow<T>(rows: T[]): T {
  const row = rows[0];
  if (row === undefined) throw new Error("expected at least one row");
  return row;
}

/** Seed the league + user + anime rows a draft/pick depends on. */
async function seedFixtures(db: Db): Promise<{
  leagueId: string;
  userId: string;
  animeIds: number[];
}> {
  const userId = crypto.randomUUID();
  await db.insert(users).values({ id: userId, email: "drafter@anidraft.test" });

  const league = firstRow(
    await db
      .insert(leagues)
      .values({
        name: "Draft League",
        commissionerId: userId,
        season: "SPRING",
        seasonYear: 2026,
        maxPlayers: 4,
      })
      .returning(),
  );

  const animeIds = [101, 102, 103];
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

describe("draft schema round-trips", () => {
  let db: Db;

  beforeEach(async () => {
    db = await createMigratedDb();
  });

  it("round-trips a draft, preserving the JSON turn order and defaults", async () => {
    const { leagueId, userId } = await seedFixtures(db);
    const order = [userId, crypto.randomUUID(), crypto.randomUUID()];

    const created = firstRow(
      await db
        .insert(drafts)
        .values({ leagueId, orderJson: order })
        .returning(),
    );

    expect(created.id).toBeTruthy();
    // Defaults are populated by the schema, not the caller.
    expect(created.status).toBe("pending");
    expect(created.currentPickIndex).toBe(0);
    expect(created.startedAt).toBeNull();
    expect(created.completedAt).toBeNull();
    expect(created.createdAt).toBeInstanceOf(Date);
    // JSON mode hands back the parsed array, not a string.
    expect(created.orderJson).toEqual(order);

    const fetched = firstRow(
      await db.select().from(drafts).where(eq(drafts.id, created.id)),
    );
    expect(fetched.leagueId).toBe(leagueId);
    expect(fetched.orderJson).toEqual(order);
  });

  it("enforces one draft per league via the unique index", async () => {
    const { leagueId, userId } = await seedFixtures(db);
    await db.insert(drafts).values({ leagueId, orderJson: [userId] });

    await expect(
      db.insert(drafts).values({ leagueId, orderJson: [userId] }),
    ).rejects.toThrow();
  });

  it("round-trips a pick and auto-stamps picked_at", async () => {
    const { leagueId, userId, animeIds } = await seedFixtures(db);
    const draft = firstRow(
      await db
        .insert(drafts)
        .values({ leagueId, orderJson: [userId] })
        .returning(),
    );

    const created = firstRow(
      await db
        .insert(picks)
        .values({
          draftId: draft.id,
          pickNumber: 1,
          round: 1,
          userId,
          animeId: animeIds[0]!,
        })
        .returning(),
    );

    expect(created.pickNumber).toBe(1);
    expect(created.round).toBe(1);
    // picked_at / was_auto_pick come from the schema defaults.
    expect(created.pickedAt).toBeInstanceOf(Date);
    expect(created.wasAutoPick).toBe(false);

    const fetched = firstRow(
      await db
        .select()
        .from(picks)
        .where(and(eq(picks.draftId, draft.id), eq(picks.pickNumber, 1))),
    );
    expect(fetched.userId).toBe(userId);
    expect(fetched.animeId).toBe(animeIds[0]);
  });

  it("rejects a duplicate pick_number within a draft", async () => {
    const { leagueId, userId, animeIds } = await seedFixtures(db);
    const draft = firstRow(
      await db
        .insert(drafts)
        .values({ leagueId, orderJson: [userId] })
        .returning(),
    );
    await db.insert(picks).values({
      draftId: draft.id,
      pickNumber: 1,
      round: 1,
      userId,
      animeId: animeIds[0]!,
    });

    await expect(
      db.insert(picks).values({
        draftId: draft.id,
        pickNumber: 1,
        round: 1,
        userId,
        animeId: animeIds[1]!,
      }),
    ).rejects.toThrow();
  });

  it("rejects drafting the same anime twice in one draft", async () => {
    const { leagueId, userId, animeIds } = await seedFixtures(db);
    const draft = firstRow(
      await db
        .insert(drafts)
        .values({ leagueId, orderJson: [userId] })
        .returning(),
    );
    await db.insert(picks).values({
      draftId: draft.id,
      pickNumber: 1,
      round: 1,
      userId,
      animeId: animeIds[0]!,
    });

    await expect(
      db.insert(picks).values({
        draftId: draft.id,
        pickNumber: 2,
        round: 1,
        userId,
        animeId: animeIds[0]!,
      }),
    ).rejects.toThrow();
  });

  it("cascades draft + pick deletes when the league is removed", async () => {
    const { leagueId, userId, animeIds } = await seedFixtures(db);
    const draft = firstRow(
      await db
        .insert(drafts)
        .values({ leagueId, orderJson: [userId] })
        .returning(),
    );
    await db.insert(picks).values({
      draftId: draft.id,
      pickNumber: 1,
      round: 1,
      userId,
      animeId: animeIds[0]!,
    });

    await db.delete(leagues).where(eq(leagues.id, leagueId));

    expect(
      await db.select().from(drafts).where(eq(drafts.leagueId, leagueId)),
    ).toHaveLength(0);
    expect(
      await db.select().from(picks).where(eq(picks.draftId, draft.id)),
    ).toHaveLength(0);
  });

  it("uses the unique index for the per-draft pick lookup (EXPLAIN)", async () => {
    const { leagueId, userId, animeIds } = await seedFixtures(db);
    const draft = firstRow(
      await db
        .insert(drafts)
        .values({ leagueId, orderJson: [userId] })
        .returning(),
    );
    await db.insert(picks).values({
      draftId: draft.id,
      pickNumber: 1,
      round: 1,
      userId,
      animeId: animeIds[0]!,
    });

    // The bound value is irrelevant to the chosen plan, so a literal keeps the
    // EXPLAIN a single self-contained statement.
    const plan = await db.all<{ detail: string }>(
      `EXPLAIN QUERY PLAN SELECT * FROM picks WHERE draft_id = '${draft.id}' ORDER BY pick_number`,
    );
    const detail = plan.map((r) => r.detail).join(" ");
    // The hot "all picks for this draft, in order" read must hit the index, not
    // scan the table.
    expect(detail).toContain("picks_draft_id_pick_number_idx");
    expect(detail).not.toMatch(/SCAN picks\b/);
  });
});
