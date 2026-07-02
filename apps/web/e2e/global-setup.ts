import { createClient } from "@libsql/client";
import { runMigrations } from "@anidraft/db/testing";

import { TEST_USER } from "./session";

/**
 * Playwright global setup: prepare the throwaway libsql database the e2e build
 * runs against so authenticated write flows (e.g. creating a league) have a
 * real schema and a seeded commissioner to reference.
 *
 * `next start` reads `DATABASE_URL` (a `file:` URL in CI/e2e), so we apply the
 * committed drizzle migrations to that same file and insert {@link TEST_USER},
 * whose id matches the `sub` in the e2e session cookie. Runs once before the
 * suite; the dev server reads the file per request, so it picks up the seed
 * regardless of start order.
 *
 * ## Reset in place — do NOT unlink the file
 *
 * The reset drops and recreates the *tables*, never the database *file*. An
 * earlier version `rmSync`'d `dev.db` (+`-wal`/`-shm`) to start clean, but the
 * `next start` server may already hold an open connection to that file by the
 * time global-setup runs (Playwright launches the web server before global
 * setup). Deleting and recreating the file swaps its inode out from under that
 * connection, so the server's next write fails with
 * `SQLITE_READONLY_DBMOVED: attempt to write a readonly database` — surfacing
 * as a 500 on any write route (create-league, join-league). Truncating the
 * schema in place keeps the inode stable, so the long-lived server connection
 * stays valid.
 */

export default async function globalSetup(): Promise<void> {
  const url = process.env.DATABASE_URL ?? "file:./dev.db";
  // Guard: only ever seed a local file DB; never touch a remote (Turso) URL.
  if (!url.startsWith("file:")) {
    throw new Error(
      `e2e global-setup refuses to seed a non-file DATABASE_URL: ${url}`,
    );
  }

  const client = createClient({ url });
  try {
    // Drop every existing user table (FKs off so order doesn't matter) instead
    // of deleting the file — see the "Reset in place" note above. `IF NOT
    // EXISTS` isn't enough on its own because the committed migrations use plain
    // `CREATE TABLE`, which would fail on a re-run against a populated file.
    await client.execute("PRAGMA foreign_keys = OFF");
    const existing = await client.execute(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    );
    for (const row of existing.rows) {
      await client.execute(`DROP TABLE IF EXISTS "${row.name as string}"`);
    }

    await client.execute("PRAGMA foreign_keys = ON");
    // Apply every committed migration (journal-driven) via the shared runner, so
    // this seed can't drift from the schema the app runs against.
    await runMigrations((statement) => client.execute(statement));

    // This is a raw INSERT (not drizzle), so the app-specific `created_at`
    // column — NOT NULL with only a drizzle-side $defaultFn — must be supplied
    // explicitly; SQLite has no default for it.
    await client.execute({
      sql: "INSERT INTO user (id, name, email, created_at) VALUES (?, ?, ?, ?)",
      args: [TEST_USER.id, TEST_USER.name, TEST_USER.email, Date.now()],
    });
  } finally {
    client.close();
  }
}
