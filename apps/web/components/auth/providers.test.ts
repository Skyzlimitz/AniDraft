import { describe, expect, it } from "vitest";

import {
  OAUTH_PROVIDERS,
  authErrorMessage,
} from "./providers";

describe("OAUTH_PROVIDERS", () => {
  it("lists Google and Discord with ids matching the Auth.js providers", () => {
    expect(OAUTH_PROVIDERS.map((p) => p.id)).toEqual(["google", "discord"]);
  });

  it("gives every provider a non-empty label", () => {
    for (const provider of OAUTH_PROVIDERS) {
      expect(provider.label.length).toBeGreaterThan(0);
    }
  });
});

describe("authErrorMessage", () => {
  it("returns null when there is no error code", () => {
    expect(authErrorMessage(undefined)).toBeNull();
    expect(authErrorMessage(null)).toBeNull();
    expect(authErrorMessage("")).toBeNull();
  });

  it("explains the account-not-linked case specifically", () => {
    expect(authErrorMessage("OAuthAccountNotLinked")).toMatch(
      /already linked/i,
    );
  });

  it("maps the known access-denied and configuration codes", () => {
    expect(authErrorMessage("AccessDenied")).toMatch(/denied/i);
    expect(authErrorMessage("Configuration")).toMatch(/unavailable/i);
  });

  it("falls back to a generic message for unknown codes", () => {
    expect(authErrorMessage("Verification")).toMatch(/something went wrong/i);
    expect(authErrorMessage("totally-made-up")).toMatch(/something went wrong/i);
  });
});
