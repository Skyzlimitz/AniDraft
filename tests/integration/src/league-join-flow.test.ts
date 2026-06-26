import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { and, eq, isNull } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createDb,
  inviteCodes,
  leagueMembers,
  leagues,
  users,
  type Db,
  type LeagueStatus,
} from "@anidraft/db";
import {
  generateInviteCode,
  joinLeagueSchema,
  type CreateLeagueInput,
} from "@anidraft/shared";

/**
 * Integration test: the join-league flow as the `/join/[code]` page and
 * `POST /api/leagues/join` route wire it up, across `@anidraft/shared` (the join
 * Zod schema + invite generator) and `@anidraft/db` (the leagues / members /
 * invite_codes tables).
 *
 * `apps/web` is not a workspace dependency here, so this mirrors the same steps
 * the web app's `joinLeague()` performs rather than importing it: validate the
 * code, then look up the invite, guard on membership / expiry / state / capacity
 * against the real migrated schema, and insert a `player` membership.
 */

const MIGRATIONS = ["0000_true_nighthawk.sql", "0001_tough_talkback.sql"];

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

type JoinResult =
  | { status: "joined"; leagueId: string }
  | { status: "already_member"; leagueId: string }
  | { status: "invalid_code" }
  | { status: "expired" }
  | { status: "wrong_state"; leagueId: string; leagueStatus: LeagueStatus }
  | { status: "league_full"; leagueId: string };

/** Mirrors `apps/web/lib/leagues/joinLeague.ts`. */
async function joinLeague(
  db: Db,
  userId: string,
  rawCode: string,
): Promise<JoinResult> {
  const { inviteCode } = joinLeagueSchema.parse({ inviteCode: rawCode });

  const [invite] = await db
    .select()
    .from(inviteCodes)
    .where(eq(inviteCodes.code, inviteCode))
    .limit(1);
  if (!invite) return { status: "invalid_code" };

  const [league] = await db
    .select()
    .from(leagues)
    .where(eq(leagues.id, invite.leagueId))
    .limit(1);
  if (!league) return { status: "invalid_code" };

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

  if (invite.maxUses !== null && invite.uses >= invite.maxUses) {
    return { status: "expired" };
  }

  if (league.status !== "setup") {
    return {
      status: "wrong_state",
      leagueId: league.id,
      leagueStatus: league.status,
    };
  }

  const active = await db
    .select({ userId: leagueMembers.userId })
    .from(leagueMembers)
    .where(
      and(
        eq(leagueMembers.leagueId, league.id),
        isNull(leagueMembers.kickedAt),
      ),
    );
  if (active.length >= league.maxPlayers) {
    return { status: "league_full", leagueId: league.id };
  }

  await db
    .insert(leagueMembers)
    .values({ leagueId: league.id, userId, role: "player" });
  await db
    .update(inviteCodes)
    .set({ uses: invite.uses + 1 })
    .where(eq(inviteCodes.code, inviteCode));

  return { status: "joined", leagueId: league.id };
}

/** Create a private league + commissioner + invite code, returning the ids. */
async function createPrivateLeague(
  db: Db,
  commissionerId: string,
  overrides: Partial<CreateLeagueInput> & { status?: LeagueStatus } = {},
): Promise<{ leagueId: string; code: string }> {
  const [league] = await db
    .insert(leagues)
    .values({
      name: overrides.name ?? "Private Showdown",
      visibility: "private",
      commissionerId,
      season: overrides.season ?? "SPRING",
      seasonYear: overrides.seasonYear ?? 2026,
      maxPlayers: overrides.maxPlayers ?? 4,
      status: overrides.status ?? "setup",
    })
    .returning({ id: leagues.id });
  if (!league) throw new Error("league insert failed");

  await db.insert(leagueMembers).values({
    leagueId: league.id,
    userId: commissionerId,
    role: "commissioner",
  });

  const code = generateInviteCode();
  await db.insert(inviteCodes).values({ code, leagueId: league.id });

  return { leagueId: league.id, code };
}

async function seedUser(db: Db, email: string): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(users).values({ id, email });
  return id;
}

describe("join-league flow (shared schema + db)", () => {
  let db: Db;
  let commissionerId: string;

  beforeEach(async () => {
    db = createDb(":memory:");
    await applyMigrations(db);
    commissionerId = await seedUser(db, "commish@anidraft.test");
  });

  it("lets a fresh user join a setup league with a valid code", async () => {
    const { leagueId, code } = await createPrivateLeague(db, commissionerId);
    const joinerId = await seedUser(db, "joiner@anidraft.test");

    const result = await joinLeague(db, joinerId, code);

    expect(result).toEqual({ status: "joined", leagueId });

    const members = await db
      .select()
      .from(leagueMembers)
      .where(eq(leagueMembers.leagueId, leagueId));
    expect(members).toHaveLength(2); // commissioner + joiner
    expect(members.find((m) => m.userId === joinerId)?.role).toBe("player");
  });

  it("reports already_member on a second join and does not duplicate the row", async () => {
    const { leagueId, code } = await createPrivateLeague(db, commissionerId);
    const joinerId = await seedUser(db, "joiner@anidraft.test");
    await joinLeague(db, joinerId, code);

    const again = await joinLeague(db, joinerId, code);

    expect(again).toEqual({ status: "already_member", leagueId });
    const rows = await db
      .select()
      .from(leagueMembers)
      .where(eq(leagueMembers.userId, joinerId));
    expect(rows).toHaveLength(1);
  });

  it("rejects joining a league that has left setup", async () => {
    const { leagueId, code } = await createPrivateLeague(db, commissionerId, {
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

  it("rejects joining a full league", async () => {
    const { leagueId, code } = await createPrivateLeague(db, commissionerId, {
      maxPlayers: 2,
    });
    const firstJoiner = await seedUser(db, "first@anidraft.test");
    await joinLeague(db, firstJoiner, code); // fills the 2nd of 2 seats

    const secondJoiner = await seedUser(db, "second@anidraft.test");
    const result = await joinLeague(db, secondJoiner, code);

    expect(result).toEqual({ status: "league_full", leagueId });
  });

  it("rejects an unknown invite code", async () => {
    await createPrivateLeague(db, commissionerId);
    const joinerId = await seedUser(db, "joiner@anidraft.test");

    const result = await joinLeague(db, joinerId, "ZZZZ2345");

    expect(result).toEqual({ status: "invalid_code" });
  });
});
