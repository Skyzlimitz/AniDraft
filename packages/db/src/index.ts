import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";

export function createDb(url: string, authToken?: string) {
  const client = createClient({
    url,
    authToken,
  });
  return drizzle(client);
}

export * from "./schema/index.js";
