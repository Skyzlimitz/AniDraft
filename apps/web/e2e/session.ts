import { encode } from "next-auth/jwt";

/**
 * Test-only session minting for the e2e suite.
 *
 * OAuth can't be driven headlessly, so rather than clicking through a provider
 * we mint the exact JWT session cookie Auth.js would have set after a real
 * sign-in. The app uses `session: { strategy: "jwt" }` (see `auth.config.ts`),
 * so `auth()` only needs to decrypt this cookie — no provider round-trip, no
 * real account, and nothing to gate out of production: this lives entirely in
 * the test harness.
 *
 * This module deliberately has no `@playwright/test` dependency so the minting
 * logic can be unit-tested directly (`session.test.ts`); the Playwright fixture
 * that injects the cookie lives in `auth.ts`.
 */

/**
 * The session cookie Auth.js sets — and the `salt` it derives the JWT
 * encryption key from. Over an http host (the e2e server) it is the unprefixed
 * name; a secure host would prefix `__Secure-`. See `@auth/core`'s
 * `defaultCookies`.
 */
export const SESSION_COOKIE_NAME = "authjs.session-token";

/** A stable identity the e2e global-setup also seeds into the database. */
export const TEST_USER = {
  id: "e2e-commissioner",
  name: "E2E Commissioner",
  email: "e2e@anidraft.test",
} as const;

/** The `AUTH_SECRET` the server signs/decrypts session JWTs with. */
export function authSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error(
      "AUTH_SECRET must be set for e2e auth — it mints the session cookie and " +
        "must match the value `next start` runs with.",
    );
  }
  return secret;
}

/**
 * Encode the session JWT exactly as Auth.js would. `sub` flows to
 * `session.user.id` via the session callback; `name`/`email` populate the
 * header avatar.
 */
export async function mintSessionCookieValue(
  secret: string = authSecret(),
): Promise<string> {
  return encode({
    salt: SESSION_COOKIE_NAME,
    secret,
    token: { sub: TEST_USER.id, name: TEST_USER.name, email: TEST_USER.email },
  });
}
