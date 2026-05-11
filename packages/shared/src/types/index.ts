/**
 * Shared TypeScript types used across apps.
 *
 * Domain types will grow as features are implemented:
 * - League types (create, join, settings)
 * - Draft types (pick, roster, turn order)
 * - User profile types
 * - Season types
 */

export type LeagueStatus = "setup" | "drafting" | "in_season" | "completed";
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
