# PLAN — Issue #9: Environment variable strategy + `.env.example` files

## Decision 1: Naming convention

**UPPER_SNAKE_CASE, no per-app prefixes.**

Each app deploys to its own platform (web → Vercel, realtime/cron → Fly), so
every app already has an isolated env namespace — a `CRON_`/`WEB_` prefix would
add noise without preventing any real collision. Shared resources keep
**identical names across apps** (`DATABASE_URL`, `DATABASE_AUTH_TOKEN`) so docs,
Fly secrets commands, and grep all line up.

The only prefix is the platform-mandated one: **`NEXT_PUBLIC_`** for web vars
that are inlined into the client bundle. Anything without that prefix is
server-only by definition.

## Decision 2: Where typed validation lives

**`packages/shared/src/env.ts`** (new), exporting:

- `parseEnv(schema, env = process.env)` — generic helper that runs a Zod
  schema and, on failure, throws one aggregated `Error` listing every
  missing/malformed variable by name with its issue, e.g.:

  ```
  ❌ Invalid environment variables:
    - DATABASE_URL: Required (set it in .env / Fly secrets — see docs/env-vars.md)
    - PORT: Expected number, received "abc"
  ```

- Per-app Zod schemas + inferred types: `webEnvSchema`, `realtimeEnvSchema`,
  `cronEnvSchema`, built from shared field schemas (`databaseUrl`, `port`,
  `logLevel`).

Apps call `parseEnv(<schema>)` **once at boot** (entry point) and pass the
typed result down — no scattered `process.env` reads in app code.

### Required vs defaulted (the prod/dev split)

`DATABASE_URL` must fail boot when missing in production (the issue's demo),
but cron/realtime local dev currently boots with zero setup. Convention:

- **In production (`NODE_ENV=production`): `DATABASE_URL` is required** — boot
  throws the clear error above.
- **In dev: defaults to `file:./dev.db`** so `pnpm dev` keeps working with no
  `.env` file.
- Malformed values (`PORT=abc`, `LOG_LEVEL=verbose`) fail boot in **every**
  environment.
- `DATABASE_AUTH_TOKEN` stays optional (not needed for `file:` URLs).

### Per-app schema contents (everything each app reads today)

| App | Variable | Rule |
|-----|----------|------|
| realtime | `PORT` | coerced int 1–65535, default `4000` |
| realtime | `DATABASE_URL` | required in prod, dev default `file:./dev.db` |
| realtime | `DATABASE_AUTH_TOKEN` | optional |
| cron | `DATABASE_URL` / `DATABASE_AUTH_TOKEN` | same as realtime |
| cron | `LOG_LEVEL` | enum `debug\|info\|warn\|error`, default `info` |
| web (server) | `VERCEL_URL` | optional (set by Vercel) |
| web (client) | `NEXT_PUBLIC_REALTIME_URL` | URL, required in prod, dev default `ws://localhost:4000` |

Web wiring: new `apps/web/lib/env.ts` validates at module load and is imported
from the root layout, so a bad env fails the build/boot. `NEXT_PUBLIC_*` values
are referenced literally (`process.env.NEXT_PUBLIC_REALTIME_URL`) because Next
inlines them at build time. (Will re-check `node_modules/next/dist/docs` env
guide before writing this file, per repo rules.)

## Decision 3: Where secrets live per environment

Documented per-variable in the new `docs/env-vars.md`:

| Environment | web | realtime / cron |
|-------------|-----|-----------------|
| Local | `apps/web/.env.local` (git-ignored) | `apps/<app>/.env` (git-ignored) |
| Production | Vercel project env vars (dashboard/CLI) | `fly secrets set ... --app <app>` |
| CI | not needed (no secrets in tests) | not needed (no secrets in tests) |

Actual secret **values** are out of scope (human-only issues).

## Files

- **Create** `packages/shared/src/env.ts` + `src/env.test.ts`; re-export from `src/index.ts`.
- **Create** `apps/web/lib/env.ts`; import it in `app/layout.tsx`.
- **Modify** `apps/realtime/src/index.ts` — `parseEnv(realtimeEnvSchema)` at boot; pass `PORT` through.
- **Modify** `apps/cron/src/index.ts` — parse at boot; pass `LOG_LEVEL` into `createLogger` (logger keeps its own fallback for tests); `src/logger.ts` stops reading `process.env` directly.
- **Modify** all three `.env.example` files — every variable above, each with a comment (purpose, default, where the prod value lives).
- **Create** `docs/env-vars.md` — full variable table + per-environment sourcing + how to add a new variable.

## Test plan

**Unit (`packages/shared/src/env.test.ts`):**
- happy path parses + applies defaults
- missing `DATABASE_URL` with `NODE_ENV=production` → throws, message names the variable
- malformed `PORT` / `LOG_LEVEL` → throws with clear issue text
- multiple failures aggregate into one message
- `DATABASE_AUTH_TOKEN` optional; empty string treated as unset (matches `VAR=` lines in `.env.example`)

**Integration (`tests/integration/src/env-validation.test.ts`)** — shared↔apps
boundary: parse each app's actual `.env.example` file against its schema, so
examples can never drift from the schemas (acceptance criterion #1 becomes
machine-checked). Plus a boot-failure case per app schema in prod mode.

**Demo artifact (for PR):** terminal capture of
`NODE_ENV=production pnpm --filter realtime start` with `DATABASE_URL` unset →
clear boot failure naming the variable; same command with it set → boots.

## Out of scope

- No real secret values anywhere.
- No new env vars beyond what apps/`.env.example`s reference today (auth vars
  land with the Auth.js issue and will extend `webEnvSchema` then).
