import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  leagueMembers,
  leagues,
  users,
  type Db,
  type LeagueStatus,
} from "@anidraft/db";
import { createMigratedDb } from "@anidraft/db/testing";

import { kickPlayer } from "./kickPlayer";

/**
 * Unit tests for the kick-player domain logic. Each test runs against a fresh
 * migrated libsql database (a throwaway temp file, matching the other league
 * tests — `kickPlayer` runs inside a transaction and `:memory:` is
 * per-connection), so the soft-delete write hits the real schema.
 */

describe("kickPlayer", () => {
  let db: Db;
  let commissionerId: string;
  let playerId: string;
  let outsiderId: string;
  let dir: string;

  async function seedLeague(
    overrides: {
      visibility?: "public" | "private";
      status?: LeagueStatus;
    } = {},
  ): Promise<string> {
    const [league] = await db
      .insert(leagues)
      .values({
        name: "Test League",
        visibility: overrides.visibility ?? "private",
        status: overrides.status ?? "setup",
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

  async function activeMemberIds(leagueId: string): Promise<string[]> {
    const rows = await db
      .select({
        userId: leagueMembers.userId,
        kickedAt: leagueMembers.kickedAt,
      })
      .from(leagueMembers)
      .where(eq(leagueMembers.leagueId, leagueId));
    return rows.filter((r) => r.kickedAt === null).map((r) => r.userId);
  }

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "anidraft-kick-"));
    db = await createMigratedDb(`file:${join(dir, "test.db")}`);
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

  it("kicks a player during setup and soft-deletes the membership", async () => {
    const leagueId = await seedLeague();
    const now = new Date("2026-06-01T00:00:00Z");

    const result = await kickPlayer(
      db,
      leagueId,
      commissionerId,
      playerId,
      now,
    );

    expect(result).toEqual({ status: "kicked", userId: playerId });
    // Active roster no longer includes the player...
    expect(await activeMemberIds(leagueId)).toEqual([commissionerId]);
    // ...but the row survives with a kickedAt stamp (soft delete).
    const [row] = await db
      .select({ kickedAt: leagueMembers.kickedAt })
      .from(leagueMembers)
      .where(
        and(
          eq(leagueMembers.leagueId, leagueId),
          eq(leagueMembers.userId, playerId),
        ),
      );
    expect(row?.kickedAt).toEqual(now);
  });

  it("returns not_found for an unknown league", async () => {
    const result = await kickPlayer(
      db,
      crypto.randomUUID(),
      commissionerId,
      playerId,
    );
    expect(result).toEqual({ status: "not_found" });
  });

  it("forbids a non-commissioner from kicking", async () => {
    const leagueId = await seedLeague();
    const result = await kickPlayer(db, leagueId, playerId, commissionerId);
    expect(result).toEqual({ status: "forbidden" });
    expect(await activeMemberIds(leagueId)).toContain(commissionerId);
  });

  it("forbids kicking from a public lobby", async () => {
    const leagueId = await seedLeague({ visibility: "public" });
    const result = await kickPlayer(db, leagueId, commissionerId, playerId);
    expect(result).toEqual({ status: "public_forbidden" });
    expect(await activeMemberIds(leagueId)).toContain(playerId);
  });

  it("blocks a kick once the league is finalized", async () => {
    const leagueId = await seedLeague({ status: "finalized" });
    const result = await kickPlayer(db, leagueId, commissionerId, playerId);
    expect(result).toEqual({ status: "locked", leagueStatus: "finalized" });
    expect(await activeMemberIds(leagueId)).toContain(playerId);
  });

  it("blocks a commissioner from kicking themselves", async () => {
    const leagueId = await seedLeague();
    const result = await kickPlayer(
      db,
      leagueId,
      commissionerId,
      commissionerId,
    );
    expect(result).toEqual({ status: "self_kick" });
    expect(await activeMemberIds(leagueId)).toContain(commissionerId);
  });

  it("returns member_not_found for a user who isn't a member", async () => {
    const leagueId = await seedLeague();
    const result = await kickPlayer(db, leagueId, commissionerId, outsiderId);
    expect(result).toEqual({ status: "member_not_found" });
  });

  it("returns member_not_found when the player is already kicked", async () => {
    const leagueId = await seedLeague();
    await kickPlayer(db, leagueId, commissionerId, playerId);

    const second = await kickPlayer(db, leagueId, commissionerId, playerId);
    expect(second).toEqual({ status: "member_not_found" });
  });
});
