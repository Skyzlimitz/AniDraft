/**
 * Cron worker entry point.
 *
 * Runs as a single always-on Fly machine. An in-process scheduler
 * (see ./scheduler.ts) fires the weekly snapshot job every Monday 00:00 UTC;
 * between runs the worker logs `cron worker idle` and waits.
 *
 * The snapshot job itself — fetch AniList stats, compute scores via
 * `@anidraft/scoring`, write `weekly_snapshots` via `@anidraft/db` — is
 * implemented under the Scoring epic (#60) and is intentionally a no-op here.
 */
import { createLogger } from "./logger.js";
import { startScheduler } from "./scheduler.js";

const logger = createLogger("cron");

logger.info("cron worker starting", {
  pid: process.pid,
  node: process.version,
});

const scheduler = startScheduler({
  logger,
  job: () => {
    logger.warn("weekly snapshot job not yet implemented", { issue: 60 });
  },
});

function shutdown(signal: NodeJS.Signals): void {
  logger.info("cron worker shutting down", { signal });
  scheduler.stop();
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
