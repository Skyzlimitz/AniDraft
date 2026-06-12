# PLAN — Issue #5: `apps/cron` weekly snapshot worker scaffold (Fly.io)

## Decision: scheduling mechanism

**Recommendation: in-process scheduler on an always-on Fly machine.**

| Option | Verdict |
|--------|---------|
| **In-process scheduler (chosen)** | Precise Monday 00:00 UTC timing, fully configured in `fly.toml`, naturally logs `cron worker idle` while waiting, dev/prod parity, pure timing fn is unit-testable. |
| Fly native scheduled machine | Rejected: Fly's `schedule` is **not** a valid `fly.toml` field (only the `flyctl machine run --schedule` flag), and the named buckets are coarse — the precise time can't be declared in config. |
| `node-cron` dependency | Rejected: adds a runtime dep + lockfile churn; the testable value lives in our own "next Monday" math, not in node-cron. |

Why Fly (not Render/Vercel): the repo standardizes `apps/cron` and `apps/realtime`
on Fly (AGENTS.md). Vercel is serverless and can't host a persistent process;
Render could but would split the backend across platforms. An always-on Fly
machine mirrors `apps/realtime` and costs pennies/month.

## Logging strategy

Minimal dependency-free **structured JSON** logger → one object per line on
stdout (`{level,time,name,msg,...fields}`). Fly's log shipper aggregates stdout,
so lines are queryable via `fly logs`. Errors go to stderr.

## Turso connection

The worker reads `DATABASE_URL` + `DATABASE_AUTH_TOKEN` from env (Fly **secrets**
in prod) and will pass them to `createDb()` from `@anidraft/db` when the snapshot
job lands (#60). At idle the worker opens no connection, so it boots without
secrets — keeping `pnpm --filter cron dev` runnable locally.

## Files

- `src/logger.ts` — structured JSON logger (injectable sink/clock for tests).
- `src/scheduler.ts` — pure `msUntilNextMonday(now)` + `startScheduler()` that
  arms a timer, logs `cron worker idle`, and re-arms after each fire.
- `src/index.ts` — rewrite: init logger, start scheduler, graceful SIGTERM/SIGINT.
- `src/jobs/.gitkeep` — placeholder for future job modules.
- `src/scheduler.test.ts`, `src/logger.test.ts` — vitest unit tests.
- `fly.toml` — always-on single machine; comment documents Monday 00:00 UTC + secrets.
- `package.json` — fix `start` (`dist/index.js`), add `test`/`test:watch` + vitest.
- `.env.example` — document secrets source + `LOG_LEVEL`.

## Out of scope (per issue)

Snapshot job logic (#60) and DB dump job. No integration test: the idle scaffold
wires no packages together at runtime.

## Verification

- `pnpm --filter cron dev` → logs `cron worker idle`.
- `pnpm --filter cron typecheck` + `pnpm --filter cron test` pass.
- `docker build -f apps/cron/Dockerfile .` succeeds (the step `fly deploy
  --build-only` runs; `flyctl` is not installed in the sandbox).
