import { createDb, type Db } from "@anidraft/db";

// Cache across dev hot reloads so we don't pile up libsql connections.
const globalForDb = globalThis as unknown as { db?: Db };

export const db: Db =
  globalForDb.db ??
  createDb(
    process.env.DATABASE_URL ?? "file:./dev.db",
    process.env.DATABASE_AUTH_TOKEN,
  );

if (process.env.NODE_ENV !== "production") {
  globalForDb.db = db;
}
