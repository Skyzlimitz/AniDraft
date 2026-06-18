# Environment Variables

How AniDraft apps read, validate, and source configuration. Every variable an
app reads appears here, in the app's `.env.example`, and in its Zod schema in
[`packages/shared/src/env.ts`](../packages/shared/src/env.ts) — an integration
test (`tests/integration/src/env-validation.test.ts`) keeps the examples and
schemas in sync.

## Convention

- **`UPPER_SNAKE_CASE`, no per-app prefixes.** Each app deploys to its own
  platform (web → Vercel, realtime/cron → Fly), so its env namespace is already
  isolated. Shared resources keep identical names across apps
  (`DATABASE_URL`, `DATABASE_AUTH_TOKEN`).
- The only prefix is Next.js's mandated **`NEXT_PUBLIC_`** for web variables
  inlined into the client bundle. Anything without it is server-only.
- **Typed validation lives in `packages/shared/src/env.ts`.** Each app has a
  schema (`webEnvSchema`, `realtimeEnvSchema`, `cronEnvSchema`); the app calls
  `parseEnv(<schema>)` once at boot and passes the typed result down. App code
  never reads `process.env` directly.
- **Dev defaults, prod required.** Variables with a safe local value (e.g.
  `DATABASE_URL=file:./dev.db`) default in development so `pnpm dev` works with
  zero setup. In production (`NODE_ENV=production`) secrets are required —
  a misconfigured deploy fails at boot with an error naming the variable:

  ```
  Invalid environment variables:
    - DATABASE_URL: required in production — set it as a Fly secret (see docs/env-vars.md)
  See the app's .env.example and docs/env-vars.md for expected values.
  ```

  Malformed values (`PORT=abc`, `LOG_LEVEL=verbose`) fail boot in **every**
  environment.
- Empty values (`DATABASE_AUTH_TOKEN=`) are treated as unset.

## Variables

### `apps/web` — `webEnvSchema`

| Variable | Required | Default (dev) | Description |
|---|---|---|---|
| `AUTH_SECRET` | prod only | — | Auth.js (NextAuth v5) session/token encryption secret. Generate with `openssl rand -base64 32`. |
| `AUTH_URL` | no | — | Canonical app URL for Auth.js callbacks. Leave unset on Vercel (auto-detected). |
| `GOOGLE_CLIENT_ID` | prod only | — | Google OAuth client id (issue #21). Callback `{origin}/api/auth/callback/google`. |
| `GOOGLE_CLIENT_SECRET` | prod only | — | Google OAuth client secret (issue #21). |
| `DISCORD_CLIENT_ID` | prod only | — | Discord OAuth client id (issue #22). Callback `{origin}/api/auth/callback/discord`. |
| `DISCORD_CLIENT_SECRET` | prod only | — | Discord OAuth client secret (issue #22). |
| `DATABASE_URL` | prod only | `file:./dev.db` | Turso (libSQL) connection URL for the Auth.js Drizzle adapter (`createDb()` from `@anidraft/db`). |
| `DATABASE_AUTH_TOKEN` | no | — | Turso auth token; not needed for `file:` URLs. |
| `NEXT_PUBLIC_REALTIME_URL` | prod only | `ws://localhost:4000` | Public URL of the realtime WebSocket server. Inlined into the client bundle at **build** time. |
| `VERCEL_URL` | no | — | Deployment hostname; set automatically by Vercel. |

Validation runs when `apps/web/lib/env.ts` is imported (from the root layout),
so `next build` / `next dev` fail fast. `NEXT_PUBLIC_*` values must be read as
literal `process.env.NEXT_PUBLIC_X` expressions — dynamic lookups are not
inlined into the client bundle.

### `apps/realtime` — `realtimeEnvSchema`

| Variable | Required | Default (dev) | Description |
|---|---|---|---|
| `PORT` | no | `4000` | TCP port for the HTTP/WebSocket server (1–65535). Set via `[env]` in `fly.toml`. |
| `DATABASE_URL` | prod only | `file:./dev.db` | Turso (libSQL) connection URL for `createDb()` from `@anidraft/db`. |
| `DATABASE_AUTH_TOKEN` | no | — | Turso auth token; not needed for `file:` URLs. |

### `apps/cron` — `cronEnvSchema`

| Variable | Required | Default (dev) | Description |
|---|---|---|---|
| `DATABASE_URL` | prod only | `file:./dev.db` | Turso (libSQL) connection URL; feeds the weekly snapshot job (#60). |
| `DATABASE_AUTH_TOKEN` | no | — | Turso auth token; not needed for `file:` URLs. |
| `LOG_LEVEL` | no | `info` | Minimum log level: `debug` \| `info` \| `warn` \| `error`. |

### `packages/db` (tooling only)

`drizzle.config.ts` reads `DATABASE_URL` / `DATABASE_AUTH_TOKEN` from the shell
when running `drizzle-kit` commands. Same names, same sources as the apps.

## Where values come from, per environment

| Environment | `apps/web` | `apps/realtime` / `apps/cron` |
|---|---|---|
| **Local dev** | `apps/web/.env.local` (git-ignored; Next.js auto-loads it) | Dev defaults cover everything. To override: `apps/<app>/.env` (git-ignored) loaded via `tsx --env-file=.env src/index.ts` |
| **Production** | Vercel project env vars (dashboard or `vercel env add`); `VERCEL_URL` is injected by Vercel | Fly secrets: `fly secrets set DATABASE_URL=... DATABASE_AUTH_TOKEN=... --app anidraft-<app>`; `PORT` via `[env]` in `fly.toml` |
| **CI** | tests run on dev defaults; the `Web Screenshot` workflow sets `NEXT_PUBLIC_REALTIME_URL`, `AUTH_SECRET`, and `DATABASE_URL` (throwaway values) for its production `next build` | none needed — tests run on dev defaults |

Secret **values** are never committed; `.gitignore` covers `.env`,
`.env.local`, and `.env.*.local`. Creating/rotating the actual secrets is
tracked in per-app human-only issues.

## Adding a new variable

1. Add it to the app's schema in `packages/shared/src/env.ts` (required in
   prod? dev default? format constraints?) and read it from the parsed env, not
   `process.env`.
2. Add it to the app's `.env.example` with a comment (purpose, default, where
   the prod value lives).
3. Add a row to the table above, plus its production source.
4. Run `pnpm test` — the integration test fails if the `.env.example` and the
   schema disagree.
5. Set the real value in the prod platform (Vercel env / Fly secret) via a
   human-only issue if it's a secret.
