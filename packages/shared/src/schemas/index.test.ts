import { describe, expect, it } from "vitest";

import {
  MAX_LEAGUE_PLAYERS,
  MAX_PICK_TIMER_SECONDS,
  MIN_LEAGUE_PLAYERS,
  MIN_PICK_TIMER_SECONDS,
  createLeagueSchema,
  joinLeagueSchema,
  joinPublicLeagueSchema,
  updateLeagueSettingsSchema,
  updatePoolOverridesSchema,
  MAX_POOL_ADDITIONS,
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

describe("joinPublicLeagueSchema", () => {
  it("accepts a non-empty league id and trims surrounding whitespace", () => {
    expect(
      joinPublicLeagueSchema.parse({ leagueId: "  league-uuid  " }).leagueId,
    ).toBe("league-uuid");
  });

  it("rejects an empty league id", () => {
    expect(() => joinPublicLeagueSchema.parse({ leagueId: "" })).toThrow();
  });

  it("rejects a whitespace-only league id", () => {
    expect(() => joinPublicLeagueSchema.parse({ leagueId: "   " })).toThrow();
  });

  it("rejects a missing league id", () => {
    expect(() => joinPublicLeagueSchema.parse({})).toThrow();
  });
});

describe("updateLeagueSettingsSchema", () => {
  it("accepts a partial update of a single field", () => {
    const parsed = updateLeagueSettingsSchema.parse({ name: "Renamed League" });
    expect(parsed).toEqual({ name: "Renamed League" });
  });

  it("accepts every editable field together", () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const parsed = updateLeagueSettingsSchema.parse({
      name: "Spring Showdown",
      maxPlayers: 10,
      pickTimerSeconds: 120,
      draftStartsAt: future,
    });
    expect(parsed.maxPlayers).toBe(10);
    expect(parsed.pickTimerSeconds).toBe(120);
    expect(parsed.draftStartsAt).toBeInstanceOf(Date);
  });

  it("rejects an empty update with no fields", () => {
    expect(() => updateLeagueSettingsSchema.parse({})).toThrow();
  });

  it("enforces the pick-timer bounds", () => {
    expect(
      updateLeagueSettingsSchema.parse({
        pickTimerSeconds: MIN_PICK_TIMER_SECONDS,
      }).pickTimerSeconds,
    ).toBe(MIN_PICK_TIMER_SECONDS);
    expect(
      updateLeagueSettingsSchema.parse({
        pickTimerSeconds: MAX_PICK_TIMER_SECONDS,
      }).pickTimerSeconds,
    ).toBe(MAX_PICK_TIMER_SECONDS);

    expect(() =>
      updateLeagueSettingsSchema.parse({
        pickTimerSeconds: MIN_PICK_TIMER_SECONDS - 1,
      }),
    ).toThrow();
    expect(() =>
      updateLeagueSettingsSchema.parse({
        pickTimerSeconds: MAX_PICK_TIMER_SECONDS + 1,
      }),
    ).toThrow();
  });

  it("enforces the player-count bounds", () => {
    expect(() =>
      updateLeagueSettingsSchema.parse({ maxPlayers: MIN_LEAGUE_PLAYERS - 1 }),
    ).toThrow();
    expect(() =>
      updateLeagueSettingsSchema.parse({ maxPlayers: MAX_LEAGUE_PLAYERS + 1 }),
    ).toThrow();
  });

  it("rejects a draft start in the past", () => {
    const past = new Date(Date.now() - 86_400_000).toISOString();
    expect(() =>
      updateLeagueSettingsSchema.parse({ draftStartsAt: past }),
    ).toThrow();
  });

  it("allows clearing the draft start with null", () => {
    const parsed = updateLeagueSettingsSchema.parse({ draftStartsAt: null });
    expect(parsed.draftStartsAt).toBeNull();
  });
});

describe("updatePoolOverridesSchema", () => {
  it("defaults both arrays to empty for a {} body", () => {
    const parsed = updatePoolOverridesSchema.parse({});
    expect(parsed.exclusions).toEqual([]);
    expect(parsed.additions).toEqual([]);
  });

  it("accepts exclusions and additions, defaulting a missing cover to null", () => {
    const parsed = updatePoolOverridesSchema.parse({
      exclusions: [1, 2],
      additions: [{ anilistId: 99, title: "Added" }],
    });
    expect(parsed.exclusions).toEqual([1, 2]);
    expect(parsed.additions[0]).toEqual({
      anilistId: 99,
      title: "Added",
      coverImage: null,
    });
  });

  it("rejects a non-integer exclusion id", () => {
    expect(() =>
      updatePoolOverridesSchema.parse({ exclusions: [1.5] }),
    ).toThrow();
  });

  it("rejects an addition with an empty title", () => {
    expect(() =>
      updatePoolOverridesSchema.parse({
        additions: [{ anilistId: 1, title: "" }],
      }),
    ).toThrow();
  });

  it("rejects an addition cover image that isn't a URL", () => {
    expect(() =>
      updatePoolOverridesSchema.parse({
        additions: [{ anilistId: 1, title: "X", coverImage: "not-a-url" }],
      }),
    ).toThrow();
  });

  it("rejects more additions than the cap", () => {
    const additions = Array.from({ length: MAX_POOL_ADDITIONS + 1 }, (_, i) => ({
      anilistId: i + 1,
      title: `Show ${i}`,
    }));
    expect(() => updatePoolOverridesSchema.parse({ additions })).toThrow();
  });
});
