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
import { joinLeagueSchema } from "@anidraft/shared";

import { createLeague, PUBLIC_PICK_TIMER_SECONDS } from "./createLeague";

/**
 * Unit tests for the create-league domain logic. Each test runs against a fresh
 * libsql database (a throwaway temp file) with the committed drizzle migrations
 * applied, so the inserts exercise the real schema (defaults, FKs, enum
 * columns) the way production will.
 *
 * A file — not `:memory:` — is deliberate: the libsql sqlite3 client opens a
 * brand-new connection after each `transaction()`, and a `:memory:` database is
 * per-connection, so post-transaction reads would hit an empty DB. A file is
 * shared across those connections. `createLeague` runs inside a transaction, so
 * this matters here.
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

describe("createLeague", () => {
  let db: Db;
  let commissionerId: string;
  let dir: string;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "anidraft-createleague-"));
    db = createDb(`file:${join(dir, "test.db")}`);
    await applyMigrations(db);
    commissionerId = crypto.randomUUID();
    await db
      .insert(users)
      .values({ id: commissionerId, email: "commish@anidraft.test" });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates a private league with a working invite code and commissioner", async () => {
    const result = await createLeague(db, commissionerId, {
      name: "Private Showdown",
      visibility: "private",
      maxPlayers: 8,
      seasonYear: 2026,
      season: "SPRING",
    });

    expect(result.leagueId).toBeTruthy();
    expect(result.inviteCode).not.toBeNull();
    // The generated code must satisfy the join flow's validator.
    expect(() =>
      joinLeagueSchema.parse({ inviteCode: result.inviteCode }),
    ).not.toThrow();

    const [league] = await db
      .select()
      .from(leagues)
      .where(eq(leagues.id, result.leagueId));
    expect(league?.visibility).toBe("private");
    expect(league?.status).toBe("setup");
    // Private leagues keep the schema default timer.
    expect(league?.pickTimerSeconds).toBe(60);

    const [member] = await db
      .select()
      .from(leagueMembers)
      .where(eq(leagueMembers.leagueId, result.leagueId));
    expect(member?.userId).toBe(commissionerId);
    expect(member?.role).toBe("commissioner");

    const invite = await db
      .select()
      .from(inviteCodes)
      .where(eq(inviteCodes.leagueId, result.leagueId));
    expect(invite).toHaveLength(1);
    expect(invite[0]?.code).toBe(result.inviteCode);
  });

  it("creates a public league with the forced timer and no invite code", async () => {
    const result = await createLeague(db, commissionerId, {
      name: "Public Lobby League",
      visibility: "public",
      maxPlayers: 6,
      seasonYear: 2026,
      season: "FALL",
    });

    expect(result.inviteCode).toBeNull();

    const [league] = await db
      .select()
      .from(leagues)
      .where(eq(leagues.id, result.leagueId));
    expect(league?.visibility).toBe("public");
    expect(league?.status).toBe("setup");
    expect(league?.pickTimerSeconds).toBe(PUBLIC_PICK_TIMER_SECONDS);

    const invite = await db
      .select()
      .from(inviteCodes)
      .where(eq(inviteCodes.leagueId, result.leagueId));
    expect(invite).toHaveLength(0);
  });

  it("persists an optional future draft-start time", async () => {
    const draftStartsAt = new Date(Date.now() + 7 * 86_400_000);
    const result = await createLeague(db, commissionerId, {
      name: "Scheduled League",
      visibility: "private",
      maxPlayers: 4,
      seasonYear: 2026,
      season: "SUMMER",
      draftStartsAt,
    });

    const [league] = await db
      .select()
      .from(leagues)
      .where(eq(leagues.id, result.leagueId));
    expect(league?.draftStartsAt?.getTime()).toBe(draftStartsAt.getTime());
  });
});
