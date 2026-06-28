import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { and, desc, eq, isNull, lt, or, type SQL } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { createDb, type Db } from "../index";
import { activityLog } from "./activity";
import { anime } from "./anime";
import { users } from "./auth";
import { leagues } from "./leagues";
import { notificationEvents } from "./notifications";
import { weeklySnapshots } from "./scoring";

/**
 * Round-trip tests for the scoring-history / activity / notification schema
 * (issue #41).
 *
 * Each test runs against its own fresh in-memory libsql database, migrated from
 * the committed drizzle-kit SQL — so applying the full chain doubles as the
 * "migration 0006 applies cleanly on top of 0000–0005" check (acceptance
 * criterion: all three tables migrate cleanly). Beyond insert/select
 * round-trips, this covers the snapshot uniqueness invariant, JSON-mode payload
 * round-trips, the unread-by-user partial index, and the headline acceptance
 * criterion: a 10k-row activity log paginates under 100ms via the
 * (league_id, occurred_at) index (confirmed both by `EXPLAIN QUERY PLAN` and a
 * wall-clock budget).
 */

const MIGRATIONS = [
  "0000_true_nighthawk.sql",
  "0001_tough_talkback.sql",
  "0002_flashy_inhumans.sql",
  "0003_tense_masque.sql",
  "0004_unusual_vampiro.sql",
  "0005_supreme_kate_bishop.sql",
  "0006_first_nemesis.sql",
];

function firstRow<T>(rows: T[]): T {
  const row = rows[0];
  if (row === undefined) throw new Error("expected at least one row");
  return row;
}

async function applyMigrations(db: Db): Promise<void> {
  // libsql honours foreign keys only when asked; enable so cascade/refs apply.
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

/** Seed the league + user + anime rows these tables depend on. */
async function seedFixtures(db: Db): Promise<{
  leagueId: string;
  userId: string;
  animeIds: number[];
}> {
  const userId = crypto.randomUUID();
  await db.insert(users).values({ id: userId, email: "scorer@anidraft.test" });

  const league = firstRow(
    await db
      .insert(leagues)
      .values({
        name: "Scoring League",
        commissionerId: userId,
        season: "SUMMER",
        seasonYear: 2026,
        maxPlayers: 4,
      })
      .returning(),
  );

  const animeIds = [301, 302, 303];
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

describe("weekly_snapshots round-trips", () => {
  let db: Db;

  beforeEach(async () => {
    db = createDb(":memory:");
    await applyMigrations(db);
  });

  it("round-trips a snapshot, preserving the JSON breakdown and stamping snapshotted_at", async () => {
    const { leagueId, userId, animeIds } = await seedFixtures(db);
    const breakdown = { [animeIds[0]!]: 40, [animeIds[1]!]: 35 };

    const created = firstRow(
      await db
        .insert(weeklySnapshots)
        .values({
          leagueId,
          userId,
          weekNumber: 1,
          scoreValue: 75,
          animeBreakdownJson: breakdown,
        })
        .returning(),
    );

    expect(created.id).toBeTruthy();
    expect(created.scoreValue).toBe(75);
    // snapshotted_at comes from the schema default.
    expect(created.snapshottedAt).toBeInstanceOf(Date);
    // JSON mode hands back the parsed object, not a string.
    expect(created.animeBreakdownJson).toEqual(breakdown);

    const fetched = firstRow(
      await db
        .select()
        .from(weeklySnapshots)
        .where(eq(weeklySnapshots.id, created.id)),
    );
    expect(fetched.leagueId).toBe(leagueId);
    expect(fetched.weekNumber).toBe(1);
    expect(fetched.animeBreakdownJson).toEqual(breakdown);
  });

  it("enforces uniqueness on (league_id, user_id, week_number)", async () => {
    const { leagueId, userId, animeIds } = await seedFixtures(db);
    await db.insert(weeklySnapshots).values({
      leagueId,
      userId,
      weekNumber: 1,
      scoreValue: 10,
      animeBreakdownJson: { [animeIds[0]!]: 10 },
    });

    // A second snapshot for the same (league, user, week) is rejected — the
    // snapshot worker writes each user's week exactly once.
    await expect(
      db.insert(weeklySnapshots).values({
        leagueId,
        userId,
        weekNumber: 1,
        scoreValue: 20,
        animeBreakdownJson: { [animeIds[0]!]: 20 },
      }),
    ).rejects.toThrow();
  });

  it("allows the same user to be snapshotted across different weeks", async () => {
    const { leagueId, userId, animeIds } = await seedFixtures(db);
    await db.insert(weeklySnapshots).values({
      leagueId,
      userId,
      weekNumber: 1,
      scoreValue: 10,
      animeBreakdownJson: { [animeIds[0]!]: 10 },
    });

    await expect(
      db.insert(weeklySnapshots).values({
        leagueId,
        userId,
        weekNumber: 2,
        scoreValue: 25,
        animeBreakdownJson: { [animeIds[0]!]: 25 },
      }),
    ).resolves.toBeDefined();

    const history = await db
      .select()
      .from(weeklySnapshots)
      .where(eq(weeklySnapshots.userId, userId));
    expect(history).toHaveLength(2);
  });

  it("cascades snapshot deletes when the league is removed", async () => {
    const { leagueId, userId, animeIds } = await seedFixtures(db);
    await db.insert(weeklySnapshots).values({
      leagueId,
      userId,
      weekNumber: 1,
      scoreValue: 10,
      animeBreakdownJson: { [animeIds[0]!]: 10 },
    });

    await db.delete(leagues).where(eq(leagues.id, leagueId));

    expect(
      await db
        .select()
        .from(weeklySnapshots)
        .where(eq(weeklySnapshots.leagueId, leagueId)),
    ).toHaveLength(0);
  });
});

describe("activity_log round-trips and pagination", () => {
  let db: Db;

  beforeEach(async () => {
    db = createDb(":memory:");
    await applyMigrations(db);
  });

  it("round-trips an activity row, preserving the JSON payload and event_type", async () => {
    const { leagueId, animeIds } = await seedFixtures(db);
    const payload = { animeId: animeIds[0], pickNumber: 1 };

    const created = firstRow(
      await db
        .insert(activityLog)
        .values({ leagueId, eventType: "draft_pick", payloadJson: payload })
        .returning(),
    );

    expect(created.id).toBeTruthy();
    expect(created.eventType).toBe("draft_pick");
    expect(created.occurredAt).toBeInstanceOf(Date);
    // JSON mode hands back the parsed object, not a string.
    expect(created.payloadJson).toEqual(payload);

    const fetched = firstRow(
      await db.select().from(activityLog).where(eq(activityLog.id, created.id)),
    );
    expect(fetched.leagueId).toBe(leagueId);
    expect(fetched.payloadJson).toEqual(payload);
  });

  it("cascades activity deletes when the league is removed", async () => {
    const { leagueId } = await seedFixtures(db);
    await db
      .insert(activityLog)
      .values({ leagueId, eventType: "league_finalize", payloadJson: {} });

    await db.delete(leagues).where(eq(leagues.id, leagueId));

    expect(
      await db
        .select()
        .from(activityLog)
        .where(eq(activityLog.leagueId, leagueId)),
    ).toHaveLength(0);
  });

  it("paginates a 10k-row activity log under 100ms via the composite index", async () => {
    const { leagueId } = await seedFixtures(db);

    // Stamp explicit, strictly-increasing occurred_at values so the keyset
    // cursor below is deterministic (the schema default would collapse many rows
    // onto the same millisecond).
    const base = 1_700_000_000_000;
    const rows = Array.from({ length: 10_000 }, (_, i) => ({
      leagueId,
      eventType: "score_snapshot" as const,
      payloadJson: { i },
      occurredAt: new Date(base + i),
    }));
    // Chunked inserts keep each statement's bound-parameter count well under the
    // SQLite variable limit while still loading all 10k rows.
    for (let i = 0; i < rows.length; i += 500) {
      await db.insert(activityLog).values(rows.slice(i, i + 500));
    }

    const PAGE = 50;

    // First page: newest-first, no cursor. Order by (occurred_at, id) — the
    // index's order — so paging has a total order to walk.
    const start = performance.now();
    const firstPage = await db
      .select()
      .from(activityLog)
      .where(eq(activityLog.leagueId, leagueId))
      .orderBy(desc(activityLog.occurredAt), desc(activityLog.id))
      .limit(PAGE);
    const firstElapsed = performance.now() - start;

    expect(firstPage).toHaveLength(PAGE);
    // Newest row first (highest occurred_at).
    expect(firstPage[0]!.occurredAt.getTime()).toBe(base + 9_999);
    expect(firstElapsed).toBeLessThan(100);

    // Next page via the compound keyset cursor (occurred_at, id) — the indexed
    // range scan that keeps pagination flat regardless of how deep we go, and
    // (unlike a bare occurred_at cursor) can't skip rows sharing a millisecond.
    const last = firstPage[firstPage.length - 1]!;
    const nextStart = performance.now();
    const nextPage = await db
      .select()
      .from(activityLog)
      .where(
        and(
          eq(activityLog.leagueId, leagueId),
          or(
            lt(activityLog.occurredAt, last.occurredAt),
            and(
              eq(activityLog.occurredAt, last.occurredAt),
              lt(activityLog.id, last.id),
            ),
          ),
        ),
      )
      .orderBy(desc(activityLog.occurredAt), desc(activityLog.id))
      .limit(PAGE);
    const nextElapsed = performance.now() - nextStart;

    expect(nextPage).toHaveLength(PAGE);
    expect(nextPage[0]!.occurredAt.getTime()).toBe(base + 9_999 - PAGE);
    expect(nextElapsed).toBeLessThan(100);
  });

  it("pages a tied-timestamp feed without skipping or repeating rows (compound keyset)", async () => {
    const { leagueId } = await seedFixtures(db);

    // Every row shares one occurred_at millisecond — the production hazard the
    // bare-occurred_at cursor would mishandle. With 120 rows and a page of 50,
    // a cursor on occurred_at alone would stall (every row is `=`, none `<`) or
    // drop the boundary rows; the (occurred_at, id) cursor must walk all 120.
    const sharedAt = new Date(1_700_000_000_000);
    const TOTAL = 120;
    const rows = Array.from({ length: TOTAL }, () => ({
      leagueId,
      eventType: "score_snapshot" as const,
      payloadJson: {},
      occurredAt: sharedAt,
    }));
    await db.insert(activityLog).values(rows);

    const PAGE = 50;
    const seen = new Set<string>();
    let cursor: { occurredAt: Date; id: string } | null = null;

    // Walk every page to exhaustion via the compound cursor.
    for (;;) {
      const where: SQL | undefined = cursor
        ? and(
            eq(activityLog.leagueId, leagueId),
            or(
              lt(activityLog.occurredAt, cursor.occurredAt),
              and(
                eq(activityLog.occurredAt, cursor.occurredAt),
                lt(activityLog.id, cursor.id),
              ),
            ),
          )
        : eq(activityLog.leagueId, leagueId);

      const page: (typeof activityLog.$inferSelect)[] = await db
        .select()
        .from(activityLog)
        .where(where)
        .orderBy(desc(activityLog.occurredAt), desc(activityLog.id))
        .limit(PAGE);

      if (page.length === 0) break;
      for (const row of page) {
        // No row is ever served twice across pages.
        expect(seen.has(row.id)).toBe(false);
        seen.add(row.id);
      }
      const tail = page[page.length - 1]!;
      cursor = { occurredAt: tail.occurredAt, id: tail.id };
    }

    // Every row was visited exactly once — no boundary-millisecond skips.
    expect(seen.size).toBe(TOTAL);
  });

  it("uses the composite index for the latest-activity-by-league read (EXPLAIN)", async () => {
    const { leagueId } = await seedFixtures(db);
    await db
      .insert(activityLog)
      .values({ leagueId, eventType: "score_snapshot", payloadJson: {} });

    const plan = await db.all<{ detail: string }>(
      `EXPLAIN QUERY PLAN SELECT * FROM activity_log WHERE league_id = '${leagueId}' ORDER BY occurred_at DESC, id DESC LIMIT 50`,
    );
    const detail = plan.map((r) => r.detail).join(" ");
    expect(detail).toContain("activity_log_league_id_occurred_at_id_idx");
    expect(detail).not.toMatch(/SCAN activity_log\b/);
    // The index supplies the order, so no separate sort step is planned.
    expect(detail).not.toMatch(/USE TEMP B-TREE FOR ORDER BY/);
  });
});

describe("notification_events round-trips", () => {
  let db: Db;

  beforeEach(async () => {
    db = createDb(":memory:");
    await applyMigrations(db);
  });

  it("round-trips a notification with nullable lifecycle stamps defaulting to null", async () => {
    const { userId } = await seedFixtures(db);
    const payload = { week: 3, rank: 1 };

    const created = firstRow(
      await db
        .insert(notificationEvents)
        .values({ userId, type: "weekly_results", payloadJson: payload })
        .returning(),
    );

    expect(created.id).toBeTruthy();
    expect(created.type).toBe("weekly_results");
    expect(created.createdAt).toBeInstanceOf(Date);
    expect(created.payloadJson).toEqual(payload);
    // V1: unread + undelivered until logic exists to stamp these.
    expect(created.readAt).toBeNull();
    expect(created.deliveredEmailAt).toBeNull();
    expect(created.deliveredPushAt).toBeNull();
  });

  it("returns only unread rows for the unread-by-user read", async () => {
    const { userId } = await seedFixtures(db);
    const unread = firstRow(
      await db
        .insert(notificationEvents)
        .values({ userId, type: "your_turn", payloadJson: {} })
        .returning(),
    );
    const read = firstRow(
      await db
        .insert(notificationEvents)
        .values({ userId, type: "draft_starting", payloadJson: {} })
        .returning(),
    );
    await db
      .update(notificationEvents)
      .set({ readAt: new Date() })
      .where(eq(notificationEvents.id, read.id));

    const unreadRows = await db
      .select()
      .from(notificationEvents)
      .where(
        and(
          eq(notificationEvents.userId, userId),
          isNull(notificationEvents.readAt),
        ),
      );
    expect(unreadRows).toHaveLength(1);
    expect(unreadRows[0]!.id).toBe(unread.id);
  });

  it("cascades notification deletes when the user is removed", async () => {
    const { userId } = await seedFixtures(db);
    await db
      .insert(notificationEvents)
      .values({ userId, type: "league_completed", payloadJson: {} });

    await db.delete(users).where(eq(users.id, userId));

    expect(
      await db
        .select()
        .from(notificationEvents)
        .where(eq(notificationEvents.userId, userId)),
    ).toHaveLength(0);
  });

  it("uses the partial unread index for the unread-by-user read (EXPLAIN)", async () => {
    const { userId } = await seedFixtures(db);
    await db
      .insert(notificationEvents)
      .values({ userId, type: "your_turn", payloadJson: {} });

    const plan = await db.all<{ detail: string }>(
      `EXPLAIN QUERY PLAN SELECT * FROM notification_events WHERE user_id = '${userId}' AND read_at IS NULL ORDER BY created_at DESC`,
    );
    const detail = plan.map((r) => r.detail).join(" ");
    expect(detail).toContain("notification_events_unread_by_user_idx");
    expect(detail).not.toMatch(/SCAN notification_events\b/);
  });
});
