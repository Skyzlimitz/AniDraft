import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, leagueMembers, leagues, users, type Db } from "@anidraft/db";

import { getLeagueSettings } from "./getLeagueSettings";

/**
 * Unit tests for the settings read-model the commissioner settings page uses.
 * Runs against a fresh migrated libsql database; a temp file (not `:memory:`)
 * keeps it consistent with the other league tests.
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

describe("getLeagueSettings", () => {
  let db: Db;
  let commissionerId: string;
  let playerId: string;
  let outsiderId: string;
  let dir: string;

  async function seedLeague(): Promise<string> {
    const [league] = await db
      .insert(leagues)
      .values({
        name: "Test League",
        visibility: "private",
        commissionerId,
        season: "SPRING",
        seasonYear: 2026,
        maxPlayers: 8,
      })
      .returning({ id: leagues.id });
    await db.insert(leagueMembers).values([
      { leagueId: league!.id, userId: commissionerId, role: "commissioner" },
      { leagueId: league!.id, userId: playerId, role: "player" },
    ]);
    return league!.id;
  }

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "anidraft-getsettings-"));
    db = createDb(`file:${join(dir, "test.db")}`);
    await applyMigrations(db);
    commissionerId = crypto.randomUUID();
    playerId = crypto.randomUUID();
    outsiderId = crypto.randomUUID();
    await db.insert(users).values([
      { id: commissionerId, email: "commish@anidraft.test" },
      { id: playerId, email: "player@anidraft.test" },
      { id: outsiderId, email: "outsider@anidraft.test" },
    ]);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns the view with isCommissioner=true for the commissioner", async () => {
    const leagueId = await seedLeague();
    const access = await getLeagueSettings(db, leagueId, commissionerId);
    expect(access).not.toBeNull();
    expect(access?.isCommissioner).toBe(true);
    expect(access?.isMember).toBe(true);
    expect(access?.league.name).toBe("Test League");
    expect(access?.league.memberCount).toBe(2);
    expect(access?.league.pickTimerSeconds).toBe(60);
  });

  it("flags a player as a member but not the commissioner", async () => {
    const leagueId = await seedLeague();
    const access = await getLeagueSettings(db, leagueId, playerId);
    expect(access?.isCommissioner).toBe(false);
    expect(access?.isMember).toBe(true);
  });

  it("flags an outsider as neither member nor commissioner", async () => {
    const leagueId = await seedLeague();
    const access = await getLeagueSettings(db, leagueId, outsiderId);
    expect(access?.isCommissioner).toBe(false);
    expect(access?.isMember).toBe(false);
  });

  it("returns null for an unknown league", async () => {
    const access = await getLeagueSettings(
      db,
      crypto.randomUUID(),
      commissionerId,
    );
    expect(access).toBeNull();
  });
});
