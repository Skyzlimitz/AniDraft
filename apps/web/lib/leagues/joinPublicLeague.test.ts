import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq, isNull } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  leagueMembers,
  leagues,
  users,
  createDb,
  type Db,
  type LeagueStatus,
} from "@anidraft/db";

import { joinPublicLeague } from "./joinPublicLeague";

/**
 * Unit tests for the public-join domain logic. Each test runs against a fresh
 * libsql file database with the committed migrations applied (a file, not
 * `:memory:`, because `joinPublicLeague` runs in a transaction and the libsql
 * client reconnects afterwards — see `joinLeague.test.ts`).
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

let userSeq = 0;
async function seedUser(db: Db): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(users).values({ id, email: `user-${userSeq++}@anidraft.test` });
  return id;
}

interface SeedLeagueOptions {
  visibility?: "public" | "private";
  status?: LeagueStatus;
  maxPlayers?: number;
  extraMembers?: number;
}

/** Seed a league + commissioner membership; return ids. */
async function seedLeague(
  db: Db,
  options: SeedLeagueOptions = {},
): Promise<{ leagueId: string; commissionerId: string }> {
  const {
    visibility = "public",
    status = "setup",
    maxPlayers = 8,
    extraMembers = 0,
  } = options;
  const commissionerId = await seedUser(db);
  const [league] = await db
    .insert(leagues)
    .values({
      name: "Public League",
      visibility,
      commissionerId,
      season: "SPRING",
      seasonYear: 2026,
      maxPlayers,
      status,
    })
    .returning({ id: leagues.id });
  if (!league) throw new Error("league insert failed");

  await db.insert(leagueMembers).values({
    leagueId: league.id,
    userId: commissionerId,
    role: "commissioner",
  });
  for (let i = 0; i < extraMembers; i++) {
    const memberId = await seedUser(db);
    await db
      .insert(leagueMembers)
      .values({ leagueId: league.id, userId: memberId, role: "player" });
  }

  return { leagueId: league.id, commissionerId };
}

describe("joinPublicLeague", () => {
  let db: Db;
  let dir: string;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "anidraft-joinpublic-"));
    db = createDb(`file:${join(dir, "test.db")}`);
    await applyMigrations(db);
    userSeq = 0;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("adds a fresh user as a player and returns joined", async () => {
    const { leagueId } = await seedLeague(db);
    const joiner = await seedUser(db);

    const result = await joinPublicLeague(db, joiner, leagueId);

    expect(result).toEqual({ status: "joined", leagueId });
    const [member] = await db
      .select()
      .from(leagueMembers)
      .where(
        and(
          eq(leagueMembers.leagueId, leagueId),
          eq(leagueMembers.userId, joiner),
        ),
      );
    expect(member?.role).toBe("player");
  });

  it("is idempotent: a second join returns already_member with no duplicate row", async () => {
    const { leagueId } = await seedLeague(db);
    const joiner = await seedUser(db);
    await joinPublicLeague(db, joiner, leagueId);

    const again = await joinPublicLeague(db, joiner, leagueId);

    expect(again).toEqual({ status: "already_member", leagueId });
    const rows = await db
      .select()
      .from(leagueMembers)
      .where(eq(leagueMembers.userId, joiner));
    expect(rows).toHaveLength(1);
  });

  it("treats the commissioner as already_member", async () => {
    const { leagueId, commissionerId } = await seedLeague(db);

    const result = await joinPublicLeague(db, commissionerId, leagueId);

    expect(result).toEqual({ status: "already_member", leagueId });
  });

  it("returns not_found for an unknown league id", async () => {
    const joiner = await seedUser(db);

    const result = await joinPublicLeague(db, joiner, "does-not-exist");

    expect(result).toEqual({ status: "not_found" });
  });

  it("returns not_found for a private league reached by id (no backdoor)", async () => {
    const { leagueId } = await seedLeague(db, { visibility: "private" });
    const joiner = await seedUser(db);

    const result = await joinPublicLeague(db, joiner, leagueId);

    expect(result).toEqual({ status: "not_found" });
    const rows = await db
      .select()
      .from(leagueMembers)
      .where(eq(leagueMembers.userId, joiner));
    expect(rows).toHaveLength(0);
  });

  it("returns wrong_state for a league past setup", async () => {
    const { leagueId } = await seedLeague(db, { status: "drafting" });
    const joiner = await seedUser(db);

    const result = await joinPublicLeague(db, joiner, leagueId);

    expect(result).toEqual({
      status: "wrong_state",
      leagueId,
      leagueStatus: "drafting",
    });
  });

  it("returns league_full when every seat is taken", async () => {
    // maxPlayers 2: commissioner + 1 extra = full.
    const { leagueId } = await seedLeague(db, {
      maxPlayers: 2,
      extraMembers: 1,
    });
    const joiner = await seedUser(db);

    const result = await joinPublicLeague(db, joiner, leagueId);

    expect(result).toEqual({ status: "league_full", leagueId });
  });

  it("lets a join succeed once a kicked member frees a seat", async () => {
    const { leagueId } = await seedLeague(db, {
      maxPlayers: 2,
      extraMembers: 1,
    });
    // Kick the extra player, freeing their seat.
    const [extra] = await db
      .select({ userId: leagueMembers.userId })
      .from(leagueMembers)
      .where(
        and(
          eq(leagueMembers.leagueId, leagueId),
          eq(leagueMembers.role, "player"),
        ),
      );
    await db
      .update(leagueMembers)
      .set({ kickedAt: new Date() })
      .where(
        and(
          eq(leagueMembers.leagueId, leagueId),
          eq(leagueMembers.userId, extra!.userId),
        ),
      );

    const joiner = await seedUser(db);
    const result = await joinPublicLeague(db, joiner, leagueId);

    expect(result).toEqual({ status: "joined", leagueId });
    const active = await db
      .select()
      .from(leagueMembers)
      .where(
        and(
          eq(leagueMembers.leagueId, leagueId),
          isNull(leagueMembers.kickedAt),
        ),
      );
    expect(active).toHaveLength(2); // commissioner + new joiner
  });
});
