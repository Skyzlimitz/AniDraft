/**
 * Shared, dependency-free metadata for the OAuth providers AniDraft offers
 * (#21 Google, #22 Discord). Kept separate from the React components so the
 * provider list and the `?error=` copy can be unit-tested in plain Node and
 * reused by both the sign-in page and its buttons without pulling in client
 * code or Auth.js internals.
 *
 * The `id`s MUST match the provider ids registered in `@/auth-providers`
 * ("google" / "discord") because they are what `signIn(id, …)` dispatches on.
 */
export type OAuthProviderId = "google" | "discord";

export interface OAuthProviderMeta {
  id: OAuthProviderId;
  /** Human-facing label, rendered as "Continue with {label}". */
  label: string;
}

export const OAUTH_PROVIDERS: readonly OAuthProviderMeta[] = [
  { id: "google", label: "Google" },
  { id: "discord", label: "Discord" },
];

/**
 * Translate an Auth.js sign-in error code (surfaced as the `?error=` query
 * param when a failed OAuth flow redirects back to `/sign-in`) into copy we
 * can show the user. Returns `null` when there is no error so callers can
 * branch on a single value.
 *
 * `OAuthAccountNotLinked` is the one users actually hit: it fires when someone
 * signs in with a second provider that shares an email with an existing
 * account, because we keep Auth.js's secure no-auto-link default (see
 * `@/auth-providers`). The rest collapse to a generic retry message.
 */
export function authErrorMessage(code: string | null | undefined): string | null {
  if (!code) return null;

  switch (code) {
    case "OAuthAccountNotLinked":
      return "That email is already linked to a different sign-in method. Please continue with the provider you used the first time.";
    case "AccessDenied":
      return "Access was denied. Please try signing in again.";
    case "Configuration":
      return "Sign-in is temporarily unavailable. Please try again later.";
    default:
      return "Something went wrong while signing you in. Please try again.";
  }
}
