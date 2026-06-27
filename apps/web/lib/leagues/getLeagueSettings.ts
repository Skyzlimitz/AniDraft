import { and, eq, isNull } from "drizzle-orm";
import {
  leagueMembers,
  leagues,
  users,
  type Db,
  type LeagueMemberRole,
} from "@anidraft/db";

import { type LeagueSettingsView } from "./updateLeagueSettings";

/**
 * An active member of a league, as the settings page roster renders them. The
 * commissioner uses this list to remove players during setup (issue #35), so it
 * carries the `role` (the commissioner's own row is not kickable) and the
 * display `name` (nullable until the user sets one).
 */
export interface LeagueMemberView {
  userId: string;
  name: string | null;
  role: LeagueMemberRole;
}

/**
 * Read a league's settings for the commissioner settings page, along with the
 * viewer's relationship to it. Kept free of HTTP/Next concerns so the page can
 * call it server-side and tests can drive it directly against a migrated DB.
 *
 * Returns `null` when no league has that id — the page renders a 404. Otherwise
 * it returns the same {@link LeagueSettingsView} the update path produces, plus:
 *
 * - `isCommissioner` — whether the viewer is the league's commissioner (drives
 *   the read-only vs editable form),
 * - `isMember` — whether the viewer belongs to the league at all (a kicked or
 *   non-member still gets a read-only view, but the page can tailor copy), and
 * - `members` — the active roster (oldest first), used to render the member list
 *   and the commissioner's kick controls.
 */
export interface LeagueSettingsAccess {
  league: LeagueSettingsView;
  isCommissioner: boolean;
  isMember: boolean;
  members: LeagueMemberView[];
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

  // The active roster, oldest first. We join `users` for the display name and
  // derive both the member count and the viewer's membership from this one read
  // rather than issuing separate count/membership queries.
  const members = await db
    .select({
      userId: leagueMembers.userId,
      name: users.name,
      role: leagueMembers.role,
    })
    .from(leagueMembers)
    .innerJoin(users, eq(users.id, leagueMembers.userId))
    .where(
      and(eq(leagueMembers.leagueId, leagueId), isNull(leagueMembers.kickedAt)),
    )
    // Oldest first; `role` is a stable tiebreak (`commissioner` < `player`) so
    // members sharing a `joinedAt` millisecond — the commissioner and a player
    // both seeded at league creation — get a deterministic order, commissioner
    // first.
    .orderBy(leagueMembers.joinedAt, leagueMembers.role);

  return {
    league: {
      id: league.id,
      name: league.name,
      status: league.status,
      visibility: league.visibility,
      maxPlayers: league.maxPlayers,
      pickTimerSeconds: league.pickTimerSeconds,
      draftStartsAt: league.draftStartsAt,
      memberCount: members.length,
    },
    // Match on the commissioner id (not the membership role) so an orphaned
    // league with a stale "commissioner" membership row can't grant edit rights.
    isCommissioner: league.commissionerId === userId,
    isMember: members.some((member) => member.userId === userId),
    members,
  };
}
