import Discord, { type DiscordProfile } from "next-auth/providers/discord";
import Google, { type GoogleProfile } from "next-auth/providers/google";
import type { Provider } from "next-auth/providers";
import type { User } from "next-auth";

/**
 * OAuth providers for AniDraft, wired with explicit profile-to-User mappers so
 * the columns we persist (see `packages/db/src/schema/auth.ts`: `user.name`,
 * `user.email`, `user.image`) are unambiguous rather than inherited from each
 * provider's upstream defaults.
 *
 * Credentials come from env vars registered in #21/#22 and validated by
 * `webEnvSchema` (packages/shared/src/env.ts). The OAuth `id`s ("google" /
 * "discord") drive the callback paths Auth.js mounts, e.g.
 * `/api/auth/callback/google`.
 *
 * ## Account linking
 *
 * We keep Auth.js's **secure default**: accounts are NOT auto-linked by email.
 * If a user has already signed in with Discord and later signs in with Google
 * using the same email address, Auth.js raises `OAuthAccountNotLinked` instead
 * of merging the two — the second sign-in is refused and the user is asked to
 * return with their original provider. `allowDangerousEmailAccountLinking` is
 * intentionally left off: a provider that returns an unverified email would
 * otherwise let an attacker hijack an existing account by claiming its email.
 * Explicit, user-initiated linking from account settings is a separate issue.
 */

/** Google is OIDC: `sub` is the stable account id, `picture` the avatar URL. */
export function mapGoogleProfile(profile: GoogleProfile): User {
  return {
    id: profile.sub,
    name: profile.name,
    email: profile.email,
    image: profile.picture,
  };
}

/**
 * Build a Discord CDN avatar URL, mirroring the provider's built-in default
 * (`@auth/core/providers/discord`): animated hashes start with `a_` and are
 * served as GIFs; users with no custom avatar fall back to an embed avatar
 * derived from the new username system (discriminator "0") or the legacy tag.
 */
export function discordAvatarUrl(profile: DiscordProfile): string {
  if (profile.avatar === null) {
    const defaultAvatarNumber =
      profile.discriminator === "0"
        ? Number(BigInt(profile.id) >> BigInt(22)) % 6
        : parseInt(profile.discriminator) % 5;
    return `https://cdn.discordapp.com/embed/avatars/${defaultAvatarNumber}.png`;
  }
  const format = profile.avatar.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.${format}`;
}

/** Prefer the display name (`global_name`) over the raw `username`. */
export function mapDiscordProfile(profile: DiscordProfile): User {
  return {
    id: profile.id,
    name: profile.global_name ?? profile.username,
    email: profile.email,
    image: discordAvatarUrl(profile),
  };
}

export const oauthProviders: Provider[] = [
  Google({
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    profile: mapGoogleProfile,
  }),
  Discord({
    clientId: process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
    profile: mapDiscordProfile,
  }),
];
