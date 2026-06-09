import { describe, expect, it, vi } from "vitest";

import type { Logger } from "./logger.js";
import { msUntilNextMonday, startScheduler } from "./scheduler.js";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** A logger that records only `{ level, msg }` so assertions stay readable. */
function fakeLogger(): Logger & { calls: Array<{ level: string; msg: string }> } {
  const calls: Array<{ level: string; msg: string }> = [];
  const make = (level: string) => (msg: string) => {
    calls.push({ level, msg });
  };
  return {
    calls,
    debug: make("debug"),
    info: make("info"),
    warn: make("warn"),
    error: make("error"),
  };
}

describe("msUntilNextMonday", () => {
  it("returns ~1 minute from Sunday 23:59 UTC", () => {
    const now = new Date("2026-06-07T23:59:00.000Z"); // Sunday
    expect(msUntilNextMonday(now)).toBe(60_000);
  });

  it("returns a full week when exactly Monday 00:00 UTC", () => {
    const now = new Date("2026-06-08T00:00:00.000Z"); // Monday
    expect(msUntilNextMonday(now)).toBe(WEEK_MS);
  });

  it("rolls to next week just after Monday midnight", () => {
    const now = new Date("2026-06-08T00:00:01.000Z"); // Monday + 1s
    expect(msUntilNextMonday(now)).toBe(WEEK_MS - 1000);
  });

  it("counts down from mid-week (Wednesday noon)", () => {
    const now = new Date("2026-06-10T12:00:00.000Z"); // Wednesday
    const expected =
      new Date("2026-06-15T00:00:00.000Z").getTime() - now.getTime();
    expect(msUntilNextMonday(now)).toBe(expected);
  });

  it("always lands exactly on a Monday 00:00:00.000 UTC boundary", () => {
    for (let hours = 0; hours < 24 * 7; hours += 5) {
      const now = new Date("2026-06-09T00:00:00.000Z");
      now.setUTCHours(now.getUTCHours() + hours);
      const fire = new Date(now.getTime() + msUntilNextMonday(now));
      expect(fire.getUTCDay()).toBe(1);
      expect(fire.getUTCHours()).toBe(0);
      expect(fire.getUTCMinutes()).toBe(0);
      expect(fire.getUTCSeconds()).toBe(0);
      expect(fire.getUTCMilliseconds()).toBe(0);
    }
  });
});

describe("startScheduler", () => {
  it("logs 'cron worker idle' immediately and arms a timer for the computed delay", () => {
    const logger = fakeLogger();
    const now = () => new Date("2026-06-07T23:59:00.000Z"); // Sunday, 1 min to go
    const setTimer = vi.fn(
      () => 1 as unknown as ReturnType<typeof setTimeout>,
    );
    const clearTimer = vi.fn();

    const scheduler = startScheduler({
      logger,
      job: () => {},
      now,
      setTimer,
      clearTimer,
    });

    expect(logger.calls).toContainEqual({ level: "info", msg: "cron worker idle" });
    expect(setTimer).toHaveBeenCalledWith(expect.any(Function), 60_000);

    scheduler.stop();
    expect(clearTimer).toHaveBeenCalledWith(1);
  });

  it("runs the job when the timer fires and re-arms for the next week", async () => {
    const logger = fakeLogger();
    const now = () => new Date("2026-06-08T00:00:00.000Z"); // Monday boundary
    let fire: (() => void) | undefined;
    const setTimer = vi.fn((cb: () => void) => {
      fire = cb;
      return 1 as unknown as ReturnType<typeof setTimeout>;
    });
    const job = vi.fn();

    startScheduler({ logger, job, now, setTimer, clearTimer: () => {} });
    expect(setTimer).toHaveBeenCalledTimes(1);

    fire?.();
    await vi.waitFor(() => expect(job).toHaveBeenCalledTimes(1));

    expect(setTimer).toHaveBeenCalledTimes(2); // re-armed
  });

  it("re-arms even when the job throws", async () => {
    const logger = fakeLogger();
    const now = () => new Date("2026-06-08T00:00:00.000Z");
    let fire: (() => void) | undefined;
    const setTimer = vi.fn((cb: () => void) => {
      fire = cb;
      return 1 as unknown as ReturnType<typeof setTimeout>;
    });
    const job = vi.fn(() => {
      throw new Error("boom");
    });

    startScheduler({ logger, job, now, setTimer, clearTimer: () => {} });
    fire?.();

    await vi.waitFor(() =>
      expect(logger.calls).toContainEqual({ level: "error", msg: "cron job failed" }),
    );
    expect(setTimer).toHaveBeenCalledTimes(2);
  });

  it("does not arm again after stop()", () => {
    const logger = fakeLogger();
    const now = () => new Date("2026-06-08T00:00:00.000Z");
    let fire: (() => void) | undefined;
    const setTimer = vi.fn((cb: () => void) => {
      fire = cb;
      return 1 as unknown as ReturnType<typeof setTimeout>;
    });

    const scheduler = startScheduler({
      logger,
      job: () => {},
      now,
      setTimer,
      clearTimer: () => {},
    });
    scheduler.stop();
    fire?.(); // late timer callback after stop

    // Only the initial arm happened; the post-run re-arm is suppressed.
    expect(setTimer).toHaveBeenCalledTimes(1);
  });
});
