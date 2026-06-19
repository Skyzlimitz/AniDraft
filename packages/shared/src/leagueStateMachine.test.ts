import { describe, expect, it } from "vitest";
import {
  INITIAL_LEAGUE_STATE,
  LEAGUE_LIFECYCLE_STATUSES,
  LEAGUE_TRANSITIONS,
  LeagueTransitionError,
  canTransition,
  transition,
  type LeagueEvent,
  type LeagueState,
} from "./leagueStateMachine.js";

// Convenience builders for the four events with their guards satisfied.
const finalize = (
  overrides: Partial<Extract<LeagueEvent, { type: "FINALIZE" }>> = {},
): LeagueEvent => ({
  type: "FINALIZE",
  byCommissioner: true,
  startConditionsMet: true,
  ...overrides,
});

const startDraft = (
  overrides: Partial<Extract<LeagueEvent, { type: "START_DRAFT" }>> = {},
): LeagueEvent => ({
  type: "START_DRAFT",
  now: new Date("2026-06-19T12:00:00Z"),
  draftStartTime: new Date("2026-06-19T12:00:00Z"),
  ...overrides,
});

const completeDraft = (
  overrides: Partial<Extract<LeagueEvent, { type: "COMPLETE_DRAFT" }>> = {},
): LeagueEvent => ({
  type: "COMPLETE_DRAFT",
  allPicksMade: true,
  ...overrides,
});

const endSeason = (
  overrides: Partial<Extract<LeagueEvent, { type: "END_SEASON" }>> = {},
): LeagueEvent => ({
  type: "END_SEASON",
  finalSnapshotDone: true,
  ...overrides,
});

describe("league state machine — states", () => {
  it("defines all five statuses in lifecycle order", () => {
    expect(LEAGUE_LIFECYCLE_STATUSES).toEqual([
      "setup",
      "finalized",
      "drafting",
      "in_season",
      "complete",
    ]);
  });

  it("starts a new league in setup", () => {
    expect(INITIAL_LEAGUE_STATE).toEqual({ status: "setup" });
  });
});

describe("league state machine — legal transitions", () => {
  it("setup → finalized on FINALIZE", () => {
    expect(transition({ status: "setup" }, finalize())).toEqual({
      status: "finalized",
    });
  });

  it("finalized → drafting on START_DRAFT", () => {
    expect(transition({ status: "finalized" }, startDraft())).toEqual({
      status: "drafting",
    });
  });

  it("drafting → in_season on COMPLETE_DRAFT", () => {
    expect(transition({ status: "drafting" }, completeDraft())).toEqual({
      status: "in_season",
    });
  });

  it("in_season → complete on END_SEASON", () => {
    expect(transition({ status: "in_season" }, endSeason())).toEqual({
      status: "complete",
    });
  });

  it("walks the full lifecycle setup → complete", () => {
    let state: LeagueState = INITIAL_LEAGUE_STATE;
    state = transition(state, finalize());
    state = transition(state, startDraft());
    state = transition(state, completeDraft());
    state = transition(state, endSeason());
    expect(state).toEqual({ status: "complete" });
  });

  it("does not mutate the input state", () => {
    const state: LeagueState = { status: "setup" };
    const next = transition(state, finalize());
    expect(state).toEqual({ status: "setup" });
    expect(next).not.toBe(state);
  });

  it("allows START_DRAFT exactly when the start time is reached", () => {
    expect(
      transition(
        { status: "finalized" },
        startDraft({
          now: new Date("2026-06-19T12:00:01Z"),
          draftStartTime: new Date("2026-06-19T12:00:00Z"),
        }),
      ),
    ).toEqual({ status: "drafting" });
  });
});

describe("league state machine — guard failures", () => {
  it("rejects FINALIZE by a non-commissioner", () => {
    expect(() =>
      transition({ status: "setup" }, finalize({ byCommissioner: false })),
    ).toThrowError(LeagueTransitionError);
  });

  it("rejects FINALIZE when start conditions are not met", () => {
    try {
      transition({ status: "setup" }, finalize({ startConditionsMet: false }));
      expect.unreachable("expected a guard failure");
    } catch (error) {
      expect(error).toBeInstanceOf(LeagueTransitionError);
      const e = error as LeagueTransitionError;
      expect(e.reason).toBe("guard_failed");
      expect(e.from).toBe("setup");
      expect(e.eventType).toBe("FINALIZE");
    }
  });

  it("rejects START_DRAFT before the start time", () => {
    try {
      transition(
        { status: "finalized" },
        startDraft({
          now: new Date("2026-06-19T11:59:59Z"),
          draftStartTime: new Date("2026-06-19T12:00:00Z"),
        }),
      );
      expect.unreachable("expected a guard failure");
    } catch (error) {
      expect(error).toBeInstanceOf(LeagueTransitionError);
      expect((error as LeagueTransitionError).reason).toBe("guard_failed");
    }
  });

  it("rejects COMPLETE_DRAFT while picks remain", () => {
    expect(() =>
      transition(
        { status: "drafting" },
        completeDraft({ allPicksMade: false }),
      ),
    ).toThrowError(/not every pick has been made/);
  });

  it("rejects END_SEASON before the final snapshot is done", () => {
    expect(() =>
      transition(
        { status: "in_season" },
        endSeason({ finalSnapshotDone: false }),
      ),
    ).toThrowError(/final-week snapshot is not done/);
  });
});

describe("league state machine — invalid transitions", () => {
  it("rejects FINALIZE from a non-setup state", () => {
    try {
      transition({ status: "drafting" }, finalize());
      expect.unreachable("expected an invalid transition");
    } catch (error) {
      expect(error).toBeInstanceOf(LeagueTransitionError);
      const e = error as LeagueTransitionError;
      expect(e.reason).toBe("invalid_transition");
      expect(e.from).toBe("drafting");
      expect(e.eventType).toBe("FINALIZE");
    }
  });

  it("rejects START_DRAFT from setup (must finalize first)", () => {
    expect(() => transition({ status: "setup" }, startDraft())).toThrowError(
      LeagueTransitionError,
    );
  });

  it("rejects COMPLETE_DRAFT from in_season", () => {
    expect(() =>
      transition({ status: "in_season" }, completeDraft()),
    ).toThrowError(/only a drafting league/);
  });

  it("rejects END_SEASON from finalized", () => {
    expect(() => transition({ status: "finalized" }, endSeason())).toThrowError(
      /only an in-season league/,
    );
  });

  it("treats complete as terminal — no event leaves it", () => {
    expect(() => transition({ status: "complete" }, endSeason())).toThrowError(
      LeagueTransitionError,
    );
    expect(() => transition({ status: "complete" }, startDraft())).toThrowError(
      LeagueTransitionError,
    );
  });
});

describe("canTransition", () => {
  it("is true for a legal, guard-satisfying event", () => {
    expect(canTransition({ status: "setup" }, finalize())).toBe(true);
  });

  it("is false when the guard fails", () => {
    expect(
      canTransition({ status: "setup" }, finalize({ byCommissioner: false })),
    ).toBe(false);
  });

  it("is false for an illegal transition", () => {
    expect(canTransition({ status: "complete" }, finalize())).toBe(false);
  });
});

describe("LEAGUE_TRANSITIONS table", () => {
  it("describes exactly the four lifecycle edges", () => {
    expect(LEAGUE_TRANSITIONS).toHaveLength(4);
    expect(LEAGUE_TRANSITIONS.map((t) => [t.from, t.event, t.to])).toEqual([
      ["setup", "FINALIZE", "finalized"],
      ["finalized", "START_DRAFT", "drafting"],
      ["drafting", "COMPLETE_DRAFT", "in_season"],
      ["in_season", "END_SEASON", "complete"],
    ]);
  });

  it("only references declared statuses", () => {
    for (const t of LEAGUE_TRANSITIONS) {
      expect(LEAGUE_LIFECYCLE_STATUSES).toContain(t.from);
      expect(LEAGUE_LIFECYCLE_STATUSES).toContain(t.to);
    }
  });
});
