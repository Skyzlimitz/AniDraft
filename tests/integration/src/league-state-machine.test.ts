import { describe, expect, it } from "vitest";
import {
  INITIAL_LEAGUE_STATE,
  LeagueTransitionError,
  calculateDraftSize,
  createLeagueSchema,
  transition,
  type LeagueState,
} from "@anidraft/shared";

/**
 * Integration test: the full league lifecycle as the app will drive it.
 *
 * This walks a league from a validated create-league payload all the way to
 * `completed`, wiring together the `@anidraft/shared` pieces a real flow would:
 * the create-league Zod schema, the draft-size helper, and the league state
 * machine. The README calls out state machines / end-to-end flows as a
 * boundary that requires an integration test.
 */
describe("league lifecycle state machine (shared)", () => {
  it("drives a validated league from setup to completed", () => {
    const input = createLeagueSchema.parse({
      name: "Summer Sprint",
      visibility: "private" as const,
      maxPlayers: 6,
      seasonYear: 2026,
      season: "SUMMER" as const,
    });
    const draftSize = calculateDraftSize(input.maxPlayers);

    let state: LeagueState = INITIAL_LEAGUE_STATE;
    expect(state.status).toBe("setup");

    // Commissioner finalizes once the league is full and configured.
    state = transition(state, {
      type: "FINALIZE",
      byCommissioner: true,
      startConditionsMet: input.maxPlayers >= 2 && draftSize > 0,
    });
    expect(state.status).toBe("finalized");

    // The scheduled draft window opens.
    state = transition(state, {
      type: "START_DRAFT",
      now: new Date("2026-07-01T18:00:00Z"),
      draftStartTime: new Date("2026-07-01T18:00:00Z"),
    });
    expect(state.status).toBe("drafting");

    // Every roster slot across the league is filled.
    const totalPicks = input.maxPlayers * draftSize;
    state = transition(state, {
      type: "COMPLETE_DRAFT",
      allPicksMade: totalPicks > 0,
    });
    expect(state.status).toBe("in_season");

    // The final-week snapshot lands and the season ends.
    state = transition(state, {
      type: "END_SEASON",
      finalSnapshotDone: true,
    });
    expect(state.status).toBe("completed");
  });

  it("blocks finalize until the league meets its start conditions", () => {
    // A 1-player league fails create-league validation upstream (min 2), so the
    // state machine's start-conditions guard should also refuse to finalize it.
    expect(() =>
      createLeagueSchema.parse({
        name: "Solo League",
        visibility: "public",
        maxPlayers: 1,
        seasonYear: 2026,
        season: "FALL",
      }),
    ).toThrow();

    expect(() =>
      transition(INITIAL_LEAGUE_STATE, {
        type: "FINALIZE",
        byCommissioner: true,
        startConditionsMet: false,
      }),
    ).toThrowError(LeagueTransitionError);
  });

  it("refuses to skip drafting straight from finalized to in_season", () => {
    const finalized = transition(INITIAL_LEAGUE_STATE, {
      type: "FINALIZE",
      byCommissioner: true,
      startConditionsMet: true,
    });

    expect(() =>
      transition(finalized, { type: "COMPLETE_DRAFT", allPicksMade: true }),
    ).toThrowError(LeagueTransitionError);
  });
});
