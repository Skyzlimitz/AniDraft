import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { leagues } from "./leagues";

/**
 * Activity feed schema: a league's append-only event log (issue #41).
 *
 * Each `activity_log` row records one thing that happened in a league — a pick
 * made, a roster swapped, a weekly score snapshot taken, the league finalized.
 * It is the source for the per-league activity feed: an immutable, append-only
 * stream, written once when the event occurs and never edited (the same shape as
 * the draft `picks` log; SQLite can't forbid an `UPDATE`, so immutability is an
 * application invariant the writers uphold).
 *
 * ## Encoding
 *
 * `event_type` follows the readable-`text`-enum convention the league tables
 * established (issue #27): self-describing rows over an int↔label mapping.
 * `payload_json` is the event's detail, shaped per `event_type` (the picked
 * show, the two shows in a swap, the snapshot week…). It is always read and
 * rendered whole by the feed and never queried into, so a JSON `text` column
 * (`mode: "json"`) beats spreading the union across typed columns or a child
 * table; the `$type` pins it to an opaque object the renderer narrows on
 * `event_type`. Dates use the same `timestamp_ms` integer encoding as every
 * other date column in the schema.
 *
 * ## Pagination
 *
 * The only read is "latest activity in this league", newest first, paged. The
 * composite index on (league_id, occurred_at, id) serves exactly that: it
 * filters by league and yields rows already ordered by time, so a `WHERE
 * league_id = ? ORDER BY occurred_at DESC, id DESC LIMIT n` is an indexed range
 * scan — no table scan, no sort — and stays flat as the log grows into the tens
 * of thousands of rows. Its leading `league_id` also covers the FK.
 *
 * `id` is the third index column for a reason: `occurred_at` is not unique
 * (its default is `new Date()`, so a burst of events in one league can share a
 * millisecond), and a keyset cursor on `occurred_at` alone would silently skip
 * the rows sharing the boundary millisecond between pages. Ordering by
 * (occurred_at, id) — `id` being the primary key — makes the order *total*, so
 * the next-page cursor is the compound predicate `occurred_at < t OR
 * (occurred_at = t AND id < lastId)` and pages can't drop or repeat a row. The
 * id tiebreak is arbitrary (a random uuid) but stable, which is all keyset
 * pagination needs; rows within the same millisecond simply get a consistent
 * order.
 *
 * Migration: drizzle-kit, same as the other schema files — `db:generate` emits
 * the forward-only SQL into `drizzle/`.
 */

/**
 * The kinds of event the activity feed records. Spelled to mirror the actions
 * that produce them across the app's lifecycle — the draft engine
 * (`draft_start`, `draft_pick`, `draft_complete`), the waiver/roster flow
 * (`roster_swap`), the weekly snapshot worker (`score_snapshot`), and the
 * commissioner league transitions (`league_finalize`, `league_complete`). The
 * `payload_json` shape is keyed off this value by the feed renderer.
 */
export const ACTIVITY_EVENT_TYPES = [
  "draft_start",
  "draft_pick",
  "draft_complete",
  "roster_swap",
  "score_snapshot",
  "league_finalize",
  "league_complete",
] as const;
export type ActivityEventType = (typeof ACTIVITY_EVENT_TYPES)[number];

export const activityLog = sqliteTable(
  "activity_log",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    leagueId: text("league_id")
      .notNull()
      .references(() => leagues.id, { onDelete: "cascade" }),
    eventType: text("event_type", { enum: ACTIVITY_EVENT_TYPES }).notNull(),
    // The event's detail, shaped per `event_type`. Read and rendered whole by the
    // feed, never queried into, so a JSON column beats typed columns / a child
    // table. The renderer narrows the opaque object on `event_type`.
    payloadJson: text("payload_json", { mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull(),
    occurredAt: integer("occurred_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    // The one read is "latest activity in this league", newest first, paged.
    // (league_id, occurred_at, id) filters by league and returns rows pre-ordered
    // by (time, id), so the feed query is an indexed range scan (no sort, no
    // table scan) that stays flat as the log grows; the leading league_id also
    // covers the FK. The trailing `id` makes the order total so a keyset cursor
    // can't skip rows that share an occurred_at millisecond (see the file note).
    leagueOccurredAtIdx: index("activity_log_league_id_occurred_at_id_idx").on(
      table.leagueId,
      table.occurredAt,
      table.id,
    ),
  }),
);
