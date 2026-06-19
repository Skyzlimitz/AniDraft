import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { createDb, type Db } from "../index";
import { users } from "./auth";
import { inviteCodes, leagueMembers, leagues } from "./leagues";

/**
 * Round-trip test for the league schema (issue #27).
 *
 * Rather than hand-rolled DDL, this applies the committed drizzle-kit
 * migrations (`drizzle/*.sql`) to a fresh in-memory libsql database. That
 * doubles as the "migration applies cleanly to a fresh branch" check: if the
 * generated SQL is malformed or drifts from the schema, table creation throws
 * here. Each league table is then exercised with an insert/select round-trip.
 */

const MIGRATIONS = ["0000_true_nighthawk.sql", "0001_happy_ogun.sql"];

/** Narrow the first row of a result set, failing loudly if it is missing. */
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

describe("league schema round-trips", () => {
  let db: Db;
  let commissionerId: string;

  beforeAll(async () => {
    db = createDb(":memory:");
    await applyMigrations(db);

    // Leagues/members reference the auth `user` table; seed a commissioner.
    commissionerId = crypto.randomUUID();
    await db
      .insert(users)
      .values({ id: commissionerId, email: "commish@anidraft.test" });
  });

  it("inserts and reads back a league with enum + default columns", async () => {
    const created = firstRow(
      await db
        .insert(leagues)
        .values({
          name: "Spring Showdown",
          visibility: "private",
          commissionerId,
          season: "SPRING",
          seasonYear: 2026,
          maxPlayers: 8,
        })
        .returning(),
    );

    expect(created.id).toBeTruthy();
    // Defaults are populated by the schema, not the caller.
    expect(created.status).toBe("setup");
    expect(created.pickTimerSeconds).toBe(60);
    expect(created.finalizedAt).toBeNull();
    expect(created.createdAt).toBeInstanceOf(Date);

    const fetched = firstRow(
      await db.select().from(leagues).where(eq(leagues.id, created.id)),
    );
    expect(fetched.name).toBe("Spring Showdown");
    expect(fetched.season).toBe("SPRING");
    expect(fetched.seasonYear).toBe(2026);
    expect(fetched.visibility).toBe("private");
  });

  it("inserts and reads back a league member with composite key", async () => {
    const league = firstRow(
      await db
        .insert(leagues)
        .values({
          name: "Member League",
          commissionerId,
          season: "FALL",
          seasonYear: 2026,
          maxPlayers: 4,
        })
        .returning(),
    );

    await db.insert(leagueMembers).values({
      leagueId: league.id,
      userId: commissionerId,
      role: "commissioner",
    });

    const member = firstRow(
      await db
        .select()
        .from(leagueMembers)
        .where(eq(leagueMembers.leagueId, league.id)),
    );
    expect(member.userId).toBe(commissionerId);
    expect(member.role).toBe("commissioner");
    expect(member.joinedAt).toBeInstanceOf(Date);
    expect(member.kickedAt).toBeNull();
  });

  it("inserts and reads back an invite code with nullable limits", async () => {
    const league = firstRow(
      await db
        .insert(leagues)
        .values({
          name: "Invite League",
          commissionerId,
          season: "SUMMER",
          seasonYear: 2026,
          maxPlayers: 6,
        })
        .returning(),
    );

    await db.insert(inviteCodes).values({
      code: "ABCD2345",
      leagueId: league.id,
    });

    const invite = firstRow(
      await db
        .select()
        .from(inviteCodes)
        .where(eq(inviteCodes.code, "ABCD2345")),
    );
    expect(invite.leagueId).toBe(league.id);
    expect(invite.uses).toBe(0); // default
    expect(invite.expiresAt).toBeNull();
    expect(invite.maxUses).toBeNull();
  });

  it("cascades member + invite deletes when a league is removed", async () => {
    const league = firstRow(
      await db
        .insert(leagues)
        .values({
          name: "Doomed League",
          commissionerId,
          season: "WINTER",
          seasonYear: 2026,
          maxPlayers: 2,
        })
        .returning(),
    );
    await db
      .insert(leagueMembers)
      .values({ leagueId: league.id, userId: commissionerId });
    await db
      .insert(inviteCodes)
      .values({ code: "DOOMED99", leagueId: league.id });

    await db.delete(leagues).where(eq(leagues.id, league.id));

    const members = await db
      .select()
      .from(leagueMembers)
      .where(eq(leagueMembers.leagueId, league.id));
    const invites = await db
      .select()
      .from(inviteCodes)
      .where(eq(inviteCodes.leagueId, league.id));
    expect(members).toHaveLength(0);
    expect(invites).toHaveLength(0);
  });
});
