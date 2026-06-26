import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  inviteCodes,
  leagueMembers,
  leagues,
  users,
  createDb,
  type Db,
  type LeagueStatus,
} from "@anidraft/db";

import { listLobbies, LOBBY_PAGE_SIZE } from "./listLobbies";

/**
 * Unit tests for the lobby-listing query. Like the sibling league tests, each
 * runs against a fresh libsql file database with the committed drizzle
 * migrations applied, so the GROUP BY / HAVING seat math, enum columns, and the
 * commissioner join all exercise the real schema. A file (not `:memory:`) is
 * used for parity with the other suites, though `listLobbies` itself doesn't run
 * in a transaction.
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

let userSeq = 0;
async function seedUser(db: Db, name: string | null = null): Promise<string> {
  const id = crypto.randomUUID();
  await db
    .insert(users)
    .values({ id, name, email: `user-${userSeq++}@anidraft.test` });
  return id;
}

interface SeedLeagueOptions {
  name?: string;
  visibility?: "public" | "private";
  status?: LeagueStatus;
  maxPlayers?: number;
  /** Extra (beyond the commissioner) active player members to add. */
  extraMembers?: number;
  /** Members to add and immediately mark kicked (should not count as seats). */
  kickedMembers?: number;
  season?: "WINTER" | "SPRING" | "SUMMER" | "FALL";
  seasonYear?: number;
  draftStartsAt?: Date | null;
  createdAt?: Date;
  commissionerId?: string;
}

/** Seed a league + its commissioner membership; return the league id. */
async function seedLeague(
  db: Db,
  options: SeedLeagueOptions = {},
): Promise<string> {
  const {
    name = "Lobby League",
    visibility = "public",
    status = "setup",
    maxPlayers = 8,
    extraMembers = 0,
    kickedMembers = 0,
    season = "SPRING",
    seasonYear = 2026,
    draftStartsAt = null,
    createdAt,
    commissionerId,
  } = options;

  const commish = commissionerId ?? (await seedUser(db, "Commish"));
  const [league] = await db
    .insert(leagues)
    .values({
      name,
      visibility,
      commissionerId: commish,
      season,
      seasonYear,
      maxPlayers,
      draftStartsAt,
      status,
      ...(createdAt ? { createdAt } : {}),
    })
    .returning({ id: leagues.id });
  if (!league) throw new Error("league insert failed");

  await db.insert(leagueMembers).values({
    leagueId: league.id,
    userId: commish,
    role: "commissioner",
  });

  for (let i = 0; i < extraMembers; i++) {
    const memberId = await seedUser(db);
    await db
      .insert(leagueMembers)
      .values({ leagueId: league.id, userId: memberId, role: "player" });
  }
  for (let i = 0; i < kickedMembers; i++) {
    const memberId = await seedUser(db);
    await db.insert(leagueMembers).values({
      leagueId: league.id,
      userId: memberId,
      role: "player",
      kickedAt: new Date(),
    });
  }

  return league.id;
}

describe("listLobbies", () => {
  let db: Db;
  let dir: string;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "anidraft-lobbies-"));
    db = createDb(`file:${join(dir, "test.db")}`);
    await applyMigrations(db);
    userSeq = 0;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns an empty, well-formed page when there are no lobbies", async () => {
    const result = await listLobbies(db);
    expect(result).toEqual({
      lobbies: [],
      total: 0,
      page: 1,
      pageSize: LOBBY_PAGE_SIZE,
      totalPages: 1,
    });
  });

  it("lists only public, setup, not-full leagues", async () => {
    const open = await seedLeague(db, { name: "Open Public" });
    // Excluded for each of the three lifecycle reasons:
    await seedLeague(db, { name: "Private", visibility: "private" });
    await seedLeague(db, { name: "Drafting", status: "drafting" });
    await seedLeague(db, {
      name: "Full",
      maxPlayers: 4,
      extraMembers: 3, // commissioner + 3 = 4 = maxPlayers
    });

    const result = await listLobbies(db);

    expect(result.total).toBe(1);
    expect(result.lobbies.map((l) => l.id)).toEqual([open]);
    expect(result.lobbies[0]?.name).toBe("Open Public");
  });

  it("counts active members and ignores kicked ones for the seat check", async () => {
    // 4 seats: commissioner + 3 active = full -> excluded.
    await seedLeague(db, { name: "Full", maxPlayers: 4, extraMembers: 3 });
    // 4 seats: commissioner + 3 active + 2 kicked -> still 4 active = full.
    await seedLeague(db, {
      name: "Full w/ kicked",
      maxPlayers: 4,
      extraMembers: 3,
      kickedMembers: 2,
    });
    // 4 seats: commissioner + 2 active + 5 kicked = 3 active < 4 -> listed,
    // and the reported count excludes the kicked members.
    const open = await seedLeague(db, {
      name: "Has room",
      maxPlayers: 4,
      extraMembers: 2,
      kickedMembers: 5,
    });

    const result = await listLobbies(db);

    expect(result.lobbies.map((l) => l.id)).toEqual([open]);
    expect(result.lobbies[0]?.memberCount).toBe(3);
    expect(result.lobbies[0]?.maxPlayers).toBe(4);
  });

  it("orders newest-first and exposes commissioner name + fields", async () => {
    const commish = await seedUser(db, "Ada Lovelace");
    const draftStartsAt = new Date("2026-07-01T18:00:00.000Z");
    await seedLeague(db, {
      name: "Older",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    const newer = await seedLeague(db, {
      name: "Newer",
      commissionerId: commish,
      draftStartsAt,
      season: "FALL",
      seasonYear: 2027,
      createdAt: new Date("2026-02-01T00:00:00.000Z"),
    });

    const result = await listLobbies(db);

    expect(result.lobbies.map((l) => l.name)).toEqual(["Newer", "Older"]);
    const top = result.lobbies[0];
    expect(top?.id).toBe(newer);
    expect(top?.commissionerName).toBe("Ada Lovelace");
    expect(top?.season).toBe("FALL");
    expect(top?.seasonYear).toBe(2027);
    expect(top?.draftStartsAt?.getTime()).toBe(draftStartsAt.getTime());
    expect(top?.viewerIsMember).toBe(false);
  });

  it("paginates with offset and reports totals", async () => {
    // 5 lobbies, page size 2 -> 3 pages.
    for (let i = 0; i < 5; i++) {
      await seedLeague(db, {
        name: `L${i}`,
        createdAt: new Date(2026, 0, i + 1),
      });
    }

    const page1 = await listLobbies(db, { page: 1, pageSize: 2 });
    expect(page1.total).toBe(5);
    expect(page1.totalPages).toBe(3);
    expect(page1.lobbies).toHaveLength(2);
    expect(page1.lobbies.map((l) => l.name)).toEqual(["L4", "L3"]);

    const page3 = await listLobbies(db, { page: 3, pageSize: 2 });
    expect(page3.lobbies.map((l) => l.name)).toEqual(["L0"]);

    // Out-of-range / non-positive pages are clamped, not errored.
    const clamped = await listLobbies(db, { page: 0, pageSize: 2 });
    expect(clamped.page).toBe(1);
    expect(clamped.lobbies.map((l) => l.name)).toEqual(["L4", "L3"]);
  });

  it("flags lobbies the viewer already belongs to", async () => {
    const viewer = await seedUser(db, "Viewer");
    const mine = await seedLeague(db, {
      name: "Mine",
      commissionerId: viewer,
    });
    const theirs = await seedLeague(db, { name: "Theirs" });

    const result = await listLobbies(db, { viewerId: viewer });

    const byId = new Map(result.lobbies.map((l) => [l.id, l]));
    expect(byId.get(mine)?.viewerIsMember).toBe(true);
    expect(byId.get(theirs)?.viewerIsMember).toBe(false);
  });

  it("ignores invite codes (public leagues have none) and never lists private", async () => {
    // A stray invite code on a public league must not change anything.
    const pub = await seedLeague(db, { name: "Public" });
    await db.insert(inviteCodes).values({ code: "PUBCODE1", leagueId: pub });

    const result = await listLobbies(db);
    expect(result.lobbies.map((l) => l.id)).toEqual([pub]);
  });
});
