import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createDb,
  inviteCodes,
  leagueMembers,
  leagues,
  users,
  type Db,
} from "@anidraft/db";
import {
  createLeagueSchema,
  generateInviteCode,
  joinLeagueSchema,
} from "@anidraft/shared";

/**
 * Integration test: the create-league flow as the `POST /api/leagues` route
 * wires it up, across `@anidraft/shared` (the create/join Zod schemas + invite
 * generator) and `@anidraft/db` (the leagues / members / invite_codes tables).
 *
 * `apps/web` is not a workspace dependency here, so this mirrors the same steps
 * the web app's `createLeague()` performs rather than importing it: validate the
 * payload, then persist the league, the commissioner membership, and — for a
 * private league — a unique invite code, against the real migrated schema.
 */

const MIGRATIONS = [
  "0000_true_nighthawk.sql",
  "0001_tough_talkback.sql",
  "0002_flashy_inhumans.sql",
  // 0003 adds the app-specific `user` columns; required because drizzle now
  // emits `created_at` (its $defaultFn) on every user INSERT.
  "0003_tense_masque.sql",
];

/** Mirrors `apps/web/lib/leagues/createLeague.ts`. */
const PUBLIC_PICK_TIMER_SECONDS = 90;

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

/** Validate + persist a league the way the create-league route does. */
async function createLeague(
  db: Db,
  commissionerId: string,
  rawInput: unknown,
): Promise<{ leagueId: string; inviteCode: string | null }> {
  const input = createLeagueSchema.parse(rawInput);
  const isPublic = input.visibility === "public";

  const [league] = await db
    .insert(leagues)
    .values({
      name: input.name,
      visibility: input.visibility,
      commissionerId,
      season: input.season,
      seasonYear: input.seasonYear,
      maxPlayers: input.maxPlayers,
      ...(isPublic ? { pickTimerSeconds: PUBLIC_PICK_TIMER_SECONDS } : {}),
      draftStartsAt: input.draftStartsAt ?? null,
    })
    .returning({ id: leagues.id });
  if (!league) throw new Error("insert failed");

  await db.insert(leagueMembers).values({
    leagueId: league.id,
    userId: commissionerId,
    role: "commissioner",
  });

  let inviteCode: string | null = null;
  if (!isPublic) {
    inviteCode = generateInviteCode();
    await db.insert(inviteCodes).values({ code: inviteCode, leagueId: league.id });
  }

  return { leagueId: league.id, inviteCode };
}

describe("create-league flow (shared schema + db)", () => {
  let db: Db;
  let commissionerId: string;

  beforeEach(async () => {
    db = createDb(":memory:");
    await applyMigrations(db);
    commissionerId = crypto.randomUUID();
    await db
      .insert(users)
      .values({ id: commissionerId, email: "commish@anidraft.test" });
  });

  it("creates a private league with a joinable invite code, commissioner, and setup status", async () => {
    const { leagueId, inviteCode } = await createLeague(db, commissionerId, {
      name: "Private Showdown",
      visibility: "private",
      maxPlayers: 8,
      seasonYear: 2026,
      season: "SPRING",
    });

    // The invite code the create flow produced must satisfy the join validator.
    expect(inviteCode).not.toBeNull();
    expect(() =>
      joinLeagueSchema.parse({ inviteCode }),
    ).not.toThrow();

    const [league] = await db
      .select()
      .from(leagues)
      .where(eq(leagues.id, leagueId));
    expect(league?.status).toBe("setup");
    expect(league?.visibility).toBe("private");
    expect(league?.pickTimerSeconds).toBe(60); // schema default

    const [member] = await db
      .select()
      .from(leagueMembers)
      .where(eq(leagueMembers.leagueId, leagueId));
    expect(member?.userId).toBe(commissionerId);
    expect(member?.role).toBe("commissioner");

    const [invite] = await db
      .select()
      .from(inviteCodes)
      .where(eq(inviteCodes.leagueId, leagueId));
    expect(invite?.code).toBe(inviteCode);
  });

  it("creates a public league with the forced timer and no invite code", async () => {
    const { leagueId, inviteCode } = await createLeague(db, commissionerId, {
      name: "Public Lobby League",
      visibility: "public",
      maxPlayers: 6,
      seasonYear: 2026,
      season: "FALL",
    });

    expect(inviteCode).toBeNull();

    const [league] = await db
      .select()
      .from(leagues)
      .where(eq(leagues.id, leagueId));
    expect(league?.visibility).toBe("public");
    expect(league?.pickTimerSeconds).toBe(PUBLIC_PICK_TIMER_SECONDS);

    const invites = await db
      .select()
      .from(inviteCodes)
      .where(eq(inviteCodes.leagueId, leagueId));
    expect(invites).toHaveLength(0);
  });

  it("rejects a payload that fails create-league validation", async () => {
    await expect(
      createLeague(db, commissionerId, {
        name: "x", // too short
        visibility: "private",
        maxPlayers: 8,
        seasonYear: 2026,
        season: "SPRING",
      }),
    ).rejects.toThrow();
  });
});
