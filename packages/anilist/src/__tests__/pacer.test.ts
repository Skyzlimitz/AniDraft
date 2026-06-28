import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_MIN_INTERVAL_MS, Pacer, sharedPacer } from "../pacer";

/**
 * Tests for the rate-limit pacer (issue #42). Spacing is asserted with fake
 * timers so no real time elapses.
 */

afterEach(() => {
  vi.useRealTimers();
});

describe("Pacer", () => {
  it("resolves immediately with a zero interval", async () => {
    const pacer = new Pacer(0);
    await pacer.acquire();
    await pacer.acquire();
    // Reaching here without a hung promise is the assertion.
    expect(true).toBe(true);
  });

  it("spaces consecutive acquisitions by minIntervalMs", async () => {
    vi.useFakeTimers();
    const pacer = new Pacer(1000);
    const order: string[] = [];

    const first = pacer.acquire().then(() => order.push("first"));
    const second = pacer.acquire().then(() => order.push("second"));

    // The first slot is available now; the second is one interval out.
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual(["first"]);

    await vi.advanceTimersByTimeAsync(999);
    expect(order).toEqual(["first"]);

    await vi.advanceTimersByTimeAsync(1);
    expect(order).toEqual(["first", "second"]);

    await Promise.all([first, second]);
  });

  it("keeps spacing across three acquisitions", async () => {
    vi.useFakeTimers();
    const pacer = new Pacer(500);
    const done: number[] = [];

    void pacer.acquire().then(() => done.push(1));
    void pacer.acquire().then(() => done.push(2));
    void pacer.acquire().then(() => done.push(3));

    await vi.advanceTimersByTimeAsync(0);
    expect(done).toEqual([1]);
    await vi.advanceTimersByTimeAsync(500);
    expect(done).toEqual([1, 2]);
    await vi.advanceTimersByTimeAsync(500);
    expect(done).toEqual([1, 2, 3]);
  });

  it("rejects a negative interval", () => {
    expect(() => new Pacer(-1)).toThrow(RangeError);
  });
});

describe("sharedPacer", () => {
  it("defaults to ~85 req/min (700ms gap), safely under AniList's 90 cap", () => {
    expect(DEFAULT_MIN_INTERVAL_MS).toBe(700);
    expect(sharedPacer.minIntervalMs).toBe(DEFAULT_MIN_INTERVAL_MS);
    expect(60_000 / sharedPacer.minIntervalMs).toBeLessThan(90);
  });
});
