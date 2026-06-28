import { beforeAll, describe, expect, it } from "vitest";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import {
  accounts,
  createDb,
  sessions,
  users,
  verificationTokens,
  type Db,
} from "@anidraft/db";

/**
 * Integration test: Auth.js Drizzle adapter ↔ @anidraft/db schema.
 *
 * Binds the adapter to the auth tables exactly the way `apps/web/auth.ts`
 * does, against an in-memory libsql database, and round-trips users and
 * accounts through it. This is the executable evidence that the adapter
 * writes to the expected tables (issue #20, acceptance criterion 3).
 *
 * The DDL below mirrors `packages/db/src/schema/auth.ts`, including the
 * app-specific `user` columns (#39). `created_at` is NOT NULL with a drizzle
 * `$defaultFn`, so the adapter's drizzle-issued INSERTs always carry it — the
 * column must exist here or `createUser` fails. The committed drizzle-kit
 * migration is owned by #39.
 */

const AUTH_TABLE_DDL = [
  `CREATE TABLE "user" (
    "id" text PRIMARY KEY NOT NULL,
    "name" text,
    "email" text UNIQUE,
    "emailVerified" integer,
    "image" text,
    "display_name" text,
    "avatar_url" text,
    "created_at" integer NOT NULL
  )`,
  `CREATE TABLE "account" (
    "userId" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
    "type" text NOT NULL,
    "provider" text NOT NULL,
    "providerAccountId" text NOT NULL,
    "refresh_token" text,
    "access_token" text,
    "expires_at" integer,
    "token_type" text,
    "scope" text,
    "id_token" text,
    "session_state" text,
    PRIMARY KEY ("provider", "providerAccountId")
  )`,
  `CREATE TABLE "session" (
    "sessionToken" text PRIMARY KEY NOT NULL,
    "userId" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
    "expires" integer NOT NULL
  )`,
  `CREATE TABLE "verificationToken" (
    "identifier" text NOT NULL,
    "token" text NOT NULL,
    "expires" integer NOT NULL,
    PRIMARY KEY ("identifier", "token")
  )`,
];

describe("Auth.js Drizzle adapter ↔ @anidraft/db schema", () => {
  let db: Db;
  let adapter: ReturnType<typeof DrizzleAdapter>;

  beforeAll(async () => {
    db = createDb(":memory:");
    for (const ddl of AUTH_TABLE_DDL) {
      await db.run(ddl);
    }
    adapter = DrizzleAdapter(db, {
      usersTable: users,
      accountsTable: accounts,
      sessionsTable: sessions,
      verificationTokensTable: verificationTokens,
    });
  });

  it("createUser → getUser round-trips through the users table", async () => {
    if (!adapter.createUser || !adapter.getUser || !adapter.getUserByEmail) {
      throw new Error("adapter is missing user methods");
    }

    const created = await adapter.createUser({
      id: crypto.randomUUID(),
      name: "Test Captain",
      email: "captain@anidraft.test",
      emailVerified: null,
      image: null,
    });

    expect(created.id).toBeTruthy();
    expect(created.email).toBe("captain@anidraft.test");

    const byId = await adapter.getUser(created.id);
    expect(byId?.email).toBe("captain@anidraft.test");

    const byEmail = await adapter.getUserByEmail("captain@anidraft.test");
    expect(byEmail?.id).toBe(created.id);

    // The adapter wrote to the real drizzle table, not a private store.
    const rows = await db.select().from(users);
    expect(rows.map((row) => row.email)).toContain("captain@anidraft.test");
  });

  it("linkAccount → getUserByAccount round-trips through the accounts table", async () => {
    if (
      !adapter.createUser ||
      !adapter.linkAccount ||
      !adapter.getUserByAccount
    ) {
      throw new Error("adapter is missing account methods");
    }

    const user = await adapter.createUser({
      id: crypto.randomUUID(),
      name: "OAuth User",
      email: "oauth@anidraft.test",
      emailVerified: null,
      image: null,
    });

    await adapter.linkAccount({
      userId: user.id,
      type: "oidc",
      provider: "discord",
      providerAccountId: "discord-123",
    });

    const found = await adapter.getUserByAccount({
      provider: "discord",
      providerAccountId: "discord-123",
    });
    expect(found?.id).toBe(user.id);

    const rows = await db.select().from(accounts);
    expect(rows[0]?.provider).toBe("discord");
    expect(rows[0]?.userId).toBe(user.id);
  });

  it("updateUser persists changes", async () => {
    if (!adapter.createUser || !adapter.updateUser || !adapter.getUser) {
      throw new Error("adapter is missing user methods");
    }

    const user = await adapter.createUser({
      id: crypto.randomUUID(),
      name: "Before",
      email: "rename@anidraft.test",
      emailVerified: null,
      image: null,
    });

    await adapter.updateUser({ id: user.id, name: "After" });

    const reloaded = await adapter.getUser(user.id);
    expect(reloaded?.name).toBe("After");
  });
});
