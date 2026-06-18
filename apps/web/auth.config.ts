import type { NextAuthConfig } from "next-auth";

/**
 * Adapter-free Auth.js config, shared by `auth.ts` (full setup with the
 * Drizzle adapter) and `proxy.ts` (session checks only). Keeping the adapter
 * out of this file keeps the libsql client out of the proxy bundle.
 *
 * Providers are intentionally empty — Google (#21) and Discord (#22) are
 * separate issues.
 */
export const authConfig = {
  providers: [],
  // Explicit: the adapter in auth.ts would otherwise default this to
  // "database". JWT keeps session checks in proxy.ts free of a Turso
  // round-trip per request; the adapter still persists users/accounts at
  // sign-in once providers land.
  session: { strategy: "jwt" },
  callbacks: {
    session({ session, token }) {
      // Expose the stable user id so server code can key DB rows by it.
      if (token.sub) {
        session.user.id = token.sub;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
