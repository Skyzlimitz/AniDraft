/**
 * Database schema.
 *
 * Auth.js (NextAuth v5) tables live in `auth.ts` (created by #20).
 * League tables (leagues, league_members, invite_codes) live in `leagues.ts`.
 * Remaining tables will be added by these issues:
 * - #39: app-specific user columns, anime, episodes, anilist_cache
 * - #40: drafts, picks, rosters
 * - #41: weekly_snapshots, activity_log, notification_events
 */

export * from "./auth";
export * from "./leagues";
