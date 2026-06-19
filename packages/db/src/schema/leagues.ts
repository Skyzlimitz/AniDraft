import {
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

import { users } from "./auth";

/**
 * Core league schema: leagues, their members, and invite codes.
 *
 * Enum encoding decision (issue #27): every enum is stored as a SQLite `text`
 * column with a drizzle `enum` constraint, not as an integer code. SQLite has
 * no native enum type, and storing readable strings keeps the rows
 * self-describing in `drizzle-kit studio` / raw `SELECT`s, mirrors the union
 * types already exported from `@anidraft/shared` (`LeagueStatus`,
 * `LeagueVisibility`), and avoids a brittle int↔label mapping. The narrow
 * `enum` arrays below are the single source of truth and flow through to the
 * inferred row types.
 *
 * Migration strategy: drizzle-kit. `drizzle.config.ts` reads `schema/index.ts`
 * (which re-exports this file), so `pnpm --filter @anidraft/db db:generate`
 * emits a forward-only SQL migration into `drizzle/`, applied on merge by the
 * existing CI migration job.
 */

/** League lifecycle states — mirrors `LeagueStatus` in `@anidraft/shared`. */
export const LEAGUE_STATUSES = [
  "setup",
  "drafting",
  "in_season",
  "completed",
] as const;
export type LeagueStatus = (typeof LEAGUE_STATUSES)[number];

/** League visibility — mirrors `LeagueVisibility` in `@anidraft/shared`. */
export const LEAGUE_VISIBILITIES = ["public", "private"] as const;
export type LeagueVisibility = (typeof LEAGUE_VISIBILITIES)[number];

/** AniList airing seasons; matches `createLeagueSchema.season`. */
export const LEAGUE_SEASONS = ["WINTER", "SPRING", "SUMMER", "FALL"] as const;
export type LeagueSeason = (typeof LEAGUE_SEASONS)[number];

/** Membership roles within a league. */
export const LEAGUE_MEMBER_ROLES = ["commissioner", "player"] as const;
export type LeagueMemberRole = (typeof LEAGUE_MEMBER_ROLES)[number];

export const leagues = sqliteTable("leagues", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  visibility: text("visibility", { enum: LEAGUE_VISIBILITIES })
    .notNull()
    .default("private"),
  commissionerId: text("commissioner_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  season: text("season", { enum: LEAGUE_SEASONS }).notNull(),
  seasonYear: integer("season_year").notNull(),
  maxPlayers: integer("max_players").notNull(),
  pickTimerSeconds: integer("pick_timer_seconds").notNull().default(60),
  draftStartsAt: integer("draft_starts_at", { mode: "timestamp_ms" }),
  status: text("status", { enum: LEAGUE_STATUSES }).notNull().default("setup"),
  finalizedAt: integer("finalized_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const leagueMembers = sqliteTable(
  "league_members",
  {
    leagueId: text("league_id")
      .notNull()
      .references(() => leagues.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: LEAGUE_MEMBER_ROLES })
      .notNull()
      .default("player"),
    joinedAt: integer("joined_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    // Null while the member is active; set when a commissioner removes them.
    kickedAt: integer("kicked_at", { mode: "timestamp_ms" }),
  },
  (table) => ({
    // One membership row per (league, user); also the natural lookup key.
    compositePk: primaryKey({ columns: [table.leagueId, table.userId] }),
  }),
);

export const inviteCodes = sqliteTable("invite_codes", {
  code: text("code").primaryKey(),
  leagueId: text("league_id")
    .notNull()
    .references(() => leagues.id, { onDelete: "cascade" }),
  // Null = never expires.
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
  // Null = unlimited uses.
  maxUses: integer("max_uses"),
  uses: integer("uses").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});
