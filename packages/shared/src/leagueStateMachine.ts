/**
 * League lifecycle state machine.
 *
 * A pure, dependency-free helper that, given the current league state and an
 * event, returns the next state or throws a typed error. Every place a league
 * transition happens (commissioner finalize, draft start, draft completion,
 * season end) routes through {@link transition} so the legal lifecycle lives in
 * exactly one place.
 *
 * ## Library choice — hand-rolled (no xstate / robot3)
 *
 * The machine is five states and four linear transitions with simple boolean
 * guards and no hierarchical/parallel states, no async services, and no
 * actor model. A library (xstate ~40kB, robot3 ~2kB) would add a dependency
 * and an API surface that dwarfs the logic it wraps. A hand-rolled reducer is
 * fully typed, trivially unit-testable, has zero runtime weight, and keeps the
 * transition table readable as plain data. The issue's guidance — "lean toward
 * hand-rolled if simple enough" — applies cleanly here.
 *
 * ## Transition table
 *
 * | From        | Event            | To          | Guard                                    |
 * | ----------- | ---------------- | ----------- | ---------------------------------------- |
 * | `setup`     | `FINALIZE`       | `finalized` | commissioner acts + start conditions met |
 * | `finalized` | `START_DRAFT`    | `drafting`  | draft start time reached                 |
 * | `drafting`  | `COMPLETE_DRAFT` | `in_season` | all picks completed                      |
 * | `in_season` | `END_SEASON`     | `completed` | final-week snapshot done                 |
 *
 * `completed` is terminal — no event transitions out of it.
 *
 * The states are exactly the {@link LeagueStatus} vocabulary (single source of
 * truth in `types/index.ts`, mirrored by the `leagues.status` DB column enum),
 * so a {@link LeagueState} maps 1:1 onto a persisted league row with no
 * translation layer.
 */

import type { LeagueStatus } from "./types/index";

/**
 * The league state as a discriminated union on `status`. Each member is its
 * own type so call sites can `switch` exhaustively and future per-state context
 * (e.g. a `draftStartedAt` on `drafting`) can be added without widening the
 * others. The `status` literals are exactly {@link LeagueStatus}.
 */
export type LeagueState =
  | { readonly status: "setup" }
  | { readonly status: "finalized" }
  | { readonly status: "drafting" }
  | { readonly status: "in_season" }
  | { readonly status: "completed" };

/**
 * Events that drive transitions. Each event carries exactly the facts its
 * guard needs to decide, so the machine stays pure — it never reads the clock,
 * the database, or any other ambient state.
 */
export type LeagueEvent =
  | {
      /** Commissioner closes setup and locks the roster of players. */
      readonly type: "FINALIZE";
      /** True only when the actor is the league commissioner. */
      readonly byCommissioner: boolean;
      /** True when the league meets its start conditions (enough players, settings complete). */
      readonly startConditionsMet: boolean;
    }
  | {
      /** The scheduled draft window opens. */
      readonly type: "START_DRAFT";
      /** Current time. */
      readonly now: Date;
      /** The configured draft start time. */
      readonly draftStartTime: Date;
    }
  | {
      /** The last pick of the draft is made. */
      readonly type: "COMPLETE_DRAFT";
      /** True when every roster slot across the league is filled. */
      readonly allPicksMade: boolean;
    }
  | {
      /** The season's final weekly snapshot has been recorded. */
      readonly type: "END_SEASON";
      /** True once the final-week scoring snapshot is persisted. */
      readonly finalSnapshotDone: boolean;
    };

export type LeagueEventType = LeagueEvent["type"];

/** Why a transition was rejected. */
export type TransitionFailureReason =
  /** The event is not legal from the current state. */
  | "invalid_transition"
  /** The event is legal from this state, but its guard condition failed. */
  | "guard_failed";

/**
 * Thrown by {@link transition} when an event cannot be applied. Carries enough
 * structured context for callers to branch on the failure without parsing the
 * message string.
 */
export class LeagueTransitionError extends Error {
  override readonly name = "LeagueTransitionError";
  readonly from: LeagueStatus;
  readonly eventType: LeagueEventType;
  readonly reason: TransitionFailureReason;

  constructor(args: {
    from: LeagueStatus;
    eventType: LeagueEventType;
    reason: TransitionFailureReason;
    message: string;
  }) {
    super(args.message);
    this.from = args.from;
    this.eventType = args.eventType;
    this.reason = args.reason;
    // Restore the prototype chain so `instanceof` works after transpilation.
    Object.setPrototypeOf(this, LeagueTransitionError.prototype);
  }
}

/**
 * A single edge in the lifecycle graph. Exported as plain data so UIs and docs
 * can render the lifecycle without re-implementing it.
 */
export interface LeagueTransitionDef {
  readonly event: LeagueEventType;
  readonly from: LeagueStatus;
  readonly to: LeagueStatus;
  /** Human-readable description of the guard condition. */
  readonly guard: string;
}

/** The complete, ordered transition table — the single source of truth. */
export const LEAGUE_TRANSITIONS: readonly LeagueTransitionDef[] = [
  {
    event: "FINALIZE",
    from: "setup",
    to: "finalized",
    guard: "commissioner action and league start conditions met",
  },
  {
    event: "START_DRAFT",
    from: "finalized",
    to: "drafting",
    guard: "draft start time reached",
  },
  {
    event: "COMPLETE_DRAFT",
    from: "drafting",
    to: "in_season",
    guard: "all picks completed",
  },
  {
    event: "END_SEASON",
    from: "in_season",
    to: "completed",
    guard: "final-week snapshot done",
  },
] as const;

/** The starting state of a freshly created league. */
export const INITIAL_LEAGUE_STATE: LeagueState = { status: "setup" } as const;

function fail(
  from: LeagueStatus,
  eventType: LeagueEventType,
  reason: TransitionFailureReason,
  detail: string,
): never {
  throw new LeagueTransitionError({
    from,
    eventType,
    reason,
    message: `Cannot apply "${eventType}" from "${from}": ${detail}`,
  });
}

/**
 * Apply an event to the current state, returning the next state.
 *
 * @throws {LeagueTransitionError} with `reason: "invalid_transition"` when the
 *   event is not legal from `state`, or `reason: "guard_failed"` when the event
 *   is legal but its guard condition is not satisfied.
 */
export function transition(
  state: LeagueState,
  event: LeagueEvent,
): LeagueState {
  switch (event.type) {
    case "FINALIZE": {
      if (state.status !== "setup") {
        fail(
          state.status,
          event.type,
          "invalid_transition",
          "only a league in setup can be finalized",
        );
      }
      if (!event.byCommissioner) {
        fail(
          state.status,
          event.type,
          "guard_failed",
          "only the commissioner can finalize the league",
        );
      }
      if (!event.startConditionsMet) {
        fail(
          state.status,
          event.type,
          "guard_failed",
          "league start conditions are not met",
        );
      }
      return { status: "finalized" };
    }
    case "START_DRAFT": {
      if (state.status !== "finalized") {
        fail(
          state.status,
          event.type,
          "invalid_transition",
          "only a finalized league can start drafting",
        );
      }
      if (event.now.getTime() < event.draftStartTime.getTime()) {
        fail(
          state.status,
          event.type,
          "guard_failed",
          "the draft start time has not been reached",
        );
      }
      return { status: "drafting" };
    }
    case "COMPLETE_DRAFT": {
      if (state.status !== "drafting") {
        fail(
          state.status,
          event.type,
          "invalid_transition",
          "only a drafting league can complete its draft",
        );
      }
      if (!event.allPicksMade) {
        fail(
          state.status,
          event.type,
          "guard_failed",
          "not every pick has been made",
        );
      }
      return { status: "in_season" };
    }
    case "END_SEASON": {
      if (state.status !== "in_season") {
        fail(
          state.status,
          event.type,
          "invalid_transition",
          "only an in-season league can be completed",
        );
      }
      if (!event.finalSnapshotDone) {
        fail(
          state.status,
          event.type,
          "guard_failed",
          "the final-week snapshot is not done",
        );
      }
      return { status: "completed" };
    }
    default:
      // Exhaustiveness: if a new event type is added without a case above, this
      // line fails to compile.
      return assertNever(event);
  }
}

/**
 * Non-throwing companion to {@link transition}: returns `true` when the event
 * could be applied to `state`, `false` otherwise. Useful for gating UI (e.g.
 * disabling a "Finalize" button) without try/catch.
 */
export function canTransition(state: LeagueState, event: LeagueEvent): boolean {
  try {
    transition(state, event);
    return true;
  } catch (error) {
    if (error instanceof LeagueTransitionError) {
      return false;
    }
    throw error;
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled league event: ${JSON.stringify(value)}`);
}
