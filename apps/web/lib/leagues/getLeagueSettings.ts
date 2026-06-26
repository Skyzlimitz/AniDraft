import { and, eq, isNull, sql } from "drizzle-orm";
import { leagueMembers, leagues, type Db } from "@anidraft/db";

import { type LeagueSettingsView } from "./updateLeagueSettings";

/**
 * Read a league's settings for the commissioner settings page, along with the
 * viewer's relationship to it. Kept free of HTTP/Next concerns so the page can
 * call it server-side and tests can drive it directly against a migrated DB.
 *
 * Returns `null` when no league has that id — the page renders a 404. Otherwise
 * it returns the same {@link LeagueSettingsView} the update path produces, plus:
 *
 * - `isCommissioner` — whether the viewer is the league's commissioner (drives
 *   the read-only vs editable form), and
 * - `isMember` — whether the viewer belongs to the league at all (a kicked or
 *   non-member still gets a read-only view, but the page can tailor copy).
 */
export interface LeagueSettingsAccess {
  league: LeagueSettingsView;
  isCommissioner: boolean;
  isMember: boolean;
}

export async function getLeagueSettings(
  db: Db,
  leagueId: string,
  userId: string,
): Promise<LeagueSettingsAccess | null> {
  const [league] = await db
    .select()
    .from(leagues)
    .where(eq(leagues.id, leagueId))
    .limit(1);
  if (!league) {
    return null;
  }

  const memberRows = await db
    .select({ count: sql<number>`count(*)`.mapWith(Number) })
    .from(leagueMembers)
    .where(
      and(eq(leagueMembers.leagueId, leagueId), isNull(leagueMembers.kickedAt)),
    );
  const memberCount = memberRows[0]?.count ?? 0;

  const [membership] = await db
    .select({ role: leagueMembers.role })
    .from(leagueMembers)
    .where(
      and(
        eq(leagueMembers.leagueId, leagueId),
        eq(leagueMembers.userId, userId),
        isNull(leagueMembers.kickedAt),
      ),
    )
    .limit(1);

  return {
    league: {
      id: league.id,
      name: league.name,
      status: league.status,
      visibility: league.visibility,
      maxPlayers: league.maxPlayers,
      pickTimerSeconds: league.pickTimerSeconds,
      draftStartsAt: league.draftStartsAt,
      memberCount,
    },
    // Match on the commissioner id (not the membership role) so an orphaned
    // league with a stale "commissioner" membership row can't grant edit rights.
    isCommissioner: league.commissionerId === userId,
    isMember: membership !== undefined,
  };
}
