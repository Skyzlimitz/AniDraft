import { describe, expect, it } from "vitest";

import { calculateDraftSize, generateInviteCode, timeAgo } from "./index.js";

describe("generateInviteCode", () => {
  it("produces an 8-character code from the unambiguous alphabet", () => {
    for (let i = 0; i < 100; i++) {
      const code = generateInviteCode();
      expect(code).toHaveLength(8);
      // Only A-Z (minus I/O) and 2-9 — never the easily-confused I/O/0/1.
      expect(code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
      expect(code).not.toMatch(/[IO01]/);
    }
  });

  it("is overwhelmingly unique across many draws", () => {
    const codes = new Set<string>();
    for (let i = 0; i < 1000; i++) codes.add(generateInviteCode());
    // Collisions in a 32^8 space over 1000 draws are astronomically unlikely;
    // a meaningful number of dupes would signal a broken RNG.
    expect(codes.size).toBeGreaterThan(995);
  });
});

describe("calculateDraftSize", () => {
  it("scales the roster down as the league grows", () => {
    expect(calculateDraftSize(2)).toBe(25);
    expect(calculateDraftSize(8)).toBe(6);
    expect(calculateDraftSize(16)).toBe(3);
  });
});

describe("timeAgo", () => {
  it("returns 'just now' for the current instant", () => {
    expect(timeAgo(new Date())).toBe("just now");
  });

  it("pluralizes and picks the largest fitting interval", () => {
    expect(timeAgo(new Date(Date.now() - 1 * 60 * 1000))).toBe("1 minute ago");
    expect(timeAgo(new Date(Date.now() - 2 * 60 * 60 * 1000))).toBe(
      "2 hours ago",
    );
  });
});
