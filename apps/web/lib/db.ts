import { createDb, type Db } from "@anidraft/db";

import { env } from "@/lib/env";

// Cache across dev hot reloads so we don't pile up libsql connections.
const globalForDb = globalThis as unknown as { db?: Db };

export const db: Db =
  globalForDb.db ?? createDb(env.DATABASE_URL, env.DATABASE_AUTH_TOKEN);

if (env.NODE_ENV !== "production") {
  globalForDb.db = db;
}
