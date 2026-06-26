import { and, eq, isNull } from "drizzle-orm";
import {
  leagueMembers,
  leagues,
  type Db,
  type LeagueStatus,
} from "@anidraft/db";

/**
 * Join-a-public-league domain logic, the code-free counterpart to
 * {@link import("./joinLeague").joinLeague}.
 *
 * Public ("lobby") leagues are created **without** an invite code (see
 * `createLeague`), so they can't be joined through `/join/[code]`. A user joins
 * one straight from the lobby by its id: there's nothing secret to present, the
 * league's `public` visibility is the invitation.
 *
 * Like the invite-code join this runs in a single transaction — the membership
 * lookup, the seat count, and the insert all see one snapshot, so two players
 * racing for the last seat can't both pass the {@link leagues.maxPlayers} check.
 * It is **idempotent**: a user who already belongs gets `already_member` and no
 * duplicate row (the composite PK on `league_members` would reject one anyway),
 * which makes the lobby's Join button safe to double-click.
 */

/**
 * Outcome of a public-join attempt, a discriminated union on `status` so the
 * lobby action can map each case to a message without parsing strings.
 *
 * `not_found` deliberately covers a missing league **and** a non-public one: the
 * action is reachable by a direct POST with any id, so refusing to reveal that a
 * private league exists (let alone join it) keeps this from becoming a backdoor
 * around the invite-code flow.
 */
export type JoinPublicLeagueResult =
  | { status: "joined"; leagueId: string }
  | { status: "already_member"; leagueId: string }
  | { status: "not_found" }
  | { status: "wrong_state"; leagueId: string; leagueStatus: LeagueStatus }
  | { status: "league_full"; leagueId: string };

/**
 * Add `userId` to the public league `leagueId`.
 *
 * Validation, ordered for the most helpful message:
 * 1. the league exists and is `public` — else `not_found`;
 * 2. the user is not already a member — else `already_member`;
 * 3. the league is still in `setup` — else `wrong_state`;
 * 4. it has a free seat (`kickedAt IS NULL` members < `maxPlayers`) — else
 *    `league_full`.
 *
 * On success a `player` membership row is inserted and the result is `joined`.
 */
export async function joinPublicLeague(
  db: Db,
  userId: string,
  leagueId: string,
): Promise<JoinPublicLeagueResult> {
  return db.transaction(async (tx) => {
    const [league] = await tx
      .select()
      .from(leagues)
      .where(eq(leagues.id, leagueId))
      .limit(1);
    // Unknown id, or a private league reached by id: same opaque answer.
    if (!league || league.visibility !== "public") {
      return { status: "not_found" };
    }

    // Already-member wins over state/fullness: if you're in, point you at it.
    const [existing] = await tx
      .select({ userId: leagueMembers.userId })
      .from(leagueMembers)
      .where(
        and(
          eq(leagueMembers.leagueId, league.id),
          eq(leagueMembers.userId, userId),
        ),
      )
      .limit(1);
    if (existing) {
      return { status: "already_member", leagueId: league.id };
    }

    if (league.status !== "setup") {
      return {
        status: "wrong_state",
        leagueId: league.id,
        leagueStatus: league.status,
      };
    }

    // Count only active members — a kicked member (`kickedAt` set) frees a seat.
    const active = await tx
      .select({ userId: leagueMembers.userId })
      .from(leagueMembers)
      .where(
        and(
          eq(leagueMembers.leagueId, league.id),
          isNull(leagueMembers.kickedAt),
        ),
      );
    if (active.length >= league.maxPlayers) {
      return { status: "league_full", leagueId: league.id };
    }

    await tx.insert(leagueMembers).values({
      leagueId: league.id,
      userId,
      role: "player",
    });

    return { status: "joined", leagueId: league.id };
  });
}
