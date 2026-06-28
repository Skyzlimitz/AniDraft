import { describe, expect, it } from "vitest";
import {
  INITIAL_LEAGUE_STATE,
  LeagueTransitionError,
  MIN_LEAGUE_MEMBERS_TO_FINALIZE,
  canTransition,
  transition,
  type LeagueEvent,
} from "@anidraft/shared";

/**
 * Integration test: the league **finalize** flow (issue #37), at the seam where
 * the finalize API route's preconditions feed the shared state machine.
 *
 * The route (`apps/web/lib/leagues/finalizeLeague.ts`) evaluates three
 * data-dependent preconditions — at least {@link MIN_LEAGUE_MEMBERS_TO_FINALIZE}
 * members, a draft pool large enough to seat every player, and a future draft
 * start — and collapses them into the `startConditionsMet` flag on the
 * `FINALIZE` event that drives `transition`. This test reconstructs that wiring
 * from the `@anidraft/shared` primitives (the constant + the machine) so the
 * contract between "what counts as ready" and "what the machine allows" is
 * pinned independently of the web app's DB plumbing.
 */

/**
 * Mirror of the route's precondition collapse: are a league's facts sufficient
 * to finalize? Built from the same shared constant the route uses, so this and
 * the route can't drift on the member floor.
 */
function startConditionsMet(facts: {
  memberCount: number;
  poolSize: number;
  draftStartsAt: Date | null;
  now: Date;
}): boolean {
  if (facts.memberCount < MIN_LEAGUE_MEMBERS_TO_FINALIZE) return false;
  if (facts.poolSize < facts.memberCount) return false;
  if (facts.draftStartsAt === null) return false;
  if (facts.draftStartsAt.getTime() <= facts.now.getTime()) return false;
  return true;
}

const NOW = new Date("2026-06-28T00:00:00Z");
const FUTURE = new Date("2026-07-01T00:00:00Z");

function finalizeEvent(
  overrides: Partial<{
    byCommissioner: boolean;
    memberCount: number;
    poolSize: number;
    draftStartsAt: Date | null;
  }> = {},
): LeagueEvent {
  const memberCount = overrides.memberCount ?? 4;
  const poolSize = overrides.poolSize ?? 50;
  const draftStartsAt =
    overrides.draftStartsAt === undefined ? FUTURE : overrides.draftStartsAt;
  return {
    type: "FINALIZE",
    byCommissioner: overrides.byCommissioner ?? true,
    startConditionsMet: startConditionsMet({
      memberCount,
      poolSize,
      draftStartsAt,
      now: NOW,
    }),
  };
}

describe("league finalize (preconditions + state machine)", () => {
  it("finalizes a ready league: setup → finalized", () => {
    const next = transition(INITIAL_LEAGUE_STATE, finalizeEvent());
    expect(next).toEqual({ status: "finalized" });
  });

  it("blocks finalize when below the member floor", () => {
    const event = finalizeEvent({
      memberCount: MIN_LEAGUE_MEMBERS_TO_FINALIZE - 1,
    });
    expect(canTransition(INITIAL_LEAGUE_STATE, event)).toBe(false);
    expect(() => transition(INITIAL_LEAGUE_STATE, event)).toThrowError(
      LeagueTransitionError,
    );
  });

  it("blocks finalize when the pool can't seat every player", () => {
    const event = finalizeEvent({ memberCount: 4, poolSize: 3 });
    expect(canTransition(INITIAL_LEAGUE_STATE, event)).toBe(false);
  });

  it("blocks finalize when the draft start is missing or in the past", () => {
    expect(
      canTransition(
        INITIAL_LEAGUE_STATE,
        finalizeEvent({ draftStartsAt: null }),
      ),
    ).toBe(false);
    expect(
      canTransition(
        INITIAL_LEAGUE_STATE,
        finalizeEvent({ draftStartsAt: new Date("2026-01-01T00:00:00Z") }),
      ),
    ).toBe(false);
  });

  it("blocks finalize by a non-commissioner even when conditions are met", () => {
    const event = finalizeEvent({ byCommissioner: false });
    // Sanity: the data conditions are met, so it's the actor guard that blocks.
    expect(event.type === "FINALIZE" && event.startConditionsMet).toBe(true);
    expect(canTransition(INITIAL_LEAGUE_STATE, event)).toBe(false);
  });

  it("rejects a second finalize: the machine only allows it from setup", () => {
    const finalized = transition(INITIAL_LEAGUE_STATE, finalizeEvent());
    // A finalized league has no FINALIZE edge — the route's idempotency layer
    // catches the double-click before this, but the machine is the backstop.
    expect(() => transition(finalized, finalizeEvent())).toThrowError(
      /only a league in setup can be finalized/,
    );
  });
});
