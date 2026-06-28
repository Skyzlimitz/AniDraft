import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  leagueMembers,
  leagues,
  users,
  createDb,
  type Db,
  type LeagueStatus,
} from "@anidraft/db";
import { type CreateLeagueInput } from "@anidraft/shared";

/**
 * Integration test for the public-lobby flow as `/lobbies` wires it up, across
 * `@anidraft/shared` (the league input contract) and `@anidraft/db` (the
 * leagues / members tables and their seat/visibility/status columns).
 *
 * `apps/web` is not a workspace dependency here, so this mirrors the same query
 * `listLobbies()` and the same join `joinPublicLeague()` perform — the lifecycle
 * filter (public + setup + free seat), newest-first order, and the code-free
 * id-keyed join — rather than importing them, validating they hold against the
 * real migrated schema.
 */

const MIGRATIONS = [
  "0000_true_nighthawk.sql",
  "0001_tough_talkback.sql",
  "0002_flashy_inhumans.sql",
  // 0003 adds the app-specific `user` columns; required because drizzle now
  // emits `created_at` (its $defaultFn) on every user INSERT.
  "0003_tense_masque.sql",
];

async function applyMigrations(db: Db): Promise<void> {
  await db.run("PRAGMA foreign_keys = ON");
  for (const file of MIGRATIONS) {
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

const activeMemberCount = sql<number>`count(${leagueMembers.userId}) filter (where ${leagueMembers.kickedAt} is null)`;

/** Mirrors `apps/web/lib/leagues/listLobbies.ts` (newest-first, free-seat only). */
async function listLobbies(db: Db) {
  const joinable = and(
    eq(leagues.visibility, "public"),
    eq(leagues.status, "setup"),
  );
  const hasFreeSeat = sql`${activeMemberCount} < ${leagues.maxPlayers}`;
  return db
    .select({
      id: leagues.id,
      name: leagues.name,
      memberCount: activeMemberCount,
      maxPlayers: leagues.maxPlayers,
      commissionerName: users.name,
    })
    .from(leagues)
    .leftJoin(leagueMembers, eq(leagueMembers.leagueId, leagues.id))
    .leftJoin(users, eq(users.id, leagues.commissionerId))
    .where(joinable)
    .groupBy(leagues.id)
    .having(hasFreeSeat)
    .orderBy(desc(leagues.createdAt));
}

/** Mirrors `apps/web/lib/leagues/joinPublicLeague.ts`. */
async function joinPublicLeague(db: Db, userId: string, leagueId: string) {
  const [league] = await db
    .select()
    .from(leagues)
    .where(eq(leagues.id, leagueId))
    .limit(1);
  if (!league || league.visibility !== "public") return { status: "not_found" };

  const [existing] = await db
    .select({ userId: leagueMembers.userId })
    .from(leagueMembers)
    .where(
      and(
        eq(leagueMembers.leagueId, league.id),
        eq(leagueMembers.userId, userId),
      ),
    )
    .limit(1);
  if (existing) return { status: "already_member", leagueId: league.id };

  if (league.status !== "setup") {
    return { status: "wrong_state", leagueId: league.id };
  }

  const active = await db
    .select({ userId: leagueMembers.userId })
    .from(leagueMembers)
    .where(
      and(eq(leagueMembers.leagueId, league.id), isNull(leagueMembers.kickedAt)),
    );
  if (active.length >= league.maxPlayers) {
    return { status: "league_full", leagueId: league.id };
  }

  await db
    .insert(leagueMembers)
    .values({ leagueId: league.id, userId, role: "player" });
  return { status: "joined", leagueId: league.id };
}

let userSeq = 0;
async function seedUser(db: Db, name: string | null = null): Promise<string> {
  const id = crypto.randomUUID();
  await db
    .insert(users)
    .values({ id, name, email: `user-${userSeq++}@anidraft.test` });
  return id;
}

/** Create a public league + commissioner membership using the shared input shape. */
async function createPublicLeague(
  db: Db,
  commissionerId: string,
  overrides: Partial<CreateLeagueInput> & {
    status?: LeagueStatus;
    createdAt?: Date;
  } = {},
): Promise<string> {
  const [league] = await db
    .insert(leagues)
    .values({
      name: overrides.name ?? "Public Lobby",
      visibility: "public",
      commissionerId,
      season: overrides.season ?? "SPRING",
      seasonYear: overrides.seasonYear ?? 2026,
      maxPlayers: overrides.maxPlayers ?? 8,
      status: overrides.status ?? "setup",
      ...(overrides.createdAt ? { createdAt: overrides.createdAt } : {}),
    })
    .returning({ id: leagues.id });
  if (!league) throw new Error("league insert failed");

  await db.insert(leagueMembers).values({
    leagueId: league.id,
    userId: commissionerId,
    role: "commissioner",
  });
  return league.id;
}

describe("public-lobby flow (shared schema + db)", () => {
  let db: Db;
  let commissionerId: string;

  beforeEach(async () => {
    db = createDb(":memory:");
    await applyMigrations(db);
    userSeq = 0;
    commissionerId = await seedUser(db, "Commish");
  });

  it("lists only joinable public leagues, newest-first, with commissioner names", async () => {
    await createPublicLeague(db, commissionerId, {
      name: "Older",
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });
    const newer = await createPublicLeague(db, commissionerId, {
      name: "Newer",
      createdAt: new Date("2026-02-01T00:00:00Z"),
    });
    // Excluded: private, non-setup, and full.
    await db.insert(leagues).values({
      name: "Private",
      visibility: "private",
      commissionerId,
      season: "SPRING",
      seasonYear: 2026,
      maxPlayers: 8,
      status: "setup",
    });
    await createPublicLeague(db, commissionerId, {
      name: "Drafting",
      status: "drafting",
    });

    const rows = await listLobbies(db);

    expect(rows.map((r) => r.name)).toEqual(["Newer", "Older"]);
    expect(rows[0]?.id).toBe(newer);
    expect(rows[0]?.commissionerName).toBe("Commish");
    expect(rows.every((r) => r.memberCount === 1)).toBe(true);
  });

  it("joins a public league by id and then drops it from the lobby once full", async () => {
    const leagueId = await createPublicLeague(db, commissionerId, {
      maxPlayers: 2, // commissioner + 1 join = full
    });

    const before = await listLobbies(db);
    expect(before.map((r) => r.id)).toContain(leagueId);

    const joiner = await seedUser(db, "Joiner");
    const result = await joinPublicLeague(db, joiner, leagueId);
    expect(result).toEqual({ status: "joined", leagueId });

    // That join filled the last seat, so the lobby no longer lists it.
    const after = await listLobbies(db);
    expect(after.map((r) => r.id)).not.toContain(leagueId);
  });

  it("refuses to join a private league by id (no lobby backdoor)", async () => {
    const [priv] = await db
      .insert(leagues)
      .values({
        name: "Private",
        visibility: "private",
        commissionerId,
        season: "SPRING",
        seasonYear: 2026,
        maxPlayers: 8,
        status: "setup",
      })
      .returning({ id: leagues.id });
    const joiner = await seedUser(db);

    const result = await joinPublicLeague(db, joiner, priv!.id);

    expect(result).toEqual({ status: "not_found" });
  });
});
