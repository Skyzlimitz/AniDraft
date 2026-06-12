import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
// Extensionless relative imports: Turbopack transpiles this package for the
// web app and cannot resolve `.js` specifiers to `.ts` sources.
import * as schema from "./schema/index";

export function createDb(url: string, authToken?: string) {
  const client = createClient({
    url,
    authToken,
  });
  return drizzle(client, { schema });
}

export type Db = ReturnType<typeof createDb>;

export * from "./schema/index";
