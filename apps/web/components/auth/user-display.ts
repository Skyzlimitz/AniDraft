/**
 * Pure presentation helpers for the signed-in user, split out from `UserMenu`
 * so the (slightly fiddly) name/initials logic is unit-testable without
 * rendering a React tree. A user's `name`/`email` can both be null on the
 * Auth.js session, so every helper degrades gracefully.
 */

/** Best available human label: name → email → a neutral fallback. */
export function displayName(
  name?: string | null,
  email?: string | null,
): string {
  if (name && name.trim()) return name.trim();
  if (email && email.trim()) return email.trim();
  return "Account";
}

/**
 * Up to two uppercase initials for the avatar fallback. Uses the first and
 * last whitespace-separated tokens of the display name (e.g. "Ada Lovelace" →
 * "AL"), or the first two characters of a single token.
 */
export function userInitials(
  name?: string | null,
  email?: string | null,
): string {
  const parts = displayName(name, email).split(/\s+/).filter(Boolean);
  const first = parts.at(0);
  const last = parts.at(-1);
  if (!first || !last) return "?";
  if (parts.length === 1) return first.slice(0, 2).toUpperCase();
  return (first.charAt(0) + last.charAt(0)).toUpperCase();
}
