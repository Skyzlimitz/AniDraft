import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { and, desc, eq, isNull } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  activityLog,
  anime,
  createDb,
  leagues,
  notificationEvents,
  users,
  weeklySnapshots,
  type ActivityEventType,
  type Db,
  type NotificationType,
} from "@anidraft/db";

/**
 * Integration test: the scoring-history / activity / notification tables ↔ the
 * `@anidraft/db` public entry point (issue #41).
 *
 * The cron snapshot worker (`apps/cron`) writes `weekly_snapshots`, and both it
 * and the web app push to `activity_log` / `notification_events`; the web app
 * reads the feed and unread counts back. None of that consumer logic exists yet
 * (it is deferred — see the issue), so this test pins the boundary that *will*
 * carry it: that the three tables and their enum types are reachable from the
 * package root the apps import, and round-trip through `createDb` against the
 * committed migration chain (so migration 0006 applying cleanly is exercised
 * across the package boundary, not just inside `@anidraft/db`'s own unit tests).
 *
 * The migrations are read from the db package's committed `drizzle/` output, the
 * same forward-only SQL CI applies, so this and production share one schema.
 */

const DB_MIGRATIONS = [
  "0000_true_nighthawk.sql",
  "0001_tough_talkback.sql",
  "0002_flashy_inhumans.sql",
  "0003_tense_masque.sql",
  "0004_unusual_vampiro.sql",
  "0005_supreme_kate_bishop.sql",
  "0006_natural_karnak.sql",
];

function firstRow<T>(rows: T[]): T {
  const row = rows[0];
  if (row === undefined) throw new Error("expected at least one row");
  return row;
}

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

async function seedFixtures(db: Db): Promise<{
  leagueId: string;
  userId: string;
  animeIds: number[];
}> {
  const userId = crypto.randomUUID();
  await db.insert(users).values({ id: userId, email: "history@anidraft.test" });

  const league = firstRow(
    await db
      .insert(leagues)
      .values({
        name: "History League",
        commissionerId: userId,
        season: "FALL",
        seasonYear: 2026,
        maxPlayers: 4,
      })
      .returning(),
  );

  const animeIds = [401, 402];
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

describe("scoring-history schema ↔ @anidraft/db boundary", () => {
  let db: Db;

  beforeEach(async () => {
    db = createDb(":memory:");
    await applyMigrations(db);
  });

  it("writes and reads back a weekly snapshot through the package entry point", async () => {
    const { leagueId, userId, animeIds } = await seedFixtures(db);
    const breakdown = { [animeIds[0]!]: 50, [animeIds[1]!]: 20 };

    await db.insert(weeklySnapshots).values({
      leagueId,
      userId,
      weekNumber: 4,
      scoreValue: 70,
      animeBreakdownJson: breakdown,
    });

    const fetched = firstRow(
      await db
        .select()
        .from(weeklySnapshots)
        .where(
          and(
            eq(weeklySnapshots.leagueId, leagueId),
            eq(weeklySnapshots.weekNumber, 4),
          ),
        ),
    );
    expect(fetched.scoreValue).toBe(70);
    expect(fetched.animeBreakdownJson).toEqual(breakdown);
  });

  it("appends to the activity feed and reads it back newest-first", async () => {
    const { leagueId, animeIds } = await seedFixtures(db);

    // The event types are the shared vocabulary the worker/app emit — pinned via
    // the exported `ActivityEventType` so a consumer can't drift from the schema.
    const events: {
      type: ActivityEventType;
      payload: Record<string, unknown>;
    }[] = [
      { type: "draft_pick", payload: { animeId: animeIds[0] } },
      { type: "roster_swap", payload: { out: animeIds[0], in: animeIds[1] } },
      { type: "score_snapshot", payload: { week: 1 } },
    ];
    for (const e of events) {
      await db
        .insert(activityLog)
        .values({ leagueId, eventType: e.type, payloadJson: e.payload });
    }

    const feed = await db
      .select()
      .from(activityLog)
      .where(eq(activityLog.leagueId, leagueId))
      .orderBy(desc(activityLog.occurredAt));
    expect(feed).toHaveLength(3);
    expect(feed.map((r) => r.eventType)).toContain("roster_swap");
  });

  it("raises a notification and surfaces it in the unread-by-user read", async () => {
    const { userId } = await seedFixtures(db);
    const type: NotificationType = "weekly_results";

    await db
      .insert(notificationEvents)
      .values({ userId, type, payloadJson: { week: 1, rank: 2 } });

    const unread = await db
      .select()
      .from(notificationEvents)
      .where(
        and(
          eq(notificationEvents.userId, userId),
          isNull(notificationEvents.readAt),
        ),
      );
    expect(unread).toHaveLength(1);
    // V1 delivery channels exist but stay unstamped (logic deferred).
    expect(unread[0]!.deliveredEmailAt).toBeNull();
    expect(unread[0]!.deliveredPushAt).toBeNull();
  });
});
