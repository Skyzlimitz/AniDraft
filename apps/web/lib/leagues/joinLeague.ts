import { and, eq, isNull } from "drizzle-orm";
import {
  inviteCodes,
  leagueMembers,
  leagues,
  type Db,
  type LeagueStatus,
} from "@anidraft/db";

/**
 * Join-league domain logic, kept free of any HTTP/Next concerns so it can be
 * driven by both the `/join/[code]` page (server-side) and the
 * `POST /api/leagues/join` route, and exercised directly in tests against an
 * in-memory database.
 *
 * The whole join is one transaction: looking up the invite, counting the
 * league's members, and inserting the new membership all see a consistent
 * snapshot, so two players racing to claim the last seat can't both slip past
 * the {@link leagues.maxPlayers} check.
 *
 * The function is **idempotent**: a user who already belongs to the league gets
 * an `already_member` result and no second row is inserted (the composite PK on
 * `league_members` would reject it anyway). That makes it safe for the page to
 * run the join on a plain GET visit — a refresh or link prefetch can't double
 * up a membership or over-count `uses`.
 */

/**
 * The outcome of a join attempt, as a discriminated union on `status` so the
 * page and the API route can render the right message / status code without
 * parsing an error string. The non-`invalid_code`/`expired` variants carry the
 * `leagueId` so callers can link back to the league.
 */
export type JoinLeagueResult =
  | { status: "joined"; leagueId: string }
  | { status: "already_member"; leagueId: string }
  | { status: "invalid_code" }
  | { status: "expired" }
  | { status: "wrong_state"; leagueId: string; leagueStatus: LeagueStatus }
  | { status: "league_full"; leagueId: string };

/**
 * Add `userId` to the private league behind invite `code`.
 *
 * Validation, in the order that yields the most helpful message:
 * 1. the code exists (and points at a live league) — else `invalid_code`;
 * 2. the user is not already a member — else `already_member`;
 * 3. the code is neither past its `expiresAt` nor out of `maxUses` — else
 *    `expired`;
 * 4. the league is still in `setup` — else `wrong_state`;
 * 5. the league has a free seat — else `league_full`.
 *
 * On success a `player` membership row is inserted and the invite's `uses`
 * counter is incremented; the result is `joined`.
 *
 * @param now Injected clock for the expiry check, so tests stay deterministic.
 */
export async function joinLeague(
  db: Db,
  userId: string,
  code: string,
  now: Date = new Date(),
): Promise<JoinLeagueResult> {
  return db.transaction(async (tx) => {
    const [invite] = await tx
      .select()
      .from(inviteCodes)
      .where(eq(inviteCodes.code, code))
      .limit(1);
    if (!invite) {
      return { status: "invalid_code" };
    }

    const [league] = await tx
      .select()
      .from(leagues)
      .where(eq(leagues.id, invite.leagueId))
      .limit(1);
    // A code whose league has vanished (cascade-deleted) is effectively dead.
    if (!league) {
      return { status: "invalid_code" };
    }

    // Already-member wins over every "why you can't join" message: if you're in,
    // the league's state or fullness is moot — point you at it.
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

    const expired =
      (invite.expiresAt !== null &&
        invite.expiresAt.getTime() <= now.getTime()) ||
      (invite.maxUses !== null && invite.uses >= invite.maxUses);
    if (expired) {
      return { status: "expired" };
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
    await tx
      .update(inviteCodes)
      .set({ uses: invite.uses + 1 })
      .where(eq(inviteCodes.code, code));

    return { status: "joined", leagueId: league.id };
  });
}
