import type { NextAuthConfig } from "next-auth";

import { oauthProviders } from "@/auth-providers";

/**
 * Adapter-free Auth.js config, shared by `auth.ts` (full setup with the
 * Drizzle adapter) and `proxy.ts` (session checks only). Keeping the adapter
 * out of this file keeps the libsql client out of the proxy bundle.
 *
 * Providers (Google #21 + Discord #22) live in `@/auth-providers`; they are
 * pure config objects with no Node-only dependencies, so they stay safe to
 * include in the edge `proxy.ts` bundle. The account-linking strategy is
 * documented there.
 */
export const authConfig = {
  providers: oauthProviders,
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
