import type { Logger } from "./logger.js";

/**
 * Milliseconds from `now` until the next Monday at 00:00:00.000 **UTC**.
 *
 * If `now` is exactly Monday 00:00:00.000 UTC we return a full week rather than
 * `0`, so the scheduler never fires an instantaneous, zero-delay tick. All math
 * is in UTC, so daylight-saving transitions are irrelevant.
 */
export function msUntilNextMonday(now: Date): number {
  const next = new Date(now.getTime());
  next.setUTCHours(0, 0, 0, 0);

  // getUTCDay: Sun=0, Mon=1, ... Sat=6. Days from today until the next Monday.
  let daysAhead = (1 - now.getUTCDay() + 7) % 7;
  // Already past (or exactly at) this week's Monday midnight → jump a week.
  if (daysAhead === 0 && now.getTime() >= next.getTime()) {
    daysAhead = 7;
  }

  next.setUTCDate(next.getUTCDate() + daysAhead);
  return next.getTime() - now.getTime();
}

export interface Scheduler {
  /** Stop the scheduler and clear any pending timer. */
  stop(): void;
}

export interface SchedulerOptions {
  logger: Logger;
  /** The job to run each Monday 00:00 UTC. */
  job: () => void | Promise<void>;
  /** Injectable clock for tests. Defaults to `() => new Date()`. */
  now?: () => Date;
  /** Injectable timer for tests. Defaults to the global `setTimeout`. */
  setTimer?: (cb: () => void, ms: number) => ReturnType<typeof setTimeout>;
  /** Injectable timer cleanup for tests. Defaults to the global `clearTimeout`. */
  clearTimer?: (handle: ReturnType<typeof setTimeout>) => void;
}

/**
 * Self-arming weekly scheduler. On start (and after every run) it computes the
 * delay until the next Monday 00:00 UTC, logs `cron worker idle`, and sets a
 * single timer. A week (~6.05e8 ms) is well within the setTimeout 32-bit limit,
 * so no chunking is needed.
 */
export function startScheduler(options: SchedulerOptions): Scheduler {
  const now = options.now ?? (() => new Date());
  const setTimer =
    options.setTimer ?? ((cb, ms) => setTimeout(cb, ms));
  const clearTimer = options.clearTimer ?? ((h) => clearTimeout(h));
  const { logger, job } = options;

  let handle: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  function arm(): void {
    if (stopped) return;
    const current = now();
    const delay = msUntilNextMonday(current);
    const nextRun = new Date(current.getTime() + delay).toISOString();
    logger.info("cron worker idle", { nextRun, delayMs: delay });
    handle = setTimer(() => {
      void run();
    }, delay);
  }

  async function run(): Promise<void> {
    logger.info("cron job triggered", { firedAt: now().toISOString() });
    try {
      await job();
      logger.info("cron job completed");
    } catch (err) {
      logger.error("cron job failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      arm(); // re-arm for the following week
    }
  }

  arm();

  return {
    stop(): void {
      stopped = true;
      if (handle !== undefined) clearTimer(handle);
    },
  };
}
