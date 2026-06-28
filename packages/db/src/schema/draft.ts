import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { anime } from "./anime";
import { users } from "./auth";
import { leagues } from "./leagues";

/**
 * Draft schema: the draft itself and the per-pick log (issue #40).
 *
 * A `draft` is the snake-draft session a league runs once it leaves `setup`.
 * Exactly one draft exists per league (enforced by the unique index on
 * `league_id`), so the draft is the league's draft, looked up by league id.
 * Each `pick` is one selection made during that draft — together they are the
 * append-only source of truth from which a league's rosters are derived (the
 * `rosters` table in `roster.ts` materialises that derived view for query
 * speed; see the note there).
 *
 * ## Encoding
 *
 * `status` follows the readable-`text`-enum convention the league tables
 * established (issue #27): self-describing rows over an int↔label mapping.
 * `order_json` is the draft's turn order — an array of user ids — stored as a
 * JSON `text` column (`mode: "json"`) rather than a join table, because it is
 * always read and written whole (the draft engine loads the full order to find
 * whose turn it is) and is immutable once the draft starts. `anime_id` is the
 * AniList media id (an integer), referencing the local `anime` mirror. Dates
 * use the same `timestamp_ms` integer encoding as every other date column.
 *
 * Migration: drizzle-kit, same as the other schema files — `db:generate` emits
 * the forward-only SQL into `drizzle/`.
 */

/**
 * Draft lifecycle states. `pending` is created-but-not-started (turn order set,
 * waiting on the scheduled start); `in_progress` is an active draft taking
 * picks; `complete` is every pick made. Spelled per the issue #40 spec.
 */
export const DRAFT_STATUSES = ["pending", "in_progress", "complete"] as const;
export type DraftStatus = (typeof DRAFT_STATUSES)[number];

export const drafts = sqliteTable(
  "drafts",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    leagueId: text("league_id")
      .notNull()
      .references(() => leagues.id, { onDelete: "cascade" }),
    status: text("status", { enum: DRAFT_STATUSES })
      .notNull()
      .default("pending"),
    // The draft turn order: the user ids, in snake-draft seat order. Read and
    // written as a whole, never queried into, so a JSON array beats a join
    // table. `$type` pins the element type the inferred row exposes.
    orderJson: text("order_json", { mode: "json" }).$type<string[]>().notNull(),
    // Cursor into a flattened (snake-expanded) pick sequence: how many picks
    // have been made. Starts at 0; the draft engine advances it per pick.
    currentPickIndex: integer("current_pick_index").notNull().default(0),
    // Null until the draft actually begins / finishes; stamped on transition.
    startedAt: integer("started_at", { mode: "timestamp_ms" }),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    // One draft per league: the draft *is* the league's draft, and every lookup
    // is "the draft for this league". The unique index makes "one per league" a
    // DB-level guarantee and doubles as the FK-covering index for that lookup.
    leagueIdx: uniqueIndex("drafts_league_id_idx").on(table.leagueId),
  }),
);

export const picks = sqliteTable(
  "picks",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    draftId: text("draft_id")
      .notNull()
      .references(() => drafts.id, { onDelete: "cascade" }),
    // Global, 1-based ordinal of this pick within the draft (pick 1, 2, 3 …),
    // independent of round. Unique per draft via the index below.
    pickNumber: integer("pick_number").notNull(),
    round: integer("round").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    animeId: integer("anime_id")
      .notNull()
      .references(() => anime.id, { onDelete: "cascade" }),
    pickedAt: integer("picked_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    // True when the pick timer expired and the engine auto-picked for the user
    // (vs. an explicit selection). Stored as a 0/1 integer (SQLite has no bool).
    wasAutoPick: integer("was_auto_pick", { mode: "boolean" })
      .notNull()
      .default(false),
  },
  (table) => ({
    // Pick numbers are unique within a draft; this also covers the hot
    // "all picks for this draft, in order" read via its leading `draft_id`.
    draftPickNumberIdx: uniqueIndex("picks_draft_id_pick_number_idx").on(
      table.draftId,
      table.pickNumber,
    ),
    // A show can be drafted at most once per draft — the same anime can't land
    // on two rosters. Enforced at the DB level, not just by the draft engine.
    draftAnimeIdx: uniqueIndex("picks_draft_id_anime_id_idx").on(
      table.draftId,
      table.animeId,
    ),
    // SQLite does not auto-index FKs; speeds up "this user's picks".
    userIdx: index("picks_user_id_idx").on(table.userId),
  }),
);
