import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createDb,
  leagueMembers,
  leagues,
  users,
  type Db,
  type LeagueStatus,
} from "@anidraft/db";

import {
  editableFieldsFor,
  updateLeagueSettings,
} from "./updateLeagueSettings";

/**
 * Unit tests for the update-league-settings domain logic. Each test runs
 * against a fresh libsql database (a throwaway temp file) with the committed
 * drizzle migrations applied, so the reads/writes exercise the real schema —
 * including the `pick_timer_seconds` default and the enum columns — the way
 * production will.
 *
 * A file (not `:memory:`) is deliberate, matching `createLeague.test.ts`: the
 * libsql client opens a new connection after each `transaction()`, and a
 * `:memory:` database is per-connection, so post-transaction reads would hit an
 * empty DB. `updateLeagueSettings` runs inside a transaction.
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

describe("editableFieldsFor", () => {
  it("opens every field in setup", () => {
    expect(editableFieldsFor("setup")).toEqual([
      "name",
      "maxPlayers",
      "pickTimerSeconds",
      "draftStartsAt",
    ]);
  });

  it("allows only draftStartsAt once finalized", () => {
    expect(editableFieldsFor("finalized")).toEqual(["draftStartsAt"]);
  });

  it("freezes settings once drafting or later", () => {
    for (const status of ["drafting", "in_season", "completed"] as const) {
      expect(editableFieldsFor(status)).toEqual([]);
    }
  });
});

describe("updateLeagueSettings", () => {
  let db: Db;
  let commissionerId: string;
  let outsiderId: string;
  let dir: string;

  /** Insert a league + commissioner membership, returning the league id. */
  async function seedLeague(overrides?: {
    status?: LeagueStatus;
    maxPlayers?: number;
    visibility?: "public" | "private";
  }): Promise<string> {
    const [league] = await db
      .insert(leagues)
      .values({
        name: "Original Name",
        visibility: overrides?.visibility ?? "private",
        commissionerId,
        season: "SPRING",
        seasonYear: 2026,
        maxPlayers: overrides?.maxPlayers ?? 8,
        status: overrides?.status ?? "setup",
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
    dir = mkdtempSync(join(tmpdir(), "anidraft-updatesettings-"));
    db = createDb(`file:${join(dir, "test.db")}`);
    await applyMigrations(db);
    commissionerId = crypto.randomUUID();
    outsiderId = crypto.randomUUID();
    await db.insert(users).values([
      { id: commissionerId, email: "commish@anidraft.test" },
      { id: outsiderId, email: "outsider@anidraft.test" },
    ]);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("lets the commissioner edit every field in setup", async () => {
    const leagueId = await seedLeague();
    const future = new Date(Date.now() + 86_400_000);

    const result = await updateLeagueSettings(db, leagueId, commissionerId, {
      name: "Renamed Showdown",
      maxPlayers: 12,
      pickTimerSeconds: 120,
      draftStartsAt: future,
    });

    expect(result.status).toBe("updated");
    if (result.status !== "updated") throw new Error("expected updated");
    expect(result.league.name).toBe("Renamed Showdown");
    expect(result.league.maxPlayers).toBe(12);
    expect(result.league.pickTimerSeconds).toBe(120);
    expect(result.league.draftStartsAt?.getTime()).toBe(future.getTime());

    const [row] = await db
      .select()
      .from(leagues)
      .where(eq(leagues.id, leagueId));
    expect(row?.name).toBe("Renamed Showdown");
    expect(row?.pickTimerSeconds).toBe(120);
  });

  it("returns forbidden for a non-commissioner", async () => {
    const leagueId = await seedLeague();

    const result = await updateLeagueSettings(db, leagueId, outsiderId, {
      name: "Hijacked",
    });

    expect(result.status).toBe("forbidden");
    const [row] = await db
      .select()
      .from(leagues)
      .where(eq(leagues.id, leagueId));
    expect(row?.name).toBe("Original Name");
  });

  it("returns not_found for an unknown league", async () => {
    const result = await updateLeagueSettings(
      db,
      crypto.randomUUID(),
      commissionerId,
      { name: "Ghost League" },
    );
    expect(result.status).toBe("not_found");
  });

  it("allows only draftStartsAt once finalized", async () => {
    const leagueId = await seedLeague({ status: "finalized" });
    const future = new Date(Date.now() + 86_400_000);

    const ok = await updateLeagueSettings(db, leagueId, commissionerId, {
      draftStartsAt: future,
    });
    expect(ok.status).toBe("updated");

    const locked = await updateLeagueSettings(db, leagueId, commissionerId, {
      name: "Too late to rename",
    });
    expect(locked.status).toBe("locked");
    if (locked.status === "locked") {
      expect(locked.editableFields).toEqual(["draftStartsAt"]);
      expect(locked.leagueStatus).toBe("finalized");
    }
  });

  it("freezes all settings once drafting", async () => {
    const leagueId = await seedLeague({ status: "drafting" });

    const result = await updateLeagueSettings(db, leagueId, commissionerId, {
      draftStartsAt: new Date(Date.now() + 86_400_000),
    });
    expect(result.status).toBe("locked");
    if (result.status === "locked") {
      expect(result.editableFields).toEqual([]);
    }
  });

  it("rejects maxPlayers below the current member count", async () => {
    const leagueId = await seedLeague({ maxPlayers: 8 });
    // Add two more active members → 3 total (commissioner + 2).
    await db.insert(leagueMembers).values([
      { leagueId, userId: outsiderId, role: "player" },
      {
        leagueId,
        userId: (
          await db
            .insert(users)
            .values({ id: crypto.randomUUID(), email: "p3@anidraft.test" })
            .returning({ id: users.id })
        )[0]!.id,
        role: "player",
      },
    ]);

    const result = await updateLeagueSettings(db, leagueId, commissionerId, {
      maxPlayers: 2,
    });
    expect(result.status).toBe("invalid_max_players");
    if (result.status === "invalid_max_players") {
      expect(result.memberCount).toBe(3);
    }
  });

  it("allows maxPlayers exactly at the member-count floor", async () => {
    const leagueId = await seedLeague({ maxPlayers: 8 });
    // Only the commissioner is a member → floor is 1.
    const result = await updateLeagueSettings(db, leagueId, commissionerId, {
      maxPlayers: 4,
    });
    expect(result.status).toBe("updated");
  });

  it("locks all settings on a public league regardless of state", async () => {
    const leagueId = await seedLeague({ visibility: "public" });
    const result = await updateLeagueSettings(db, leagueId, commissionerId, {
      name: "Try to rename a public league",
    });
    expect(result.status).toBe("locked");
    if (result.status === "locked") {
      expect(result.editableFields).toEqual([]);
    }
  });

  it("clears the draft schedule when draftStartsAt is null", async () => {
    const leagueId = await seedLeague();
    await updateLeagueSettings(db, leagueId, commissionerId, {
      draftStartsAt: new Date(Date.now() + 86_400_000),
    });

    const result = await updateLeagueSettings(db, leagueId, commissionerId, {
      draftStartsAt: null,
    });
    expect(result.status).toBe("updated");
    if (result.status === "updated") {
      expect(result.league.draftStartsAt).toBeNull();
    }
  });
});
