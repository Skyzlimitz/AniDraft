import { eq } from "drizzle-orm";
import {
  leagues,
  poolOverrides,
  type Db,
  type LeagueSeason,
  type LeagueStatus,
} from "@anidraft/db";
import type { UpdatePoolOverridesInput } from "@anidraft/shared";

/**
 * Pool-editor domain logic (issue #36), kept free of HTTP/Next concerns so the
 * `/api/leagues/[id]/pool` route and the page can call it server-side, and tests
 * can drive it against a migrated in-memory database.
 *
 * The draftable pool is, by default, the AniList season fetch for the league's
 * `season`/`seasonYear`. A private league's commissioner may, before finalize,
 * exclude auto-pool shows and add shows the fetch missed. Those overrides live
 * in `pool_overrides`; the **effective** pool is reconciled here at read time as
 * `(auto − exclusions) ∪ additions` — never materialised — so an upstream
 * AniList change still flows through.
 *
 * Access rules (both map to HTTP 403 at the route):
 * - Only the **commissioner** may view or edit (others → `forbidden`).
 * - **Public ("lobby") leagues** use a fixed pool, so the editor is
 *   unavailable even to their commissioner (→ `public_unsupported`). This is the
 *   "public-lobby commissioners get 403" acceptance criterion.
 *
 * Edits are frozen once the league leaves `setup` (→ `frozen`, HTTP 409); the
 * read model still serves a read-only view in that state.
 */

/** A show as the editor renders it: AniList id plus the bits we display. */
export interface PoolShow {
  anilistId: number;
  title: string;
  coverImage: string | null;
}

/**
 * A show in the editor's combined list. `source` distinguishes an auto-pool show
 * (from the AniList fetch — removable via `excluded`) from a `manual` addition
 * (removed by deleting it outright, never `excluded`).
 */
export interface PoolEntry extends PoolShow {
  source: "auto" | "manual";
  excluded: boolean;
}

/** The pool editor's full view for one league. */
export interface PoolEditorView {
  leagueId: string;
  leagueName: string;
  season: LeagueSeason;
  seasonYear: number;
  status: LeagueStatus;
  /** True once the league is past `setup` — the editor renders read-only. */
  frozen: boolean;
  /** Auto-pool shows (with their excluded flag) followed by manual additions. */
  entries: PoolEntry[];
}

/**
 * Supplies a league's auto-fetched season pool. Injected (rather than importing
 * the AniList client directly) so the route can back it with the real,
 * network-bound fetch while tests pass a deterministic fake.
 */
export type SeasonPoolFetcher = (
  season: LeagueSeason,
  year: number,
) => Promise<PoolShow[]>;

/** Searches AniList for candidate shows to add. Injected like the fetcher. */
export type PoolSearcher = (query: string) => Promise<PoolShow[]>;

/** Shared "is this a private league the caller commissions?" denial reasons. */
type GateDenial = "not_found" | "forbidden" | "public_unsupported";

export type GetPoolEditorResult =
  | { status: "ok"; view: PoolEditorView }
  | { status: GateDenial };

export type SearchPoolResult =
  | { status: "ok"; results: PoolShow[] }
  | { status: GateDenial };

export type UpdatePoolOverridesResult =
  | { status: "saved"; exclusionCount: number; additionCount: number }
  | { status: GateDenial }
  | { status: "frozen"; leagueStatus: LeagueStatus };

type League = typeof leagues.$inferSelect;

/** A reader that may be the db handle or an open transaction. */
type Reader = Pick<Db, "select">;

/**
 * Shared access gate: load the league and confirm the caller may use its pool
 * editor — it exists, the caller is its commissioner, and it's private. Returns
 * the league on success or a tagged denial that callers surface directly.
 */
async function gatePoolEditor(
  reader: Reader,
  leagueId: string,
  userId: string,
): Promise<{ ok: true; league: League } | { ok: false; status: GateDenial }> {
  const [league] = await reader
    .select()
    .from(leagues)
    .where(eq(leagues.id, leagueId))
    .limit(1);
  if (!league) {
    return { ok: false, status: "not_found" };
  }
  // Commissioner-only. A null commissionerId (orphaned league) never equals a
  // real user id, so an orphaned league is also denied until reassigned.
  if (league.commissionerId !== userId) {
    return { ok: false, status: "forbidden" };
  }
  // Public lobbies run a fixed pool — the override editor doesn't apply, even
  // for their commissioner. Checked after the commissioner gate so the message
  // is the precise "this league type has no editor", not a generic 403.
  if (league.visibility === "public") {
    return { ok: false, status: "public_unsupported" };
  }
  return { ok: true, league };
}

/**
 * Read the pool editor view for `leagueId` on behalf of `userId`, reconciling
 * the live AniList season pool (via `fetchSeasonPool`) with the stored overrides.
 */
export async function getPoolEditor(
  db: Db,
  leagueId: string,
  userId: string,
  fetchSeasonPool: SeasonPoolFetcher,
): Promise<GetPoolEditorResult> {
  const gate = await gatePoolEditor(db, leagueId, userId);
  if (!gate.ok) {
    return { status: gate.status };
  }
  const { league } = gate;

  const autoPool = await fetchSeasonPool(league.season, league.seasonYear);
  const overrides = await db
    .select()
    .from(poolOverrides)
    .where(eq(poolOverrides.leagueId, leagueId));

  const excludedIds = new Set(
    overrides
      .filter((row) => row.kind === "exclusion")
      .map((row) => row.anilistId),
  );
  const autoPoolIds = new Set(autoPool.map((show) => show.anilistId));

  const entries: PoolEntry[] = autoPool.map((show) => ({
    ...show,
    source: "auto",
    excluded: excludedIds.has(show.anilistId),
  }));

  // Append manual additions, skipping any that the season fetch has since
  // started returning on its own (the auto entry already covers that show).
  for (const row of overrides) {
    if (row.kind !== "addition") continue;
    if (autoPoolIds.has(row.anilistId)) continue;
    entries.push({
      anilistId: row.anilistId,
      title: row.title ?? `AniList #${row.anilistId}`,
      coverImage: row.coverImage,
      source: "manual",
      excluded: false,
    });
  }

  return {
    status: "ok",
    view: {
      leagueId: league.id,
      leagueName: league.name,
      season: league.season,
      seasonYear: league.seasonYear,
      status: league.status,
      frozen: league.status !== "setup",
      entries,
    },
  };
}

/**
 * Search AniList for shows the commissioner can add to the pool. Gated by the
 * same private-league-commissioner access as the editor itself, so the search
 * endpoint can't be used to probe arbitrary leagues.
 */
export async function searchPoolCandidates(
  db: Db,
  leagueId: string,
  userId: string,
  query: string,
  search: PoolSearcher,
): Promise<SearchPoolResult> {
  const gate = await gatePoolEditor(db, leagueId, userId);
  if (!gate.ok) {
    return { status: gate.status };
  }
  const results = await search(query);
  return { status: "ok", results };
}

/**
 * Replace the league's pool overrides with `input` on behalf of `userId`.
 *
 * This is a full replace, run in one transaction: the prior override rows are
 * deleted and the new exclusion/addition set written, so the table always holds
 * exactly the commissioner's current intent. The effective pool is reconciled
 * against the live AniList fetch at read time, so the write path never needs to
 * fetch it — it just records intent.
 */
export async function updatePoolOverrides(
  db: Db,
  leagueId: string,
  userId: string,
  input: UpdatePoolOverridesInput,
): Promise<UpdatePoolOverridesResult> {
  return db.transaction(async (tx) => {
    const gate = await gatePoolEditor(tx, leagueId, userId);
    if (!gate.ok) {
      return { status: gate.status };
    }
    const { league } = gate;

    // Overrides freeze at finalize: only an in-`setup` league is editable.
    if (league.status !== "setup") {
      return { status: "frozen", leagueStatus: league.status };
    }

    // Normalise: a show added by the commissioner shouldn't also be excluded
    // (incoherent), so additions win — drop their ids from the exclusion set.
    // Then dedupe each by AniList id (last addition for an id wins).
    const additionById = new Map(
      input.additions.map((show) => [show.anilistId, show]),
    );
    const exclusionIds = [...new Set(input.exclusions)].filter(
      (id) => !additionById.has(id),
    );

    // Full replace inside the transaction: clear the old set, write the new one.
    await tx.delete(poolOverrides).where(eq(poolOverrides.leagueId, leagueId));

    const rows = [
      ...exclusionIds.map((anilistId) => ({
        leagueId,
        anilistId,
        kind: "exclusion" as const,
        title: null,
        coverImage: null,
      })),
      ...[...additionById.values()].map((show) => ({
        leagueId,
        anilistId: show.anilistId,
        kind: "addition" as const,
        title: show.title,
        coverImage: show.coverImage,
      })),
    ];
    if (rows.length > 0) {
      await tx.insert(poolOverrides).values(rows);
    }

    return {
      status: "saved",
      exclusionCount: exclusionIds.length,
      additionCount: additionById.size,
    };
  });
}
