/**
 * Shared TypeScript types used across apps.
 *
 * Domain types will grow as features are implemented:
 * - League types (create, join, settings)
 * - Draft types (pick, roster, turn order)
 * - User profile types
 * - Season types
 */

/**
 * Every status a league can occupy, in lifecycle order. This is the single
 * source of truth for the league vocabulary: the state machine
 * (`leagueStateMachine.ts`) transitions between these values, and the `leagues`
 * table's `status` column enum in `@anidraft/db` mirrors this list by hand
 * (there is no workspace dependency between `db` and `shared` — see the note in
 * `packages/db/src/schema/leagues.ts`).
 *
 * `finalized` is a real lifecycle state (commissioner has locked the roster but
 * the draft has not started); `finalizedAt` on the row records *when* it
 * happened.
 */
export const LEAGUE_STATUSES = [
  "setup",
  "finalized",
  "drafting",
  "in_season",
  "completed",
] as const;

export type LeagueStatus = (typeof LEAGUE_STATUSES)[number];
export type LeagueVisibility = "public" | "private";

export interface League {
  id: string;
  name: string;
  status: LeagueStatus;
  visibility: LeagueVisibility;
  commissionerId: string;
  seasonYear: number;
  season: string;
  maxPlayers: number;
  draftSize: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface User {
  id: string;
  name: string;
  email: string;
  image: string | null;
  createdAt: Date;
}

export interface DraftPick {
  id: string;
  leagueId: string;
  userId: string;
  animeId: number;
  pickOrder: number;
  round: number;
  createdAt: Date;
}
