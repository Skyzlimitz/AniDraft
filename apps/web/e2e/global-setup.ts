import { readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";

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
 */

const MIGRATIONS = ["0000_true_nighthawk.sql", "0001_tough_talkback.sql"];

export default async function globalSetup(): Promise<void> {
  const url = process.env.DATABASE_URL ?? "file:./dev.db";
  // Guard: only ever seed a local file DB; never touch a remote (Turso) URL.
  if (!url.startsWith("file:")) {
    throw new Error(
      `e2e global-setup refuses to seed a non-file DATABASE_URL: ${url}`,
    );
  }

  // Start from a clean file so re-running locally doesn't hit "table exists".
  const filePath = url.slice("file:".length);
  for (const suffix of ["", "-wal", "-shm"]) {
    rmSync(`${filePath}${suffix}`, { force: true });
  }

  const client = createClient({ url });
  try {
    await client.execute("PRAGMA foreign_keys = ON");
    for (const file of MIGRATIONS) {
      const path = fileURLToPath(
        new URL(`../../../packages/db/drizzle/${file}`, import.meta.url),
      );
      const sql = readFileSync(path, "utf8");
      for (const statement of sql.split("--> statement-breakpoint")) {
        const trimmed = statement.trim();
        if (trimmed) await client.execute(trimmed);
      }
    }

    await client.execute({
      sql: "INSERT INTO user (id, name, email) VALUES (?, ?, ?)",
      args: [TEST_USER.id, TEST_USER.name, TEST_USER.email],
    });
  } finally {
    client.close();
  }
}
