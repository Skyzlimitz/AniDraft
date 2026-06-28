import {
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

/**
 * Canonical Auth.js (NextAuth v5) tables for the Drizzle adapter, SQLite
 * dialect. The adapter-owned columns (id, name, email, emailVerified, image)
 * follow the @auth/drizzle-adapter contract — do not rename them. The
 * app-specific columns below them (display_name, avatar_url, created_at) were
 * added by #39 and are invisible to the adapter; it only reads/writes the
 * contract columns.
 */

/** Mirrors AdapterAccount["type"] from @auth/core without taking the dependency. */
type AdapterAccountType = "email" | "oauth" | "oidc" | "webauthn";

export const users = sqliteTable("user", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: integer("emailVerified", { mode: "timestamp_ms" }),
  image: text("image"),
  // App-specific columns (issue #39), not part of the Auth.js adapter contract.
  // `name`/`image` above are populated by the OAuth provider; these are the
  // user-editable profile fields the app owns. `displayName` falls back to
  // `name` in the UI when null; `avatarUrl` falls back to `image`.
  displayName: text("display_name"),
  avatarUrl: text("avatar_url"),
  // Nullable, NOT NOT NULL: `user` predates this column (the Auth.js adapter,
  // #20, shipped first), so prod rows already exist. SQLite/libsql refuses to
  // `ADD COLUMN … NOT NULL` to a populated table because the value would have
  // to be NULL for the existing rows, and there is no SQL-level default to fall
  // back on ($defaultFn runs in app code, emitting no SQL). The migration adds
  // it nullable and backfills the existing rows; the $defaultFn still stamps
  // every drizzle-inserted row, so in practice app-created users are never null.
  createdAt: integer("created_at", { mode: "timestamp_ms" }).$defaultFn(
    () => new Date(),
  ),
});

export const accounts = sqliteTable(
  "account",
  {
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccountType>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (account) => ({
    compositePk: primaryKey({
      columns: [account.provider, account.providerAccountId],
    }),
  }),
);

export const sessions = sqliteTable("session", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: integer("expires", { mode: "timestamp_ms" }).notNull(),
});

export const verificationTokens = sqliteTable(
  "verificationToken",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: integer("expires", { mode: "timestamp_ms" }).notNull(),
  },
  (verificationToken) => ({
    compositePk: primaryKey({
      columns: [verificationToken.identifier, verificationToken.token],
    }),
  }),
);
