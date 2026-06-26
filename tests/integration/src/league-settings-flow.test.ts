import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { and, eq, isNull, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createDb,
  leagueMembers,
  leagues,
  users,
  type Db,
  type LeagueStatus,
} from "@anidraft/db";
import {
  MAX_PICK_TIMER_SECONDS,
  updateLeagueSettingsSchema,
} from "@anidraft/shared";

/**
 * Integration test: the edit-league-settings flow as `PATCH /api/leagues/[id]`
 * wires it up, across `@anidraft/shared` (the partial-update Zod schema) and
 * `@anidraft/db` (the leagues / league_members tables).
 *
 * `apps/web` is not a workspace dependency here, so this mirrors the same steps
 * the route's `updateLeagueSettings()` performs rather than importing it:
 * validate the body, enforce the state + member-count rules, then persist —
 * against the real migrated schema, including the `pick_timer_seconds` column.
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

/** Which fields are editable from a status — mirrors `editableFieldsFor`. */
function editableFieldsFor(status: LeagueStatus): string[] {
  if (status === "setup")
    return ["name", "maxPlayers", "pickTimerSeconds", "draftStartsAt"];
  if (status === "finalized") return ["draftStartsAt"];
  return [];
}

/** Validate + apply a settings patch the way the update route does. */
async function updateSettings(
  db: Db,
  leagueId: string,
  userId: string,
  rawInput: unknown,
): Promise<{ status: string }> {
  const input = updateLeagueSettingsSchema.parse(rawInput);

  const [league] = await db
    .select()
    .from(leagues)
    .where(eq(leagues.id, leagueId));
  if (!league) return { status: "not_found" };
  if (league.commissionerId !== userId) return { status: "forbidden" };

  const editable =
    league.visibility === "public" ? [] : editableFieldsFor(league.status);
  const requested = Object.keys(input);
  if (requested.some((field) => !editable.includes(field))) {
    return { status: "locked" };
  }

  const memberRows = await db
    .select({ count: sql<number>`count(*)`.mapWith(Number) })
    .from(leagueMembers)
    .where(
      and(eq(leagueMembers.leagueId, leagueId), isNull(leagueMembers.kickedAt)),
    );
  const memberCount = memberRows[0]?.count ?? 0;
  if (input.maxPlayers !== undefined && input.maxPlayers < memberCount) {
    return { status: "invalid_max_players" };
  }

  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.maxPlayers !== undefined) patch.maxPlayers = input.maxPlayers;
  if (input.pickTimerSeconds !== undefined)
    patch.pickTimerSeconds = input.pickTimerSeconds;
  if ("draftStartsAt" in input)
    patch.draftStartsAt = input.draftStartsAt ?? null;

  await db.update(leagues).set(patch).where(eq(leagues.id, leagueId));
  return { status: "updated" };
}

describe("edit-league-settings flow (shared schema + db)", () => {
  let db: Db;
  let commissionerId: string;
  let outsiderId: string;

  async function seedLeague(status: LeagueStatus = "setup"): Promise<string> {
    const [league] = await db
      .insert(leagues)
      .values({
        name: "Original",
        visibility: "private",
        commissionerId,
        season: "SPRING",
        seasonYear: 2026,
        maxPlayers: 8,
        status,
      })
      .returning({ id: leagues.id });
    await db.insert(leagueMembers).values({
      leagueId: league!.id,
      userId: commissionerId,
      role: "commissioner",
    });
    return league!.id;
  }

  beforeEach(async () => {
    db = createDb(":memory:");
    await applyMigrations(db);
    commissionerId = crypto.randomUUID();
    outsiderId = crypto.randomUUID();
    await db.insert(users).values([
      { id: commissionerId, email: "commish@anidraft.test" },
      { id: outsiderId, email: "outsider@anidraft.test" },
    ]);
  });

  it("persists a full settings edit during setup", async () => {
    const leagueId = await seedLeague("setup");
    const result = await updateSettings(db, leagueId, commissionerId, {
      name: "Renamed",
      maxPlayers: 12,
      pickTimerSeconds: MAX_PICK_TIMER_SECONDS,
    });
    expect(result.status).toBe("updated");

    const [row] = await db
      .select()
      .from(leagues)
      .where(eq(leagues.id, leagueId));
    expect(row?.name).toBe("Renamed");
    expect(row?.maxPlayers).toBe(12);
    expect(row?.pickTimerSeconds).toBe(MAX_PICK_TIMER_SECONDS);
  });

  it("rejects a non-commissioner edit", async () => {
    const leagueId = await seedLeague("setup");
    const result = await updateSettings(db, leagueId, outsiderId, {
      name: "Hijack",
    });
    expect(result.status).toBe("forbidden");
  });

  it("locks everything but draftStartsAt after finalize", async () => {
    const leagueId = await seedLeague("finalized");

    const rename = await updateSettings(db, leagueId, commissionerId, {
      name: "Too late",
    });
    expect(rename.status).toBe("locked");

    const reschedule = await updateSettings(db, leagueId, commissionerId, {
      draftStartsAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(reschedule.status).toBe("updated");
  });

  it("rejects an out-of-range pick timer at the schema boundary", async () => {
    const leagueId = await seedLeague("setup");
    await expect(
      updateSettings(db, leagueId, commissionerId, { pickTimerSeconds: 10 }),
    ).rejects.toThrow();
  });
});
