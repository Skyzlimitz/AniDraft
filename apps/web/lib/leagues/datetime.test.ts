import { describe, expect, it } from "vitest";

import { toDateTimeLocal } from "./datetime";

describe("toDateTimeLocal", () => {
  it("formats a date as datetime-local from its local parts", () => {
    // Construct from local parts so the assertion is timezone-independent: the
    // helper reads the same local components it should echo back.
    const date = new Date(2026, 5, 27, 9, 5); // 2026-06-27 09:05 local
    expect(toDateTimeLocal(date)).toBe("2026-06-27T09:05");
  });

  it("zero-pads single-digit month, day, hour, and minute", () => {
    const date = new Date(2026, 0, 3, 4, 8); // 2026-01-03 04:08 local
    expect(toDateTimeLocal(date)).toBe("2026-01-03T04:08");
  });

  it("returns an empty string for a null (unscheduled) draft", () => {
    expect(toDateTimeLocal(null)).toBe("");
  });
});
