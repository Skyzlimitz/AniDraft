import NextAuth from "next-auth";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { accounts, sessions, users, verificationTokens } from "@anidraft/db";

import { authConfig } from "@/auth.config";
import { db } from "@/lib/db";
import { env } from "@/lib/env";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  // Vercel preview deployments get a fresh host each deploy, so their OAuth
  // callback can't be pre-registered with each provider. Set
  // AUTH_REDIRECT_PROXY_URL to the stable PRODUCTION `/api/auth` URL on BOTH
  // the Production and Preview envs (see docs/env-vars.md): a preview sends the
  // provider the production callback, and production — recognizing itself as
  // the proxy because the URL's origin matches its own — forwards the user back
  // to the preview. Both must share AUTH_SECRET. Leave unset locally, or local
  // sign-in would route through production. Undefined → normal host detection.
  redirectProxyUrl: env.AUTH_REDIRECT_PROXY_URL,
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
});
