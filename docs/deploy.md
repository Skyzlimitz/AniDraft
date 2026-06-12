# Deployment

How AniDraft ships. Three deploy targets, two pipelines:

| App | Platform | Pipeline | Preview | Production |
|-----|----------|----------|---------|------------|
| `apps/web` | Vercel | Vercel Git integration | every PR → unique preview URL | push to default branch |
| `apps/realtime` | Fly.io | `.github/workflows/deploy-realtime.yml` | — (CI validates PRs) | push to default branch |
| `apps/cron` | Fly.io | `.github/workflows/deploy-cron.yml` | — (CI validates PRs) | push to default branch |

Only pushes to the default branch (`master`, with `main` also wired for a
future rename) trigger production deploys. A failed PR or feature branch can
never touch prod.

## Web (Vercel)

Vercel deploys via its **native Git integration** — no GitHub Actions workflow.
Once the repo is connected to a Vercel project, every PR gets a preview deploy
with a unique URL, and every push to the default branch deploys production.

Config-as-code lives in [`apps/web/vercel.json`](../apps/web/vercel.json):

- `framework: nextjs` — explicit framework preset.
- `installCommand: pnpm install --frozen-lockfile` — pnpm resolves the whole
  workspace from the lockfile (Vercel detects `pnpm-workspace.yaml` above the
  root directory and installs at the repo root).
- `buildCommand: cd ../.. && pnpm turbo run build --filter=web` — builds `web`
  and its workspace dependencies via Turborepo.
- `ignoreCommand: npx turbo-ignore web` — skips the deploy entirely when
  neither `apps/web` nor any of its workspace dependencies changed.

**UI-only setting** (cannot be expressed in `vercel.json`): the project's
**Root Directory** must be set to `apps/web` in
*Vercel → Project → Settings → Build & Development Settings*. Everything else
is committed so it's reviewable in PRs.

### One-time Vercel setup (human)

1. Create a Vercel project and import `Skyzlimitz/AniDraft`.
2. Set **Root Directory** to `apps/web` (leave "Include files outside the root
   directory" enabled — the build needs the workspace).
3. Add the environment variables listed in [Secrets](#secrets), scoping
   **Preview** values to the staging Turso branch and **Production** values to
   the main Turso database.

## Realtime + Cron (Fly.io)

Deployed by GitHub Actions using the official
[`superfly/flyctl-actions/setup-flyctl`](https://github.com/superfly/flyctl-actions)
action, then `flyctl deploy --remote-only` (builds run on Fly's remote
builders — the runner never needs Docker).

Both Dockerfiles copy workspace-root files, so the workflows deploy with the
**repo root as build context**:

```bash
flyctl deploy . --config apps/<app>/fly.toml --dockerfile apps/<app>/Dockerfile --remote-only
```

Workflow behavior (both files, `.github/workflows/deploy-*.yml`):

- **Triggers:** push to `main`/`master`, filtered to paths that affect the
  app's Docker image (the app itself, the packages its Dockerfile copies, the
  lockfile/workspace config), plus `workflow_dispatch` for manual re-deploys
  from the Actions tab.
- **Concurrency:** one deploy at a time per app (`cancel-in-progress: false`),
  so a new push queues instead of killing a rollout midway.
- **Cron only:** after deploying, `flyctl scale count 1` enforces the single
  always-on machine that owns the weekly schedule (see `apps/cron/fly.toml`).

### One-time Fly setup (human)

1. Create the apps (names must match the `fly.toml`s):
   ```bash
   fly apps create anidraft-realtime
   fly apps create anidraft-cron
   ```
2. Create a deploy token and store it as the `FLY_API_TOKEN` GitHub Actions
   secret (*GitHub → Repo → Settings → Secrets and variables → Actions*):
   ```bash
   fly tokens create org
   ```
   Hardening option: create one `fly tokens create deploy --app <app>` token
   per app and split the workflows onto `FLY_API_TOKEN_REALTIME` /
   `FLY_API_TOKEN_CRON`.
3. Set runtime secrets on each app:
   ```bash
   fly secrets set DATABASE_URL=... DATABASE_AUTH_TOKEN=... --app anidraft-realtime
   fly secrets set DATABASE_URL=... DATABASE_AUTH_TOKEN=... --app anidraft-cron
   ```

Until step 2 is done, the workflows fail fast at the deploy step without any
effect on running apps.

## Secrets

| Secret | Where it lives | Consumed by | Notes |
|--------|----------------|-------------|-------|
| `FLY_API_TOKEN` | GitHub Actions repo secret | `deploy-realtime.yml`, `deploy-cron.yml` | Fly org deploy token (`fly tokens create org`) |
| `DATABASE_URL` | Fly app secrets (per app) | realtime, cron | Main (prod) Turso database URL |
| `DATABASE_AUTH_TOKEN` | Fly app secrets (per app) | realtime, cron | Turso auth token for the prod database |
| `DATABASE_URL` | Vercel env var | web | **Production** scope → main Turso DB; **Preview** scope → staging Turso branch |
| `DATABASE_AUTH_TOKEN` | Vercel env var | web | Scoped per environment like `DATABASE_URL` |
| Auth.js secrets (`AUTH_SECRET`, provider IDs/secrets) | Vercel env var | web | Added by the auth issues (#20–#23); same per-environment scoping |

Never commit secret values. Document any new variable in the relevant
`.env.example` and add a row here.

## Environment promotion

- **Preview (staging):** PRs deploy `apps/web` to a unique Vercel preview URL
  whose env vars point at the **staging Turso branch**. Schema changes and
  features are exercised here without touching prod data.
- **Production:** merging to the default branch promotes — Vercel rebuilds web
  against the **main Turso database**, and the Fly workflows roll out realtime
  and cron.
- Fly apps have no preview tier in MVP; PR validation for realtime/cron is the
  CI pipeline (lint, typecheck, test). If preview workers become necessary,
  the same workflows can be extended with per-PR Fly apps later.

## Manual operations

```bash
# Re-run a deploy without a code change: Actions tab → workflow → "Run workflow",
# or locally:
fly deploy . --config apps/realtime/fly.toml --dockerfile apps/realtime/Dockerfile

# Roll back a Fly app to the previous image
fly releases --app anidraft-realtime          # find the prior version
fly deploy --config apps/realtime/fly.toml --app anidraft-realtime --image <previous-image-ref>

# Roll back web: Vercel dashboard → Deployments → ⋯ → "Promote to Production"
# on a previous deployment (instant rollback).
```
