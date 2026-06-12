# PLAN — Issue #8: Deploy pipelines: Vercel (web) + Fly.io (realtime, cron)

## Decision 1: Vercel project config

**Vercel deploys via its native Git integration, not GitHub Actions.** Connecting
the repo to a Vercel project gives preview deploys with unique URLs on every PR
and production deploys on push to the default branch for free — re-implementing
that in Actions would require managing `VERCEL_TOKEN`/org/project IDs and lose
the dashboard integration.

Config split (committed where possible, UI only where unavoidable):

| Setting | Where | Value |
|---------|-------|-------|
| Root Directory | Vercel UI (not a valid `vercel.json` field) | `apps/web` |
| Framework preset | `apps/web/vercel.json` | `nextjs` |
| Install command | `apps/web/vercel.json` | `pnpm install --frozen-lockfile` (runs at workspace root — Vercel auto-detects pnpm workspaces) |
| Build command | `apps/web/vercel.json` | `cd ../.. && pnpm turbo run build --filter=web` |
| Ignore command | `apps/web/vercel.json` | `npx turbo-ignore web` — skips deploys when neither `web` nor its workspace deps changed |

Everything expressible in `vercel.json` is committed so the config is reviewable;
`docs/deploy.md` documents the single UI-only setting (Root Directory) plus the
project-connection steps.

## Decision 2: Fly.io deploy action

**Official `superfly/flyctl-actions/setup-flyctl@master`** (the action Fly
documents and maintains; `@master` is its documented stable tag), then plain
`flyctl deploy --remote-only`. `--remote-only` builds on Fly's builders, so the
workflow needs no Docker setup and stays fast.

Both Dockerfiles `COPY` workspace-root files (`pnpm-workspace.yaml`,
`pnpm-lock.yaml`, `packages/...`), so the **build context must be the repo
root**: run `flyctl deploy . --config apps/<app>/fly.toml --dockerfile
apps/<app>/Dockerfile --remote-only` from the checkout root.

One workflow per app (`deploy-realtime.yml`, `deploy-cron.yml`) as the issue
specifies, each with:

- **Trigger:** `push` to `[main, master]` (repo default is `master`; matching
  `ci.yml` keeps a future rename painless) — PRs never deploy to Fly, so a
  failed/feature branch can't break prod. Plus `workflow_dispatch` for manual
  re-deploys.
- **Paths filter:** the app dir, the packages its Dockerfile copies,
  `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.npmrc`, and
  the workflow file itself. (realtime → `packages/db`, `packages/shared`;
  cron's Dockerfile copies all of `packages/`.)
- **Concurrency:** `group: deploy-<app>`, `cancel-in-progress: false` — deploys
  queue rather than being killed mid-rollout.
- **Post-deploy for cron only:** `flyctl scale count 1` per the instruction in
  `apps/cron/fly.toml` (exactly one always-on machine).

## Decision 3: Secret naming convention

| Secret | Lives in | Used by |
|--------|----------|---------|
| `FLY_API_TOKEN` | GitHub Actions repo secret | Both deploy workflows (one org-scoped deploy token covers both apps; per-app tokens documented as the hardening upgrade) |
| `DATABASE_URL`, `DATABASE_AUTH_TOKEN` | Fly app secrets (`fly secrets set`) per app | realtime + cron at runtime |
| `DATABASE_URL`, `DATABASE_AUTH_TOKEN`, `AUTH_*` etc. | Vercel env vars, scoped per environment | web at build/runtime |

No secrets in the repo; `docs/deploy.md` lists every required secret, where it
lives, and the command/UI path to set it (acceptance criterion).

## Decision 4: Environment promotion strategy

- **Vercel Preview** env vars point at the **staging Turso branch DB**; **Vercel
  Production** env vars point at the **main Turso DB**. Vercel's per-environment
  scoping gives this for free; documented in `docs/deploy.md`.
- **Fly = production only**, deployed exclusively from the default branch.
  Realtime/cron have no preview tier in MVP (PR validation for them is CI:
  lint/typecheck/test); noted as a future option in `docs/deploy.md`.

## Files

- Create `.github/workflows/deploy-realtime.yml` — Fly deploy on push to default branch.
- Create `.github/workflows/deploy-cron.yml` — same for cron + `scale count 1`.
- Create `apps/web/vercel.json` — framework/install/build/ignore commands (the "document choice" answer: config-as-code over UI wherever Vercel allows).
- Create `docs/deploy.md` — architecture, one-time setup (Vercel project, Fly apps, Turso branches), full secrets table, promotion strategy, manual deploy/rollback commands.

## Unit-test justification (no testable logic)

The change is entirely declarative config (two GitHub Actions YAML files, one
`vercel.json`, one Markdown doc) — no functions, modules, or runtime behavior
added, so there is nothing for Vitest to exercise. Verification instead:
`actionlint`/YAML parse of the workflows, JSON validity of `vercel.json`, and
`pnpm lint`/`typecheck`/`test` staying green. No integration tests: no
package/app boundary is crossed at runtime.

## Out of scope (per issue)

Monitoring/alerting. Also not touching `ci.yml`.

## Human prerequisites (cannot be done by the agent)

Vercel project created + repo connected (Root Directory `apps/web`), Fly apps
`anidraft-realtime`/`anidraft-cron` created, `FLY_API_TOKEN` repo secret set,
Turso staging branch created. The workflows are inert until then — they only
run on push to the default branch, and a missing token fails the Action run
without touching prod. All steps spelled out in `docs/deploy.md`.

## Verification

- `actionlint` (or YAML parse) passes on both workflows; `vercel.json` parses.
- `pnpm lint && pnpm typecheck && pnpm test` pass.
- Acceptance criteria #1/#2 (live deploy screenshots) require the human-owned
  Vercel/Fly accounts; the PR will note they're verifiable only post-setup.
