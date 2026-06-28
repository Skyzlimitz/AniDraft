import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { users } from "./auth";

/**
 * Notification schema: per-user notification events (issue #41).
 *
 * Each `notification_events` row is one notification destined for one user — the
 * draft is starting, it's their pick, the week's results are in. A row is
 * created when the event fires and then mutated only along its delivery/read
 * lifecycle: the `read_at` / `delivered_*_at` stamps move from null to a time
 * exactly once. The notification's content (`type`, `payload_json`) is immutable.
 *
 * ## V1 scope
 *
 * Only in-app read tracking ships in V1. The `delivered_email_at` and
 * `delivered_push_at` columns exist now — so the table never needs a migration
 * when those channels land — but the delivery logic that would stamp them is
 * deliberately out of scope (see the issue). They sit nullable and unwritten
 * until then.
 *
 * ## Encoding
 *
 * `type` follows the readable-`text`-enum convention the league tables
 * established (issue #27): self-describing rows over an int↔label mapping.
 * `payload_json` is the notification's detail, shaped per `type`, read and
 * rendered whole by the notification UI and never queried into — so a JSON
 * `text` column (`mode: "json"`) beats typed columns / a child table; the
 * `$type` pins it to an opaque object the renderer narrows on `type`. Every date
 * (`created_at` plus the nullable lifecycle stamps) uses the same `timestamp_ms`
 * integer encoding as the rest of the schema; a null stamp means "not yet"
 * (unread / undelivered).
 *
 * Migration: drizzle-kit, same as the other schema files — `db:generate` emits
 * the forward-only SQL into `drizzle/`.
 */

/**
 * The kinds of notification a user can receive. Spelled to mirror the events
 * that raise them — the draft engine (`draft_starting`, `your_turn`), the
 * weekly snapshot worker (`weekly_results`), and the commissioner league
 * transitions (`league_finalized`, `league_completed`). The `payload_json` shape
 * is keyed off this value by the notification renderer.
 */
export const NOTIFICATION_TYPES = [
  "draft_starting",
  "your_turn",
  "weekly_results",
  "league_finalized",
  "league_completed",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const notificationEvents = sqliteTable(
  "notification_events",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type", { enum: NOTIFICATION_TYPES }).notNull(),
    // The notification's detail, shaped per `type`. Read and rendered whole, never
    // queried into, so a JSON column beats typed columns / a child table. The
    // renderer narrows the opaque object on `type`.
    payloadJson: text("payload_json", { mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    // Null while unread; stamped when the user reads it. Drives the "unread by
    // user" read below.
    readAt: integer("read_at", { mode: "timestamp_ms" }),
    // V1-nullable delivery stamps: the channels exist in the schema, but the
    // logic that would set these is out of scope for V1 (see the issue). Null
    // means "not yet delivered on this channel".
    deliveredEmailAt: integer("delivered_email_at", { mode: "timestamp_ms" }),
    deliveredPushAt: integer("delivered_push_at", { mode: "timestamp_ms" }),
  },
  (table) => ({
    // The hot read is "this user's unread notifications", newest first. A partial
    // index scoped to `WHERE read_at IS NULL` serves it directly: it holds only
    // unread rows (so it stays small as read history piles up) and, ordered by
    // (user_id, created_at), answers the unread list and unread-count badge as an
    // indexed range scan rather than a filter over all of a user's history.
    unreadByUserIdx: index("notification_events_unread_by_user_idx")
      .on(table.userId, table.createdAt)
      .where(sql`${table.readAt} is null`),
  }),
);
