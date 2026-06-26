import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createDb,
  inviteCodes,
  leagueMembers,
  leagues,
  users,
  type Db,
} from "@anidraft/db";

import { joinLeague } from "./joinLeague";

/**
 * Unit tests for the join-league domain logic. Like `createLeague.test.ts`, each
 * test runs against a fresh libsql database (a throwaway temp file) with the
 * committed drizzle migrations applied, so the inserts/lookups exercise the real
 * schema — composite PK, enum columns, the `kickedAt`/`uses` columns the guards
 * read. A file (not `:memory:`) is required because `joinLeague` runs in a
 * transaction and the libsql client opens a new connection afterwards.
 */

const MIGRATIONS = ["0000_true_nighthawk.sql", "0001_tough_talkback.sql"];

async function applyMigrations(db: Db): Promise<void> {
  await db.run("PRAGMA foreign_keys = ON");
  for (const file of MIGRATIONS) {
    const path = fileURLToPath(
      new URL(`../../../../packages/db/drizzle/${file}`, import.meta.url),
    );
    const sql = readFileSync(path, "utf8");
    for (const statement of sql.split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (trimmed) await db.run(trimmed);
    }
  }
}

/** Insert a user row and return its id. */
async function seedUser(db: Db, email: string): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(users).values({ id, email });
  return id;
}

interface SeedLeagueOptions {
  status?: "setup" | "finalized" | "drafting" | "in_season" | "completed";
  maxPlayers?: number;
  code?: string;
  expiresAt?: Date | null;
  maxUses?: number | null;
  uses?: number;
}

/** Seed a private league (commissioner + invite code) and return their ids. */
async function seedLeague(
  db: Db,
  commissionerId: string,
  options: SeedLeagueOptions = {},
): Promise<{ leagueId: string; code: string }> {
  const {
    status = "setup",
    maxPlayers = 4,
    code = "JOIN2345",
    expiresAt = null,
    maxUses = null,
    uses = 0,
  } = options;

  const [league] = await db
    .insert(leagues)
    .values({
      name: "Joinable League",
      visibility: "private",
      commissionerId,
      season: "SPRING",
      seasonYear: 2026,
      maxPlayers,
      status,
    })
    .returning({ id: leagues.id });
  if (!league) throw new Error("seed: league insert failed");

  await db.insert(leagueMembers).values({
    leagueId: league.id,
    userId: commissionerId,
    role: "commissioner",
  });

  await db
    .insert(inviteCodes)
    .values({ code, leagueId: league.id, expiresAt, maxUses, uses });

  return { leagueId: league.id, code };
}

describe("joinLeague", () => {
  let db: Db;
  let dir: string;
  let commissionerId: string;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "anidraft-joinleague-"));
    db = createDb(`file:${join(dir, "test.db")}`);
    await applyMigrations(db);
    commissionerId = await seedUser(db, "commish@anidraft.test");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("adds the user as a player and bumps the invite use count", async () => {
    const { leagueId, code } = await seedLeague(db, commissionerId);
    const joinerId = await seedUser(db, "joiner@anidraft.test");

    const result = await joinLeague(db, joinerId, code);

    expect(result).toEqual({ status: "joined", leagueId });

    const [member] = await db
      .select()
      .from(leagueMembers)
      .where(eq(leagueMembers.userId, joinerId));
    expect(member?.leagueId).toBe(leagueId);
    expect(member?.role).toBe("player");

    const [invite] = await db
      .select()
      .from(inviteCodes)
      .where(eq(inviteCodes.code, code));
    expect(invite?.uses).toBe(1);
  });

  it("returns already_member when the user is in the league and does not duplicate the row", async () => {
    const { leagueId, code } = await seedLeague(db, commissionerId);
    const joinerId = await seedUser(db, "joiner@anidraft.test");
    await joinLeague(db, joinerId, code);

    const second = await joinLeague(db, joinerId, code);

    expect(second).toEqual({ status: "already_member", leagueId });

    const rows = await db
      .select()
      .from(leagueMembers)
      .where(eq(leagueMembers.userId, joinerId));
    expect(rows).toHaveLength(1);
    // The idempotent path must not have advanced the use count a second time.
    const [invite] = await db
      .select()
      .from(inviteCodes)
      .where(eq(inviteCodes.code, code));
    expect(invite?.uses).toBe(1);
  });

  it("treats the commissioner re-using the link as already_member", async () => {
    const { leagueId, code } = await seedLeague(db, commissionerId);

    const result = await joinLeague(db, commissionerId, code);

    expect(result).toEqual({ status: "already_member", leagueId });
  });

  it("returns invalid_code for an unknown code", async () => {
    await seedLeague(db, commissionerId);
    const joinerId = await seedUser(db, "joiner@anidraft.test");

    const result = await joinLeague(db, joinerId, "NOPE2345");

    expect(result).toEqual({ status: "invalid_code" });
  });

  it("returns expired when the code is past its expiry", async () => {
    const { code } = await seedLeague(db, commissionerId, {
      expiresAt: new Date("2020-01-01T00:00:00Z"),
    });
    const joinerId = await seedUser(db, "joiner@anidraft.test");

    const result = await joinLeague(db, joinerId, code);

    expect(result).toEqual({ status: "expired" });
    const [member] = await db
      .select()
      .from(leagueMembers)
      .where(eq(leagueMembers.userId, joinerId));
    expect(member).toBeUndefined();
  });

  it("returns expired when the code has hit its max uses", async () => {
    const { code } = await seedLeague(db, commissionerId, {
      maxUses: 2,
      uses: 2,
    });
    const joinerId = await seedUser(db, "joiner@anidraft.test");

    const result = await joinLeague(db, joinerId, code);

    expect(result).toEqual({ status: "expired" });
  });

  it("returns wrong_state with the league's status when it is not in setup", async () => {
    const { leagueId, code } = await seedLeague(db, commissionerId, {
      status: "drafting",
    });
    const joinerId = await seedUser(db, "joiner@anidraft.test");

    const result = await joinLeague(db, joinerId, code);

    expect(result).toEqual({
      status: "wrong_state",
      leagueId,
      leagueStatus: "drafting",
    });
  });

  it("returns league_full when every seat is taken", async () => {
    // maxPlayers 2: commissioner + one more fills it.
    const { leagueId, code } = await seedLeague(db, commissionerId, {
      maxPlayers: 2,
    });
    const firstJoiner = await seedUser(db, "first@anidraft.test");
    await joinLeague(db, firstJoiner, code);

    const secondJoiner = await seedUser(db, "second@anidraft.test");
    const result = await joinLeague(db, secondJoiner, code);

    expect(result).toEqual({ status: "league_full", leagueId });
    const [member] = await db
      .select()
      .from(leagueMembers)
      .where(eq(leagueMembers.userId, secondJoiner));
    expect(member).toBeUndefined();
  });

  it("uses the injected clock for the expiry check", async () => {
    const expiresAt = new Date("2026-06-01T00:00:00Z");
    const { leagueId, code } = await seedLeague(db, commissionerId, {
      expiresAt,
    });
    const joinerId = await seedUser(db, "joiner@anidraft.test");

    // A moment before expiry: the join succeeds.
    const before = await joinLeague(
      db,
      joinerId,
      code,
      new Date("2026-05-31T23:59:59Z"),
    );
    expect(before).toEqual({ status: "joined", leagueId });

    // A fresh joiner after expiry is rejected.
    const lateJoiner = await seedUser(db, "late@anidraft.test");
    const after = await joinLeague(
      db,
      lateJoiner,
      code,
      new Date("2026-06-02T00:00:00Z"),
    );
    expect(after).toEqual({ status: "expired" });
  });
});
