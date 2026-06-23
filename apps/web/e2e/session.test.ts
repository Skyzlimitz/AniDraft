import { decode } from "next-auth/jwt";
import { describe, expect, it } from "vitest";

import {
  SESSION_COOKIE_NAME,
  TEST_USER,
  mintSessionCookieValue,
} from "./session";

/**
 * Guards the e2e session-minting contract: the cookie we hand Playwright must
 * be a JWT the server can decrypt with the same `AUTH_SECRET` + cookie-name
 * salt, carrying the `sub` the session callback maps to `session.user.id`. If
 * the cookie name (salt) or token shape drifts from what Auth.js expects, every
 * authenticated e2e would silently fall back to signed-out — this fails first.
 */
describe("mintSessionCookieValue", () => {
  const secret = "test-secret-for-session-round-trip";

  it("produces a JWT the server can decode back to the test user", async () => {
    const value = await mintSessionCookieValue(secret);

    const decoded = await decode({
      token: value,
      secret,
      salt: SESSION_COOKIE_NAME,
    });

    expect(decoded?.sub).toBe(TEST_USER.id);
    expect(decoded?.name).toBe(TEST_USER.name);
    expect(decoded?.email).toBe(TEST_USER.email);
  });

  it("is undecodable with the wrong secret", async () => {
    const value = await mintSessionCookieValue(secret);

    await expect(
      decode({ token: value, secret: "a-different-secret", salt: SESSION_COOKIE_NAME }),
    ).rejects.toThrow();
  });
});
