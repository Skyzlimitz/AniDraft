import { describe, expect, it } from "vitest";
import {
  createLeagueSchema,
  joinLeagueSchema,
  generateInviteCode,
  calculateDraftSize,
  type League,
} from "@anidraft/shared";

/**
 * Integration test: the "create a league, then join it" flow.
 *
 * This exercises multiple pieces of `@anidraft/shared` working together —
 * the Zod validation schemas, the invite-code generator, and the draft-size
 * helper — the same way the real league-setup server action wires them up.
 */
describe("league lifecycle (shared schemas + utils)", () => {
  it("validates a well-formed create-league payload and derives the league", () => {
    const input = {
      name: "Spring Showdown",
      visibility: "private" as const,
      maxPlayers: 8,
      seasonYear: 2026,
      season: "SPRING" as const,
    };

    const parsed = createLeagueSchema.parse(input);
    const draftSize = calculateDraftSize(parsed.maxPlayers);

    // Build the domain object the way a server action would, then assert the
    // pieces line up across the validator and the draft-size helper.
    const league: Pick<
      League,
      | "name"
      | "visibility"
      | "maxPlayers"
      | "seasonYear"
      | "season"
      | "draftSize"
    > = {
      name: parsed.name,
      visibility: parsed.visibility,
      maxPlayers: parsed.maxPlayers,
      seasonYear: parsed.seasonYear,
      season: parsed.season,
      draftSize,
    };

    expect(league.name).toBe("Spring Showdown");
    expect(league.draftSize).toBe(6); // floor(50 / 8)
    expect(league.maxPlayers * league.draftSize).toBeLessThanOrEqual(50);
  });

  it("rejects create-league payloads that violate the schema", () => {
    expect(() =>
      createLeagueSchema.parse({
        name: "ab", // too short (min 3)
        visibility: "private",
        maxPlayers: 8,
        seasonYear: 2026,
        season: "SPRING",
      }),
    ).toThrow();

    expect(() =>
      createLeagueSchema.parse({
        name: "Valid Name",
        visibility: "secret", // not a valid enum value
        maxPlayers: 8,
        seasonYear: 2026,
        season: "SPRING",
      }),
    ).toThrow();

    expect(() =>
      createLeagueSchema.parse({
        name: "Valid Name",
        visibility: "public",
        maxPlayers: 99, // above max (16)
        seasonYear: 2026,
        season: "SPRING",
      }),
    ).toThrow();
  });

  it("generates invite codes that satisfy the join schema", () => {
    // The invite code produced at league creation must be accepted by the
    // join flow's validator — a contract that spans two modules.
    for (let i = 0; i < 50; i++) {
      const code = generateInviteCode();
      expect(code).toHaveLength(8);
      expect(() => joinLeagueSchema.parse({ inviteCode: code })).not.toThrow();
    }
  });

  it("only produces unambiguous invite-code characters", () => {
    const code = generateInviteCode();
    // No I/O/0/1 — these are excluded to avoid human confusion.
    expect(code).not.toMatch(/[IO01]/);
    expect(code).toMatch(/^[A-Z2-9]{8}$/);
  });

  it("scales draft size down as the league grows", () => {
    expect(calculateDraftSize(2)).toBe(25);
    expect(calculateDraftSize(5)).toBe(10);
    expect(calculateDraftSize(12)).toBe(4);
  });
});
