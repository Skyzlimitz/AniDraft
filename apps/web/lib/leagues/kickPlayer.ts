import { and, eq, isNull } from "drizzle-orm";
import {
  leagueMembers,
  leagues,
  type Db,
  type LeagueStatus,
} from "@anidraft/db";

/**
 * Kick-player domain logic, kept free of any HTTP/Next concerns so it can be
 * driven by the `DELETE /api/leagues/[id]/members/[userId]` route and exercised
 * directly in tests against a migrated database.
 *
 * ## What a kick is (issue #35)
 *
 * A commissioner removes a player from their **private** league while it is
 * still in `setup`. The removal is a **soft delete**: we stamp the membership
 * row's `kickedAt` rather than deleting it. That keeps the join history intact
 * (so a re-join is the same flow as any join — out of scope here), and every
 * active-member read across the app already filters on `kickedAt IS NULL`
 * (`joinLeague`, `getLeagueSettings`, `updateLeagueSettings`), so a kicked
 * player is immediately invisible everywhere and the freed seat is reusable.
 *
 * ## Who can kick, and when
 *
 * The whole kick runs in one transaction so the league lookup, the membership
 * lookup, and the write all see a consistent snapshot.
 *
 * Order of checks (each short-circuits):
 * 1. the league exists — else `not_found`;
 * 2. the caller is the league's commissioner — else `forbidden` (→ 403);
 * 3. the league is **private** — a public lobby never grants the commissioner
 *    the kick power (issue #35), so `public_forbidden` (→ 403);
 * 4. the league is still in `setup` — once `finalized` (or later) the roster is
 *    locked, so `locked` (→ 403);
 * 5. the target is not the commissioner themselves — else `self_kick` (→ 400);
 * 6. the target is currently an active member — else `member_not_found` (→ 404).
 *
 * On success the row's `kickedAt` is set and the result is `kicked`.
 */

/**
 * The outcome of a kick attempt, as a discriminated union on `status` so the
 * route can map each case to a status code without parsing an error string.
 */
export type KickPlayerResult =
  | { status: "kicked"; userId: string }
  | { status: "not_found" }
  | { status: "forbidden" }
  | { status: "public_forbidden" }
  | { status: "locked"; leagueStatus: LeagueStatus }
  | { status: "self_kick" }
  | { status: "member_not_found" };

/**
 * Remove `targetUserId` from league `leagueId` on behalf of `commissionerId`.
 *
 * @param now Injected clock for the `kickedAt` stamp, so tests stay deterministic.
 */
export async function kickPlayer(
  db: Db,
  leagueId: string,
  commissionerId: string,
  targetUserId: string,
  now: Date = new Date(),
): Promise<KickPlayerResult> {
  return db.transaction(async (tx) => {
    const [league] = await tx
      .select()
      .from(leagues)
      .where(eq(leagues.id, leagueId))
      .limit(1);
    if (!league) {
      return { status: "not_found" };
    }

    // Access control: only the commissioner may kick. A null commissionerId
    // (orphaned league) is never equal to a real user id, so this also denies
    // kicks in an orphaned league until it's reassigned.
    if (league.commissionerId !== commissionerId) {
      return { status: "forbidden" };
    }

    // Kicking is a private-league commissioner power. Public lobbies run on
    // open join/leave rules and never grant it (issue #35), so this is a
    // permanent visibility boundary, not a transient lifecycle freeze.
    if (league.visibility === "public") {
      return { status: "public_forbidden" };
    }

    // Roster changes are only allowed while the league is being set up. Once it
    // finalizes, the membership is locked in for the draft.
    if (league.status !== "setup") {
      return { status: "locked", leagueStatus: league.status };
    }

    // A commissioner can't kick themselves — that would orphan the league's only
    // privileged member. Leaving/transferring is a separate flow.
    if (targetUserId === commissionerId) {
      return { status: "self_kick" };
    }

    // The target must currently be an active member. An already-kicked or
    // never-joined user is a no-op we surface as `member_not_found` rather than
    // silently "succeeding".
    const [member] = await tx
      .select({ userId: leagueMembers.userId })
      .from(leagueMembers)
      .where(
        and(
          eq(leagueMembers.leagueId, leagueId),
          eq(leagueMembers.userId, targetUserId),
          isNull(leagueMembers.kickedAt),
        ),
      )
      .limit(1);
    if (!member) {
      return { status: "member_not_found" };
    }

    await tx
      .update(leagueMembers)
      .set({ kickedAt: now })
      .where(
        and(
          eq(leagueMembers.leagueId, leagueId),
          eq(leagueMembers.userId, targetUserId),
        ),
      );

    return { status: "kicked", userId: targetUserId };
  });
}
