/**
 * Scaffold import check (Issue #6).
 *
 * Proves that the shared workspace packages resolve from `apps/web` and expose
 * their TypeScript definitions. This imports a *value* and a *type* from each
 * dependency the web app declares. It is a placeholder only — no real app
 * behavior is wired up here — and is validated by `tsc` (the `typecheck`
 * script, also run by `next build`).
 */
import { calculateDraftSize, type League } from "@anidraft/shared";
import { createDb } from "@anidraft/db";
import { type AniListMedia } from "@anidraft/anilist";

export interface ScaffoldCheck {
  /** A placeholder type from `@anidraft/shared`. */
  leagueStatus: League["status"];
  /** A placeholder type from `@anidraft/anilist`. */
  mediaId: AniListMedia["id"];
  /** A runtime value re-exported from `@anidraft/db`. */
  createDb: typeof createDb;
  /** A runtime value computed by `@anidraft/shared`. */
  draftSizeForFourPlayers: number;
}

export const scaffoldCheck: ScaffoldCheck = {
  leagueStatus: "setup",
  mediaId: 0,
  createDb,
  draftSizeForFourPlayers: calculateDraftSize(4),
};
