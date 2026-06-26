import { describe, expect, it } from "vitest";

import {
  MAX_LEAGUE_PLAYERS,
  MIN_LEAGUE_PLAYERS,
  createLeagueSchema,
  joinLeagueSchema,
} from "./index.js";

/**
 * Unit tests for the user-input Zod schemas. These guard the validation
 * contract the create-league API route and the join flow rely on, including
 * the player-count bounds and the optional future-only draft start time.
 */
describe("createLeagueSchema", () => {
  const base = {
    name: "Spring Showdown",
    visibility: "private" as const,
    maxPlayers: 8,
    seasonYear: 2026,
    season: "SPRING" as const,
  };

  it("accepts a well-formed payload without a draft start", () => {
    const parsed = createLeagueSchema.parse(base);
    expect(parsed.maxPlayers).toBe(8);
    expect(parsed.draftStartsAt).toBeUndefined();
  });

  it("coerces an ISO draft-start string into a Date", () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const parsed = createLeagueSchema.parse({ ...base, draftStartsAt: future });
    expect(parsed.draftStartsAt).toBeInstanceOf(Date);
    expect(parsed.draftStartsAt?.toISOString()).toBe(future);
  });

  it("rejects a draft start in the past", () => {
    const past = new Date(Date.now() - 86_400_000).toISOString();
    expect(() =>
      createLeagueSchema.parse({ ...base, draftStartsAt: past }),
    ).toThrow();
  });

  it("rejects a name shorter than 3 characters", () => {
    expect(() => createLeagueSchema.parse({ ...base, name: "ab" })).toThrow();
  });

  it("rejects an unknown visibility", () => {
    expect(() =>
      createLeagueSchema.parse({ ...base, visibility: "secret" }),
    ).toThrow();
  });

  it("enforces the player-count bounds", () => {
    expect(
      createLeagueSchema.parse({ ...base, maxPlayers: MIN_LEAGUE_PLAYERS })
        .maxPlayers,
    ).toBe(MIN_LEAGUE_PLAYERS);
    expect(
      createLeagueSchema.parse({ ...base, maxPlayers: MAX_LEAGUE_PLAYERS })
        .maxPlayers,
    ).toBe(MAX_LEAGUE_PLAYERS);

    expect(() =>
      createLeagueSchema.parse({ ...base, maxPlayers: MIN_LEAGUE_PLAYERS - 1 }),
    ).toThrow();
    expect(() =>
      createLeagueSchema.parse({ ...base, maxPlayers: MAX_LEAGUE_PLAYERS + 1 }),
    ).toThrow();
  });

  it("rejects a season year outside the supported window", () => {
    expect(() =>
      createLeagueSchema.parse({ ...base, seasonYear: 2019 }),
    ).toThrow();
    expect(() =>
      createLeagueSchema.parse({ ...base, seasonYear: 2031 }),
    ).toThrow();
  });
});

describe("joinLeagueSchema", () => {
  it("accepts an 8-character invite code", () => {
    expect(joinLeagueSchema.parse({ inviteCode: "ABCD2345" }).inviteCode).toBe(
      "ABCD2345",
    );
  });

  it("rejects an invite code of the wrong length", () => {
    expect(() => joinLeagueSchema.parse({ inviteCode: "ABC" })).toThrow();
  });

  it("normalizes case and surrounding whitespace before validating", () => {
    expect(
      joinLeagueSchema.parse({ inviteCode: "  join2345  " }).inviteCode,
    ).toBe("JOIN2345");
  });

  it("applies the length check after trimming, not before", () => {
    // Padding that would pass a naive length(8) on the raw string must still be
    // rejected once trimmed down to its real length.
    expect(() => joinLeagueSchema.parse({ inviteCode: "  ABC   " })).toThrow();
  });
});
