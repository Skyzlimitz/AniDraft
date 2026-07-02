import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createDb, type Db } from "./index";

/**
 * Test-only migration runner for `@anidraft/db`.
 *
 * DB-touching tests stand up a fresh libSQL database and apply the committed
 * drizzle-kit SQL so they exercise the real schema (defaults, FKs, enum
 * columns) the way production does. This module is the single home for that
 * setup; import it via the `@anidraft/db/testing` subpath.
 *
 * It reads files from disk at runtime and is deliberately kept out of the
 * package's runtime entrypoint (`./index`) so nothing pulls `node:fs` into an
 * app bundle.
 *
 * The migration list is discovered from `drizzle/meta/_journal.json`, not
 * hardcoded, so new migrations are picked up automatically and no test list can
 * drift (issue #109).
 */

// The drizzle output directory, resolved once relative to this module so no
// caller re-derives it from its own depth on disk.
const DRIZZLE_DIR = new URL("../drizzle/", import.meta.url);

interface JournalEntry {
  idx: number;
  tag: string;
}

interface Journal {
  entries: JournalEntry[];
}

/**
 * Every committed migration tag (e.g. `"0000_true_nighthawk"`), in apply order,
 * as recorded in `drizzle/meta/_journal.json`.
 */
export function listMigrations(): string[] {
  const path = fileURLToPath(new URL("meta/_journal.json", DRIZZLE_DIR));
  const journal = JSON.parse(readFileSync(path, "utf8")) as Journal;
  return [...journal.entries]
    .sort((a, b) => a.idx - b.idx)
    .map((entry) => entry.tag);
}

/** Split a drizzle-kit migration file into its individual SQL statements. */
function statementsOf(tag: string): string[] {
  const file = tag.endsWith(".sql") ? tag : `${tag}.sql`;
  const path = fileURLToPath(new URL(file, DRIZZLE_DIR));
  return readFileSync(path, "utf8")
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

/**
 * Read the committed migrations (journal order by default) and hand each SQL
 * statement to `exec`, in order.
 *
 * The lower-level primitive behind {@link applyMigrations}; use it directly when
 * driving a raw `@libsql/client` connection rather than a drizzle {@link Db}
 * (e.g. Playwright global setup). It does not touch `PRAGMA foreign_keys` —
 * manage that in the caller.
 *
 * Pass an explicit ordered list of `tags` to apply a subset (e.g. to exercise a
 * single migration in isolation); defaults to every committed migration.
 */
export async function runMigrations(
  exec: (statement: string) => Promise<unknown>,
  tags: readonly string[] = listMigrations(),
): Promise<void> {
  for (const tag of tags) {
    for (const statement of statementsOf(tag)) await exec(statement);
  }
}

/**
 * Apply committed drizzle migrations to a drizzle {@link Db}, enabling foreign
 * keys first. Defaults to *all* committed migrations; pass an explicit ordered
 * list of tags to apply a subset.
 */
export async function applyMigrations(
  db: Db,
  tags?: readonly string[],
): Promise<void> {
  await db.run("PRAGMA foreign_keys = ON");
  await runMigrations((statement) => db.run(statement), tags);
}

/**
 * Create a fresh libSQL database with every committed migration applied.
 *
 * Defaults to an in-memory database. Pass a `file:` URL when the test needs a
 * connection-stable database: libSQL opens a new connection after each
 * `transaction()`, and a `:memory:` database is per-connection, so
 * post-transaction reads would hit an empty DB.
 */
export async function createMigratedDb(url = ":memory:"): Promise<Db> {
  const db = createDb(url);
  await applyMigrations(db);
  return db;
}
