import { and, eq, isNull, sql } from "drizzle-orm";
import {
  leagueMembers,
  leagues,
  poolOverrides,
  type Db,
  type LeagueStatus,
} from "@anidraft/db";
import {
  MIN_LEAGUE_MEMBERS_TO_FINALIZE,
  transition,
  type LeagueState,
} from "@anidraft/shared";

import { effectivePoolIds, type SeasonPoolFetcher } from "./poolEditor";

/** The transaction handle passed to a `db.transaction` callback. */
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** A reader that may be the db handle or an open transaction (both `select`). */
type Reader = Pick<Db, "select">;

/**
 * Finalize-league domain logic (issue #37), kept free of any HTTP/Next concerns
 * so it can be driven by the `POST /api/leagues/[id]/finalize` route and
 * exercised directly in tests against a migrated database.
 *
 * ## What finalize is
 *
 * A commissioner closes setup: the league moves `setup → finalized`, which locks
 * the roster, the pool, and every setting except the draft start time (the
 * editability rules in `updateLeagueSettings`/`kickPlayer`/`poolEditor` already
 * key off `status !== "setup"`, so the lock is enforced everywhere by this one
 * status flip). The league is then ready for the draft to start (a separate
 * epic — out of scope here).
 *
 * ## Preconditions (all must hold)
 *
 * - **At least {@link MIN_LEAGUE_MEMBERS_TO_FINALIZE} active members** — a draft
 *   needs participants.
 * - **Pool size ≥ player count** — there must be at least one draftable show per
 *   player, or the draft can't seat everyone. "Player count" is the active member
 *   count (the people who will actually draft), not the configured `maxPlayers`.
 *   The effective pool is the league's AniList season fetch reconciled with its
 *   overrides — `(auto − exclusions) ∪ additions` — exactly as the pool editor
 *   computes it, so a public lobby (no overrides) just uses the raw season pool.
 * - **A draft start time in the future** — `draftStartsAt` must be set and after
 *   `now`. Finalize schedules a concrete draft, so an unset or already-past time
 *   is rejected.
 *
 * The actual `setup → finalized` edge (and the commissioner guard) is delegated
 * to the shared {@link transition} state machine, so the legal lifecycle lives
 * in one place; this module layers the data-dependent preconditions on top.
 *
 * ## Idempotency
 *
 * A double-click only finalizes once. The status flip is a conditional update
 * (`SET ... WHERE id = ? AND status = 'setup'`) inside a transaction, so the
 * second concurrent call's update matches no row; and a call against an
 * already-`finalized` league returns `already_finalized` (mapped to 200), not an
 * error. Only a league past finalize (`drafting`+) is an `invalid_state`.
 *
 * The season-pool fetch (network) happens once, before the transaction, so we
 * never hold a write transaction open across a network round-trip. The league is
 * re-read inside the transaction, so the gate + precondition checks and the write
 * all see a consistent snapshot.
 */

/** A league summary returned to the caller after a finalize attempt. */
export interface FinalizedLeagueView {
  id: string;
  name: string;
  status: LeagueStatus;
  visibility: "public" | "private";
  finalizedAt: Date | null;
  memberCount: number;
}

/**
 * A single failed precondition, tagged so the route/UI can render a precise
 * message without parsing prose. Each carries the numbers behind the failure.
 */
export type FinalizePrecondition =
  | {
      code: "too_few_members";
      required: number;
      actual: number;
    }
  | {
      code: "pool_too_small";
      required: number;
      actual: number;
    }
  | { code: "draft_start_missing" }
  | { code: "draft_start_in_past"; draftStartsAt: Date };

/**
 * The outcome of a finalize attempt, as a discriminated union on `status` so the
 * route can map each case to a status code without parsing an error string.
 *
 * - `finalized`           — the league moved to `finalized`; carries the view.
 * - `already_finalized`   — it was already finalized (idempotent double-click);
 *                           carries the view, mapped to 200 not an error.
 * - `not_found`           — no league with that id.
 * - `forbidden`           — the caller is not the league's commissioner.
 * - `invalid_state`       — the league is past finalize (drafting / in_season /
 *                           completed); it can't be (re-)finalized.
 * - `preconditions_failed`— one or more start conditions were not met; `failures`
 *                           lists each with the numbers behind it.
 */
export type FinalizeLeagueResult =
  | { status: "finalized"; league: FinalizedLeagueView }
  | { status: "already_finalized"; league: FinalizedLeagueView }
  | { status: "not_found" }
  | { status: "forbidden" }
  | { status: "invalid_state"; leagueStatus: LeagueStatus }
  | { status: "preconditions_failed"; failures: FinalizePrecondition[] };

/**
 * Finalize league `leagueId` on behalf of `userId`.
 *
 * @param fetchSeasonPool Supplies the league's auto-fetched season pool. Injected
 *   (rather than importing the AniList client) so the route backs it with the
 *   real network fetch while tests pass a deterministic fake.
 * @param now Injected clock for the future-draft check and the `finalizedAt`
 *   stamp, so tests stay deterministic.
 */
export async function finalizeLeague(
  db: Db,
  leagueId: string,
  userId: string,
  fetchSeasonPool: SeasonPoolFetcher,
  now: Date = new Date(),
): Promise<FinalizeLeagueResult> {
  // 1. Load the league once up front to gate access and learn which season pool
  //    to fetch. A network fetch must not happen inside the write transaction,
  //    so we resolve the pool here; the transaction re-reads and re-checks under
  //    a consistent snapshot before writing.
  const [preLeague] = await db
    .select()
    .from(leagues)
    .where(eq(leagues.id, leagueId))
    .limit(1);
  if (!preLeague) {
    return { status: "not_found" };
  }
  // Commissioner-only. A null commissionerId (orphaned league) never equals a
  // real user id, so an orphaned league is also denied until reassigned.
  if (preLeague.commissionerId !== userId) {
    return { status: "forbidden" };
  }

  // Evaluate the network-free preconditions (member count, draft time) before
  // paying for the AniList pool fetch: a league that plainly isn't ready fails
  // fast without a network round-trip. Only relevant while still in `setup` —
  // for a finalized/past-finalize league we fall through so the transaction can
  // return `already_finalized` / `invalid_state`. The transaction re-checks
  // everything (including the pool) authoritatively, so this is a pure
  // short-circuit, never the only gate.
  let autoPool: { anilistId: number }[] = [];
  if (preLeague.status === "setup") {
    const cheapFailures = collectPreconditionFailures({
      memberCount: await activeMemberCount(db, leagueId),
      draftStartsAt: preLeague.draftStartsAt,
      now,
    });
    if (cheapFailures.length > 0) {
      return { status: "preconditions_failed", failures: cheapFailures };
    }
    autoPool = await fetchSeasonPool(preLeague.season, preLeague.seasonYear);
  }

  return db.transaction(async (tx) => {
    const [league] = await tx
      .select()
      .from(leagues)
      .where(eq(leagues.id, leagueId))
      .limit(1);
    if (!league) {
      return { status: "not_found" };
    }
    // Re-check ownership under the snapshot (it could have been transferred
    // between the pre-read and here).
    if (league.commissionerId !== userId) {
      return { status: "forbidden" };
    }

    // Idempotent double-click: an already-finalized league is a no-op success.
    // A league past finalize can't be (re-)finalized.
    if (league.status === "finalized") {
      return {
        status: "already_finalized",
        league: await viewFor(tx, league, leagueId),
      };
    }
    if (league.status !== "setup") {
      return { status: "invalid_state", leagueStatus: league.status };
    }

    const memberCount = await activeMemberCount(tx, leagueId);
    const poolSize = await effectivePoolSize(tx, leagueId, autoPool);

    const failures = collectPreconditionFailures({
      memberCount,
      poolSize,
      draftStartsAt: league.draftStartsAt,
      now,
    });
    if (failures.length > 0) {
      return { status: "preconditions_failed", failures };
    }

    // Run the canonical state-machine edge so the legal transition lives in one
    // place. By here the guards are satisfied, so this never throws; if a future
    // refactor moves a guard into the machine, a thrown LeagueTransitionError
    // would surface here rather than silently writing a bad state.
    const current: LeagueState = { status: "setup" };
    const next = transition(current, {
      type: "FINALIZE",
      byCommissioner: true,
      startConditionsMet: true,
    });

    // Conditional update: only flip a league that's still in `setup`. Combined
    // with the in-transaction status check above, this makes a concurrent
    // double-finalize write exactly one row.
    const [updated] = await tx
      .update(leagues)
      .set({ status: next.status, finalizedAt: now })
      .where(and(eq(leagues.id, leagueId), eq(leagues.status, "setup")))
      .returning();
    if (!updated) {
      // The row was in `setup` at the top of the transaction; a missing return
      // means a concurrent writer moved it first. Re-read and treat as already
      // finalized rather than reporting a spurious failure.
      const [fresh] = await tx
        .select()
        .from(leagues)
        .where(eq(leagues.id, leagueId))
        .limit(1);
      if (fresh?.status === "finalized") {
        return {
          status: "already_finalized",
          league: await viewFor(tx, fresh, leagueId),
        };
      }
      throw new Error("Failed to finalize league");
    }

    return {
      status: "finalized",
      league: await viewFor(tx, updated, leagueId),
    };
  });
}

/** Build the small league view the route returns, with the active member count. */
async function viewFor(
  tx: Tx,
  league: typeof leagues.$inferSelect,
  leagueId: string,
): Promise<FinalizedLeagueView> {
  return {
    id: league.id,
    name: league.name,
    status: league.status,
    visibility: league.visibility,
    finalizedAt: league.finalizedAt,
    memberCount: await activeMemberCount(tx, leagueId),
  };
}

/** Count the league's active (non-kicked) members. */
async function activeMemberCount(
  reader: Reader,
  leagueId: string,
): Promise<number> {
  const rows = await reader
    .select({ count: sql<number>`count(*)`.mapWith(Number) })
    .from(leagueMembers)
    .where(
      and(eq(leagueMembers.leagueId, leagueId), isNull(leagueMembers.kickedAt)),
    );
  return rows[0]?.count ?? 0;
}

/**
 * The size of the effective draftable pool. Delegates the reconciliation to the
 * pool editor's {@link effectivePoolIds} — `(auto − exclusions) ∪ additions` —
 * so finalize's gate counts exactly what the editor shows the commissioner as
 * draftable. Public lobbies have no overrides, so this is just the auto pool's
 * length for them. We only need the count, so we never materialise titles.
 */
async function effectivePoolSize(
  tx: Tx,
  leagueId: string,
  autoPool: { anilistId: number }[],
): Promise<number> {
  const overrides = await tx
    .select({
      anilistId: poolOverrides.anilistId,
      kind: poolOverrides.kind,
    })
    .from(poolOverrides)
    .where(eq(poolOverrides.leagueId, leagueId));

  return effectivePoolIds(autoPool, overrides).size;
}

/**
 * Evaluate every finalize precondition against the current facts, returning the
 * failures (empty when all pass). Pure so it's trivially unit-testable in
 * isolation from the database.
 */
export function collectPreconditionFailures(facts: {
  memberCount: number;
  /**
   * Effective draftable pool size. Optional: omit it (the network-free cheap
   * pre-check) to skip the pool rule entirely and evaluate only the member and
   * draft-time conditions; pass it (the authoritative in-transaction check) to
   * include the pool rule.
   */
  poolSize?: number;
  draftStartsAt: Date | null;
  now: Date;
}): FinalizePrecondition[] {
  const failures: FinalizePrecondition[] = [];

  if (facts.memberCount < MIN_LEAGUE_MEMBERS_TO_FINALIZE) {
    failures.push({
      code: "too_few_members",
      required: MIN_LEAGUE_MEMBERS_TO_FINALIZE,
      actual: facts.memberCount,
    });
  }

  // One draftable show per player, minimum — the pool must seat everyone. Only
  // checked when a pool size was supplied (see `poolSize` doc above).
  if (facts.poolSize !== undefined && facts.poolSize < facts.memberCount) {
    failures.push({
      code: "pool_too_small",
      required: facts.memberCount,
      actual: facts.poolSize,
    });
  }

  if (facts.draftStartsAt === null) {
    failures.push({ code: "draft_start_missing" });
  } else if (facts.draftStartsAt.getTime() <= facts.now.getTime()) {
    failures.push({
      code: "draft_start_in_past",
      draftStartsAt: facts.draftStartsAt,
    });
  }

  return failures;
}

/**
 * A human-readable message for a failed precondition. Lives next to the codes so
 * the route and the UI can share one phrasing.
 */
export function preconditionMessage(failure: FinalizePrecondition): string {
  switch (failure.code) {
    case "too_few_members":
      return `Your league needs at least ${failure.required} members to finalize (it has ${failure.actual}).`;
    case "pool_too_small":
      return `The draft pool has ${failure.actual} show${
        failure.actual === 1 ? "" : "s"
      }, but needs at least ${failure.required} — one per player.`;
    case "draft_start_missing":
      return "Set a draft start time before finalizing.";
    case "draft_start_in_past":
      return "The draft start time must be in the future.";
  }
}
