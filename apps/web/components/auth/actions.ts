"use server";

import { signIn, signOut } from "@/auth";
import { OAUTH_PROVIDERS, type OAuthProviderId } from "@/components/auth/providers";

/**
 * Server actions that drive the auth UI. `signIn`/`signOut` issue a redirect
 * (they `throw` a Next redirect internally), so these never return on the happy
 * path — the browser is sent to the OAuth provider or back to the app.
 */

const PROVIDER_IDS = new Set<string>(OAUTH_PROVIDERS.map((p) => p.id));

/**
 * Begin the OAuth flow for `provider`, landing the user on `/leagues` once the
 * callback completes. The id is bound from a trusted constant in
 * `SignInButtons`, but we re-validate because server actions are a public
 * endpoint and arguments arrive from the client.
 */
export async function signInWithProvider(provider: OAuthProviderId) {
  if (!PROVIDER_IDS.has(provider)) {
    throw new Error(`Unknown OAuth provider: ${provider}`);
  }
  await signIn(provider, { redirectTo: "/leagues" });
}

/** Clear the session and return to the landing page. */
export async function signOutAction() {
  await signOut({ redirectTo: "/" });
}
