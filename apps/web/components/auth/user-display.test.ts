import { describe, expect, it } from "vitest";

import { displayName, userInitials } from "./user-display";

describe("displayName", () => {
  it("prefers a trimmed name", () => {
    expect(displayName("  Ada Lovelace  ", "ada@anidraft.test")).toBe(
      "Ada Lovelace",
    );
  });

  it("falls back to email when name is missing or blank", () => {
    expect(displayName(null, "ada@anidraft.test")).toBe("ada@anidraft.test");
    expect(displayName("   ", "ada@anidraft.test")).toBe("ada@anidraft.test");
  });

  it("uses a neutral fallback when nothing is available", () => {
    expect(displayName(null, null)).toBe("Account");
    expect(displayName(undefined, undefined)).toBe("Account");
  });
});

describe("userInitials", () => {
  it("combines first and last name initials", () => {
    expect(userInitials("Ada Lovelace")).toBe("AL");
  });

  it("uses the first two characters of a single token", () => {
    expect(userInitials("captain")).toBe("CA");
  });

  it("ignores extra whitespace between names", () => {
    expect(userInitials("Ada   Byron   Lovelace")).toBe("AL");
  });

  it("derives initials from email when name is absent", () => {
    expect(userInitials(null, "zoe@anidraft.test")).toBe("ZO");
  });

  it("returns a placeholder when there is nothing to use", () => {
    // displayName never returns empty, so the "?" guard is defensive; assert
    // the realistic empty-ish path still yields stable initials.
    expect(userInitials("", "")).toBe("AC");
  });
});
