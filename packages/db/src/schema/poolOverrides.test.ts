import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { createDb, type Db } from "../index";
import { users } from "./auth";
import { leagues } from "./leagues";
import { poolOverrides } from "./poolOverrides";

/**
 * Round-trip test for the pool-overrides schema (issue #36).
 *
 * Like the league schema test, this applies the committed drizzle-kit
 * migrations to a fresh in-memory libsql database — which doubles as the
 * "migration 0002 applies cleanly on top of 0000/0001" check — then exercises
 * the table with insert/select round-trips and the FK cascade.
 */

const MIGRATIONS = [
  "0000_true_nighthawk.sql",
  "0001_tough_talkback.sql",
  "0002_aberrant_squadron_sinister.sql",
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

describe("pool overrides schema round-trips", () => {
  let db: Db;
  let leagueId: string;

  beforeAll(async () => {
    db = createDb(":memory:");
    await applyMigrations(db);

    const commissionerId = crypto.randomUUID();
    await db
      .insert(users)
      .values({ id: commissionerId, email: "commish@anidraft.test" });
    const league = firstRow(
      await db
        .insert(leagues)
        .values({
          name: "Override League",
          commissionerId,
          season: "SPRING",
          seasonYear: 2026,
          maxPlayers: 8,
        })
        .returning(),
    );
    leagueId = league.id;
  });

  it("inserts and reads back an addition with snapshot title + cover", async () => {
    const created = firstRow(
      await db
        .insert(poolOverrides)
        .values({
          leagueId,
          anilistId: 12345,
          kind: "addition",
          title: "Carry-over Show",
          coverImage: "https://s4.anilist.co/cover.jpg",
        })
        .returning(),
    );

    expect(created.id).toBeTruthy();
    expect(created.kind).toBe("addition");
    expect(created.createdAt).toBeInstanceOf(Date);

    const fetched = firstRow(
      await db
        .select()
        .from(poolOverrides)
        .where(eq(poolOverrides.id, created.id)),
    );
    expect(fetched.anilistId).toBe(12345);
    expect(fetched.title).toBe("Carry-over Show");
    expect(fetched.coverImage).toBe("https://s4.anilist.co/cover.jpg");
  });

  it("inserts an exclusion with null snapshot columns", async () => {
    const created = firstRow(
      await db
        .insert(poolOverrides)
        .values({ leagueId, anilistId: 999, kind: "exclusion" })
        .returning(),
    );

    expect(created.kind).toBe("exclusion");
    expect(created.title).toBeNull();
    expect(created.coverImage).toBeNull();
  });

  it("cascades override deletes when the league is removed", async () => {
    const departingCommissioner = crypto.randomUUID();
    await db
      .insert(users)
      .values({ id: departingCommissioner, email: "doomed@anidraft.test" });
    const doomed = firstRow(
      await db
        .insert(leagues)
        .values({
          name: "Doomed Pool League",
          commissionerId: departingCommissioner,
          season: "FALL",
          seasonYear: 2026,
          maxPlayers: 4,
        })
        .returning(),
    );
    await db
      .insert(poolOverrides)
      .values({ leagueId: doomed.id, anilistId: 1, kind: "exclusion" });

    await db.delete(leagues).where(eq(leagues.id, doomed.id));

    const remaining = await db
      .select()
      .from(poolOverrides)
      .where(eq(poolOverrides.leagueId, doomed.id));
    expect(remaining).toHaveLength(0);
  });
});
