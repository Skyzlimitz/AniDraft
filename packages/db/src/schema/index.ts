/**
 * Database schema.
 *
 * Auth.js (NextAuth v5) tables live in `auth.ts` (created by #20, app-specific
 * user columns added by #39).
 * League tables (leagues, league_members, invite_codes) live in `leagues.ts`.
 * Commissioner pool overrides (pool_overrides) live in `poolOverrides.ts`.
 * Anime + per-episode tables (anime, episodes) live in `anime.ts` (#39); there
 * is no separate `anilist_cache` table — see the note in that file.
 * Draft tables (drafts, picks) live in `draft.ts` (#40).
 * Roster tables (rosters, roster_swaps) live in `roster.ts` (#40).
 * Remaining tables will be added by these issues:
 * - #41: weekly_snapshots, activity_log, notification_events
 */

export * from "./auth";
export * from "./leagues";
export * from "./poolOverrides";
export * from "./anime";
export * from "./draft";
export * from "./roster";
