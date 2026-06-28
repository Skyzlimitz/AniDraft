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
  poolOverrides,
  users,
  type Db,
  type LeagueStatus,
} from "@anidraft/db";

import {
  collectPreconditionFailures,
  finalizeLeague,
  preconditionMessage,
} from "./finalizeLeague";
import type { PoolShow, SeasonPoolFetcher } from "./poolEditor";

/**
 * Unit tests for the finalize-league domain logic (issue #37). Runs against a
 * fresh migrated libsql database (a throwaway temp file, matching the other
 * league tests — `finalizeLeague` runs inside a transaction and `:memory:` is
 * per-connection). The AniList season fetch is injected as a plain fake.
 */

const MIGRATIONS = [
  "0000_true_nighthawk.sql",
  "0001_tough_talkback.sql",
  "0002_flashy_inhumans.sql",
];

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

// A generous default pool, larger than any roster we seed, so the pool-size
// precondition passes unless a test deliberately shrinks it.
const FULL_POOL: PoolShow[] = Array.from({ length: 10 }, (_, i) => ({
  anilistId: i + 1,
  title: `Show ${i + 1}`,
  coverImage: null,
}));
const fakeFetcher: SeasonPoolFetcher = async () => FULL_POOL;

const NOW = new Date("2026-06-28T00:00:00Z");
const FUTURE = new Date("2026-07-01T00:00:00Z");
const PAST = new Date("2026-06-01T00:00:00Z");

describe("finalizeLeague", () => {
  let db: Db;
  let commissionerId: string;
  let playerId: string;
  let outsiderId: string;
  let dir: string;

  /** Seed a league plus its commissioner + N-1 extra active members. */
  async function seedLeague(
    overrides: {
      visibility?: "public" | "private";
      status?: LeagueStatus;
      draftStartsAt?: Date | null;
      extraMembers?: number;
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
        draftStartsAt:
          overrides.draftStartsAt === undefined
            ? FUTURE
            : overrides.draftStartsAt,
      })
      .returning({ id: leagues.id });

    const members: {
      leagueId: string;
      userId: string;
      role: "commissioner" | "player";
    }[] = [
      {
        leagueId: league!.id,
        userId: commissionerId,
        role: "commissioner",
      },
    ];
    // Default to one extra member (so the league has 2 total — the finalize floor).
    const extras = overrides.extraMembers ?? 1;
    if (extras >= 1) {
      members.push({ leagueId: league!.id, userId: playerId, role: "player" });
    }
    await db.insert(leagueMembers).values(members);
    return league!.id;
  }

  async function statusOf(leagueId: string): Promise<LeagueStatus> {
    const [row] = await db
      .select({ status: leagues.status })
      .from(leagues)
      .where(eq(leagues.id, leagueId));
    return row!.status;
  }

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "anidraft-finalize-"));
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

  it("finalizes a ready league and stamps finalizedAt", async () => {
    const leagueId = await seedLeague();

    const result = await finalizeLeague(
      db,
      leagueId,
      commissionerId,
      fakeFetcher,
      NOW,
    );

    expect(result.status).toBe("finalized");
    if (result.status === "finalized") {
      expect(result.league.status).toBe("finalized");
      expect(result.league.finalizedAt).toEqual(NOW);
      expect(result.league.memberCount).toBe(2);
    }
    expect(await statusOf(leagueId)).toBe("finalized");

    const [row] = await db
      .select({ finalizedAt: leagues.finalizedAt })
      .from(leagues)
      .where(eq(leagues.id, leagueId));
    expect(row?.finalizedAt).toEqual(NOW);
  });

  it("finalizes a ready public lobby (no overrides, raw season pool)", async () => {
    const leagueId = await seedLeague({ visibility: "public" });
    const result = await finalizeLeague(
      db,
      leagueId,
      commissionerId,
      fakeFetcher,
      NOW,
    );
    expect(result.status).toBe("finalized");
    expect(await statusOf(leagueId)).toBe("finalized");
  });

  it("returns not_found for an unknown league", async () => {
    const result = await finalizeLeague(
      db,
      crypto.randomUUID(),
      commissionerId,
      fakeFetcher,
      NOW,
    );
    expect(result).toEqual({ status: "not_found" });
  });

  it("forbids a non-commissioner from finalizing", async () => {
    const leagueId = await seedLeague();
    const result = await finalizeLeague(
      db,
      leagueId,
      playerId,
      fakeFetcher,
      NOW,
    );
    expect(result).toEqual({ status: "forbidden" });
    expect(await statusOf(leagueId)).toBe("setup");
  });

  it("is idempotent: a second finalize returns already_finalized, not an error", async () => {
    const leagueId = await seedLeague();
    const first = await finalizeLeague(
      db,
      leagueId,
      commissionerId,
      fakeFetcher,
      NOW,
    );
    expect(first.status).toBe("finalized");

    const second = await finalizeLeague(
      db,
      leagueId,
      commissionerId,
      fakeFetcher,
      new Date("2026-06-29T00:00:00Z"),
    );
    expect(second.status).toBe("already_finalized");
    if (second.status === "already_finalized") {
      // The original finalizedAt stamp is preserved — the no-op didn't rewrite it.
      expect(second.league.finalizedAt).toEqual(NOW);
    }
    expect(await statusOf(leagueId)).toBe("finalized");
  });

  it("rejects finalizing a league already past setup (drafting)", async () => {
    const leagueId = await seedLeague({ status: "drafting" });
    const result = await finalizeLeague(
      db,
      leagueId,
      commissionerId,
      fakeFetcher,
      NOW,
    );
    expect(result).toEqual({
      status: "invalid_state",
      leagueStatus: "drafting",
    });
    expect(await statusOf(leagueId)).toBe("drafting");
  });

  it("fails when the league has too few members", async () => {
    const leagueId = await seedLeague({ extraMembers: 0 });
    const result = await finalizeLeague(
      db,
      leagueId,
      commissionerId,
      fakeFetcher,
      NOW,
    );
    expect(result.status).toBe("preconditions_failed");
    if (result.status === "preconditions_failed") {
      expect(result.failures).toContainEqual({
        code: "too_few_members",
        required: 2,
        actual: 1,
      });
    }
    expect(await statusOf(leagueId)).toBe("setup");
  });

  it("fails when the pool is smaller than the player count", async () => {
    const leagueId = await seedLeague();
    // Two members, but the season pool only has one show.
    const tinyFetcher: SeasonPoolFetcher = async () => [FULL_POOL[0]!];
    const result = await finalizeLeague(
      db,
      leagueId,
      commissionerId,
      tinyFetcher,
      NOW,
    );
    expect(result.status).toBe("preconditions_failed");
    if (result.status === "preconditions_failed") {
      expect(result.failures).toContainEqual({
        code: "pool_too_small",
        required: 2,
        actual: 1,
      });
    }
    expect(await statusOf(leagueId)).toBe("setup");
  });

  it("counts exclusions and additions when sizing the pool", async () => {
    const leagueId = await seedLeague();
    // Exclude two of the ten auto shows, add one manual show the fetch misses →
    // effective pool = 10 - 2 + 1 = 9, still ≥ 2 members, so finalize succeeds.
    await db.insert(poolOverrides).values([
      {
        leagueId,
        anilistId: 1,
        kind: "exclusion",
        title: null,
        coverImage: null,
      },
      {
        leagueId,
        anilistId: 2,
        kind: "exclusion",
        title: null,
        coverImage: null,
      },
      {
        leagueId,
        anilistId: 999,
        kind: "addition",
        title: "Extra",
        coverImage: null,
      },
    ]);

    const result = await finalizeLeague(
      db,
      leagueId,
      commissionerId,
      fakeFetcher,
      NOW,
    );
    expect(result.status).toBe("finalized");
  });

  it("fails when the draft start time is unset", async () => {
    const leagueId = await seedLeague({ draftStartsAt: null });
    const result = await finalizeLeague(
      db,
      leagueId,
      commissionerId,
      fakeFetcher,
      NOW,
    );
    expect(result.status).toBe("preconditions_failed");
    if (result.status === "preconditions_failed") {
      expect(result.failures).toContainEqual({ code: "draft_start_missing" });
    }
    expect(await statusOf(leagueId)).toBe("setup");
  });

  it("skips the season-pool fetch when a network-free precondition already fails", async () => {
    // No draft time → not ready for a reason we know without the pool. The
    // fetcher must never run, so make it throw if it does.
    const leagueId = await seedLeague({ draftStartsAt: null });
    const throwingFetcher: SeasonPoolFetcher = async () => {
      throw new Error("AniList should not be called");
    };

    const result = await finalizeLeague(
      db,
      leagueId,
      commissionerId,
      throwingFetcher,
      NOW,
    );

    expect(result.status).toBe("preconditions_failed");
    if (result.status === "preconditions_failed") {
      expect(result.failures).toContainEqual({ code: "draft_start_missing" });
      // The pool was never sized, so no pool failure is reported.
      expect(result.failures.some((f) => f.code === "pool_too_small")).toBe(
        false,
      );
    }
  });

  it("fails when the draft start time is in the past", async () => {
    const leagueId = await seedLeague({ draftStartsAt: PAST });
    const result = await finalizeLeague(
      db,
      leagueId,
      commissionerId,
      fakeFetcher,
      NOW,
    );
    expect(result.status).toBe("preconditions_failed");
    if (result.status === "preconditions_failed") {
      expect(result.failures).toContainEqual({
        code: "draft_start_in_past",
        draftStartsAt: PAST,
      });
    }
    expect(await statusOf(leagueId)).toBe("setup");
  });

  it("reports every failed precondition at once", async () => {
    // No extra members AND no draft time: both preconditions fail together.
    const leagueId = await seedLeague({ extraMembers: 0, draftStartsAt: null });
    const result = await finalizeLeague(
      db,
      leagueId,
      commissionerId,
      fakeFetcher,
      NOW,
    );
    expect(result.status).toBe("preconditions_failed");
    if (result.status === "preconditions_failed") {
      const codes = result.failures.map((f) => f.code).sort();
      expect(codes).toEqual(["draft_start_missing", "too_few_members"]);
    }
  });
});

describe("collectPreconditionFailures", () => {
  const NOW = new Date("2026-06-28T00:00:00Z");

  it("returns no failures when every condition holds", () => {
    expect(
      collectPreconditionFailures({
        memberCount: 4,
        poolSize: 10,
        draftStartsAt: new Date("2026-07-01T00:00:00Z"),
        now: NOW,
      }),
    ).toEqual([]);
  });

  it("flags a draft start exactly at `now` as in the past (not strictly future)", () => {
    const failures = collectPreconditionFailures({
      memberCount: 4,
      poolSize: 10,
      draftStartsAt: NOW,
      now: NOW,
    });
    expect(failures).toEqual([
      { code: "draft_start_in_past", draftStartsAt: NOW },
    ]);
  });
});

describe("preconditionMessage", () => {
  it("renders a clear message for each failure code", () => {
    expect(
      preconditionMessage({ code: "too_few_members", required: 2, actual: 1 }),
    ).toContain("at least 2 members");
    expect(
      preconditionMessage({ code: "pool_too_small", required: 4, actual: 2 }),
    ).toContain("one per player");
    expect(preconditionMessage({ code: "draft_start_missing" })).toContain(
      "draft start time",
    );
    expect(
      preconditionMessage({
        code: "draft_start_in_past",
        draftStartsAt: new Date(),
      }),
    ).toContain("future");
  });
});
