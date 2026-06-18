import NextAuth from "next-auth";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { accounts, sessions, users, verificationTokens } from "@anidraft/db";

import { authConfig } from "@/auth.config";
import { db } from "@/lib/db";
import { env } from "@/lib/env";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  // On Vercel preview deployments the host changes every deploy, so OAuth
  // callbacks can't be pre-registered with each provider. When
  // AUTH_REDIRECT_PROXY_URL is set (see docs/env-vars.md), Auth.js sends the
  // provider the stable production callback and bounces the user back to this
  // deployment afterward. Undefined in prod/local → normal host detection.
  redirectProxyUrl: env.AUTH_REDIRECT_PROXY_URL,
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
});
