import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  leagueMembers,
  leagues,
  users,
  type Db,
  type LeagueSeason,
} from "@anidraft/db";

/**
 * Lobby-listing domain logic, kept free of any HTTP/Next concerns so the
 * `/lobbies` page can call it server-side and tests can drive it directly
 * against a migrated database.
 *
 * ## What counts as a lobby (issue #31 lifecycle rule)
 *
 * A league appears in the lobby iff it is **public**, still in **setup**, and
 * has a **free seat** (active members < `maxPlayers`). "Active" mirrors the
 * seat-counting in `joinLeague`/`joinPublicLeague`: a member with `kickedAt`
 * set has vacated their seat and does not count. The moment a league drafts,
 * finalizes, or fills its last seat it drops off the lobby, so every row
 * returned here is genuinely joinable at query time (the join action re-checks
 * inside a transaction to close the small window between listing and clicking).
 *
 * ## Sort + pagination
 *
 * Default order is newest-first (`created_at DESC`): `draftStartsAt` is
 * nullable, so a draft-time sort would have to bucket the many unscheduled
 * lobbies arbitrarily, whereas creation time is defined for every row and
 * surfaces fresh leagues (most open seats, longest runway) first. Pagination is
 * offset-based (`LIMIT/OFFSET`) with a fixed {@link LOBBY_PAGE_SIZE}; the
 * joinable-public set is small and short-lived, so offset's deep-page costs
 * don't bite and we get a clean "page N of M" control. Swapping to a keyset
 * cursor later would be local to this function.
 */

/** How many lobbies show per page. */
export const LOBBY_PAGE_SIZE = 12;

/** One joinable public league, shaped for the lobby list UI. */
export interface LobbyListing {
  id: string;
  name: string;
  /** Commissioner's display name; `null` if unset or the account was deleted. */
  commissionerName: string | null;
  /** Active (non-kicked) member count. */
  memberCount: number;
  maxPlayers: number;
  season: LeagueSeason;
  seasonYear: number;
  /** When the draft is scheduled, or `null` if the commissioner hasn't set it. */
  draftStartsAt: Date | null;
  /** True when the viewer already belongs to this league (e.g. its commissioner). */
  viewerIsMember: boolean;
}

/** A page of lobby listings plus the totals the pagination control needs. */
export interface LobbyPage {
  lobbies: LobbyListing[];
  /** Total joinable lobbies across all pages. */
  total: number;
  /** 1-based page number actually returned (clamped to `>= 1`). */
  page: number;
  pageSize: number;
  /** Total pages (at least 1, even when there are no lobbies). */
  totalPages: number;
}

export interface ListLobbiesOptions {
  /** 1-based page; values `< 1` are clamped to 1. */
  page?: number;
  pageSize?: number;
  /** Viewer's user id, used only to flag rows they already belong to. */
  viewerId?: string | null;
}

/**
 * The number of active members per public+setup league, as a reusable count
 * expression. A `LEFT JOIN` keeps a (hypothetical) memberless league at 0
 * rather than dropping it; `kickedAt IS NULL` excludes vacated seats.
 */
const activeMemberCount = sql<number>`count(${leagueMembers.userId}) filter (where ${leagueMembers.kickedAt} is null)`;

/** Page the joinable public lobbies, newest-first. */
export async function listLobbies(
  db: Db,
  { page = 1, pageSize = LOBBY_PAGE_SIZE, viewerId = null }: ListLobbiesOptions = {},
): Promise<LobbyPage> {
  const safePage = Math.max(1, Math.floor(page));
  const safePageSize = Math.max(1, Math.floor(pageSize));

  // Only public, still-setup leagues are candidates; the seat check lives in the
  // HAVING because it filters on an aggregate.
  const joinable = and(
    eq(leagues.visibility, "public"),
    eq(leagues.status, "setup"),
  );
  const hasFreeSeat = sql`${activeMemberCount} < ${leagues.maxPlayers}`;

  // Count the qualifying leagues for the pager. One row per league survives the
  // GROUP BY + HAVING, so the row count is the total.
  const totalRows = await db
    .select({ id: leagues.id })
    .from(leagues)
    .leftJoin(leagueMembers, eq(leagueMembers.leagueId, leagues.id))
    .where(joinable)
    .groupBy(leagues.id)
    .having(hasFreeSeat);
  const total = totalRows.length;
  const totalPages = Math.max(1, Math.ceil(total / safePageSize));
  // Clamp to the last real page now that we know `totalPages`, so an
  // out-of-range `?page=99` lands on the last page (with content) instead of
  // overshooting the OFFSET into an empty list while the pager reads "99 of 3".
  const currentPage = Math.min(safePage, totalPages);

  const rows = await db
    .select({
      id: leagues.id,
      name: leagues.name,
      maxPlayers: leagues.maxPlayers,
      season: leagues.season,
      seasonYear: leagues.seasonYear,
      draftStartsAt: leagues.draftStartsAt,
      commissionerName: users.name,
      memberCount: activeMemberCount,
    })
    .from(leagues)
    .leftJoin(leagueMembers, eq(leagueMembers.leagueId, leagues.id))
    .leftJoin(users, eq(users.id, leagues.commissionerId))
    .where(joinable)
    .groupBy(leagues.id)
    .having(hasFreeSeat)
    .orderBy(desc(leagues.createdAt))
    .limit(safePageSize)
    .offset((currentPage - 1) * safePageSize);

  // Flag rows the viewer already belongs to so the UI shows "you're in" rather
  // than a Join button that would just return `already_member`. One extra query
  // scoped to the page's league ids keeps this off the grouped aggregate above.
  //
  // This intentionally does NOT filter `kickedAt`: `joinPublicLeague`'s
  // existing-membership check matches on (league, user) alone, so a kicked
  // user's lingering row still answers `already_member`. We mirror that here —
  // counting any membership row as "member" — so the two paths agree and a
  // kicked viewer sees the badge instead of a Join button that can't succeed.
  // Re-admitting kicked members is a separate flow (see PLAN.md out-of-scope).
  const memberOf = new Set<string>();
  const pageIds = rows.map((row) => row.id);
  if (viewerId && pageIds.length > 0) {
    const memberships = await db
      .select({ leagueId: leagueMembers.leagueId })
      .from(leagueMembers)
      .where(
        and(
          eq(leagueMembers.userId, viewerId),
          inArray(leagueMembers.leagueId, pageIds),
        ),
      );
    for (const row of memberships) memberOf.add(row.leagueId);
  }

  const lobbies: LobbyListing[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    commissionerName: row.commissionerName,
    // libsql returns aggregate counts as numbers, but coerce defensively so the
    // type matches regardless of driver.
    memberCount: Number(row.memberCount),
    maxPlayers: row.maxPlayers,
    season: row.season,
    seasonYear: row.seasonYear,
    draftStartsAt: row.draftStartsAt,
    viewerIsMember: memberOf.has(row.id),
  }));

  return {
    lobbies,
    total,
    page: currentPage,
    pageSize: safePageSize,
    totalPages,
  };
}
