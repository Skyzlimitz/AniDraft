import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createDb,
  leagues,
  poolOverrides,
  users,
  type Db,
  type LeagueStatus,
} from "@anidraft/db";

import {
  getPoolEditor,
  searchPoolCandidates,
  updatePoolOverrides,
  type PoolShow,
  type SeasonPoolFetcher,
} from "./poolEditor";

/**
 * Unit tests for the pool-editor domain logic (issue #36). Runs against a fresh
 * migrated libsql database (temp file, matching the other league tests). The
 * AniList fetch/search are injected as plain fakes — no network.
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
      new URL(`../../../../packages/db/drizzle/${file}`, import.meta.url),
    );
    const sql = readFileSync(path, "utf8");
    for (const statement of sql.split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (trimmed) await db.run(trimmed);
    }
  }
}

const AUTO_POOL: PoolShow[] = [
  { anilistId: 1, title: "Alpha", coverImage: "https://img/1.jpg" },
  { anilistId: 2, title: "Beta", coverImage: null },
  { anilistId: 3, title: "Gamma", coverImage: "https://img/3.jpg" },
];

const fakeFetcher: SeasonPoolFetcher = async () => AUTO_POOL;

describe("pool editor domain logic", () => {
  let db: Db;
  let commissionerId: string;
  let outsiderId: string;
  let dir: string;

  async function seedLeague(opts?: {
    visibility?: "public" | "private";
    status?: LeagueStatus;
  }): Promise<string> {
    const [league] = await db
      .insert(leagues)
      .values({
        name: "Pool League",
        visibility: opts?.visibility ?? "private",
        status: opts?.status ?? "setup",
        commissionerId,
        season: "SPRING",
        seasonYear: 2026,
        maxPlayers: 8,
      })
      .returning({ id: leagues.id });
    return league!.id;
  }

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "anidraft-pool-"));
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

  describe("getPoolEditor", () => {
    it("returns not_found for an unknown league", async () => {
      const result = await getPoolEditor(
        db,
        crypto.randomUUID(),
        commissionerId,
        fakeFetcher,
      );
      expect(result.status).toBe("not_found");
    });

    it("returns forbidden for a non-commissioner", async () => {
      const leagueId = await seedLeague();
      const result = await getPoolEditor(
        db,
        leagueId,
        outsiderId,
        fakeFetcher,
      );
      expect(result.status).toBe("forbidden");
    });

    it("returns public_unsupported for a public lobby", async () => {
      const leagueId = await seedLeague({ visibility: "public" });
      const result = await getPoolEditor(
        db,
        leagueId,
        commissionerId,
        fakeFetcher,
      );
      expect(result.status).toBe("public_unsupported");
    });

    it("returns the auto pool with no overrides as all-included", async () => {
      const leagueId = await seedLeague();
      const result = await getPoolEditor(
        db,
        leagueId,
        commissionerId,
        fakeFetcher,
      );
      expect(result.status).toBe("ok");
      if (result.status !== "ok") return;
      expect(result.view.frozen).toBe(false);
      expect(result.view.entries).toHaveLength(3);
      expect(result.view.entries.every((e) => e.source === "auto")).toBe(true);
      expect(result.view.entries.every((e) => !e.excluded)).toBe(true);
    });

    it("marks excluded auto shows and appends manual additions", async () => {
      const leagueId = await seedLeague();
      await db.insert(poolOverrides).values([
        { leagueId, anilistId: 2, kind: "exclusion" },
        {
          leagueId,
          anilistId: 99,
          kind: "addition",
          title: "Manual Pick",
          coverImage: "https://img/99.jpg",
        },
      ]);

      const result = await getPoolEditor(
        db,
        leagueId,
        commissionerId,
        fakeFetcher,
      );
      if (result.status !== "ok") throw new Error("expected ok");

      const beta = result.view.entries.find((e) => e.anilistId === 2);
      expect(beta?.excluded).toBe(true);
      const manual = result.view.entries.find((e) => e.anilistId === 99);
      expect(manual).toMatchObject({
        source: "manual",
        title: "Manual Pick",
        excluded: false,
      });
    });

    it("drops a manual addition the season fetch now returns on its own", async () => {
      const leagueId = await seedLeague();
      // anilistId 3 is already in AUTO_POOL; a stale addition for it is redundant.
      await db.insert(poolOverrides).values({
        leagueId,
        anilistId: 3,
        kind: "addition",
        title: "Stale Dup",
      });

      const result = await getPoolEditor(
        db,
        leagueId,
        commissionerId,
        fakeFetcher,
      );
      if (result.status !== "ok") throw new Error("expected ok");
      const matches = result.view.entries.filter((e) => e.anilistId === 3);
      expect(matches).toHaveLength(1);
      expect(matches[0]!.source).toBe("auto");
    });

    it("reports frozen once the league is finalized", async () => {
      const leagueId = await seedLeague({ status: "finalized" });
      const result = await getPoolEditor(
        db,
        leagueId,
        commissionerId,
        fakeFetcher,
      );
      if (result.status !== "ok") throw new Error("expected ok");
      expect(result.view.frozen).toBe(true);
    });
  });

  describe("updatePoolOverrides", () => {
    it("persists exclusions and additions, replacing prior overrides", async () => {
      const leagueId = await seedLeague();

      const first = await updatePoolOverrides(db, leagueId, commissionerId, {
        exclusions: [1],
        additions: [{ anilistId: 50, title: "Added", coverImage: null }],
      });
      expect(first.status).toBe("saved");

      let rows = await db
        .select()
        .from(poolOverrides)
        .where(eq(poolOverrides.leagueId, leagueId));
      expect(rows).toHaveLength(2);

      // Second save replaces the set wholesale: only the new exclusion remains.
      const second = await updatePoolOverrides(db, leagueId, commissionerId, {
        exclusions: [2],
        additions: [],
      });
      expect(second.status).toBe("saved");

      rows = await db
        .select()
        .from(poolOverrides)
        .where(eq(poolOverrides.leagueId, leagueId));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ anilistId: 2, kind: "exclusion" });
    });

    it("dedupes and lets additions win over a same-id exclusion", async () => {
      const leagueId = await seedLeague();
      const result = await updatePoolOverrides(db, leagueId, commissionerId, {
        exclusions: [7, 7, 8],
        additions: [{ anilistId: 8, title: "Wins", coverImage: null }],
      });
      expect(result).toMatchObject({
        status: "saved",
        exclusionCount: 1,
        additionCount: 1,
      });

      const rows = await db
        .select()
        .from(poolOverrides)
        .where(eq(poolOverrides.leagueId, leagueId));
      const kinds = rows.map((r) => `${r.kind}:${r.anilistId}`).sort();
      expect(kinds).toEqual(["addition:8", "exclusion:7"]);
    });

    it("rejects a non-commissioner with forbidden", async () => {
      const leagueId = await seedLeague();
      const result = await updatePoolOverrides(db, leagueId, outsiderId, {
        exclusions: [1],
        additions: [],
      });
      expect(result.status).toBe("forbidden");
    });

    it("rejects a public lobby with public_unsupported", async () => {
      const leagueId = await seedLeague({ visibility: "public" });
      const result = await updatePoolOverrides(db, leagueId, commissionerId, {
        exclusions: [1],
        additions: [],
      });
      expect(result.status).toBe("public_unsupported");
    });

    it("returns not_found for an unknown league", async () => {
      const result = await updatePoolOverrides(
        db,
        crypto.randomUUID(),
        commissionerId,
        { exclusions: [], additions: [] },
      );
      expect(result.status).toBe("not_found");
    });

    it("freezes overrides once the league is finalized", async () => {
      const leagueId = await seedLeague({ status: "finalized" });
      const result = await updatePoolOverrides(db, leagueId, commissionerId, {
        exclusions: [1],
        additions: [],
      });
      expect(result).toMatchObject({
        status: "frozen",
        leagueStatus: "finalized",
      });
      const rows = await db
        .select()
        .from(poolOverrides)
        .where(eq(poolOverrides.leagueId, leagueId));
      expect(rows).toHaveLength(0);
    });
  });

  describe("searchPoolCandidates", () => {
    const search = async (query: string): Promise<PoolShow[]> => [
      { anilistId: 500, title: `Result for ${query}`, coverImage: null },
    ];

    it("returns results for the commissioner of a private league", async () => {
      const leagueId = await seedLeague();
      const result = await searchPoolCandidates(
        db,
        leagueId,
        commissionerId,
        "naruto",
        search,
      );
      expect(result.status).toBe("ok");
      if (result.status !== "ok") return;
      expect(result.results[0]?.title).toBe("Result for naruto");
    });

    it("gates search behind the same private-commissioner rule", async () => {
      const leagueId = await seedLeague({ visibility: "public" });
      const result = await searchPoolCandidates(
        db,
        leagueId,
        commissionerId,
        "x",
        search,
      );
      expect(result.status).toBe("public_unsupported");
    });
  });
});
