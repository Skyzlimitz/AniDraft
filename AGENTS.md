<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:git-agent-rules -->
# Git Workflow Rules

When working with Git and Pull Requests, DO NOT overcomplicate the process or try to forcefully open browsers using terminal commands. Always follow these simple, repeatable steps:

1. **Sync Main**: Run `git checkout main` followed by `git pull origin main` before branching out.
2. **Branch**: Run `git checkout -b <branch_name>` to create a pristine branch.
3. **Commit**: Stage files with `git add` and commit using conventional commit messages (`feat:`, `fix:`, `chore:`).
4. **Push**: Push to remote with `git push -u origin <branch_name>`.
5. **PR Creation**: Agents MAY open the Pull Request directly (via the GitHub tools/API) once the work is pushed. Use a conventional-commit-style title and a body that includes a summary, a Tests section, and `Closes #<N>` when there is a tracking issue. Do NOT merge your own PR. (If PR creation is unavailable, fall back to outputting the compare URL `https://github.com/Skyzlimitz/AniDraft/pull/new/<branch_name>` for the user to click.)
<!-- END:git-agent-rules -->

# AniDraft — Agent Conventions

## Project Structure

This is a **Turborepo monorepo** managed with **pnpm**.

```
apps/
  web/          → Next.js App Router (Vercel)
  realtime/     → WebSocket server (Fly.io)
  cron/         → Weekly snapshot worker (Fly.io)
packages/
  db/           → Drizzle ORM + Turso (libSQL)
  scoring/      → Scoring formula + unit tests
  anilist/      → AniList GraphQL API client
  shared/       → Shared types, Zod schemas, utils
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js (App Router) |
| Language | TypeScript (strict mode) |
| Database | Drizzle ORM + Turso (libSQL) |
| Auth | Auth.js (NextAuth v5) |
| Styling | Tailwind CSS v4 + shadcn/ui |
| Font | Geist (Sans + Mono) |
| Testing | Vitest |
| Linting | ESLint + Prettier |
| Package Manager | pnpm 9.x |
| Monorepo | Turborepo |

## Coding Standards

- **No `any` types** — use `unknown` and narrow
- **Prefer `const` over `let`** — no `var`
- **Use named exports** — avoid default exports (except Next.js pages/layouts)
- **Use server actions** for mutations in `apps/web`
- **Zod validation** on all user inputs (schemas live in `packages/shared`)
- **Tailwind CSS v4** for styling in `apps/web` (CSS-first config via `@theme` in `app/globals.css`); UI primitives come from **shadcn/ui** (`components/ui`). Use CSS Modules only for the rare cases Tailwind utilities can't express. No inline styles.

## Workspace Commands

```bash
pnpm install           # Install all dependencies
pnpm build             # Build all apps + packages
pnpm dev               # Start all apps in dev mode
pnpm lint              # Lint all workspaces
pnpm typecheck         # TypeScript check all workspaces
pnpm test              # Run all tests
pnpm --filter web dev  # Start only the web app
pnpm --filter db build # Build only the db package
```

## GitHub Issues

All work is tracked at: https://github.com/Skyzlimitz/AniDraft/issues

Issues follow this label system:
- `type:epic` — Parent issue tracking a feature area
- `type:task` — Implementation task, ≤1 PR of work
- `type:chore` — Maintenance / non-feature work
- `agent-ready` — Fully spec'd, dependencies met, dispatchable
- `agent-blocked` — Waiting on a decision or upstream issue
- `human-only` — Credentials, billing, or judgment — not for agents
- `priority:p0` — MVP blocker

## Definition of Done

For an issue to be considered done:
1. All acceptance criteria must be met.
2. Verification artifacts (e.g., plan approval, terminal output) must be provided in the PR.
3. Every UI-touching issue requires a browser recording Artifact.
4. Unit tests must be written for every function/module/behavior added or changed, and pass via `pnpm test`.
5. Integration tests (`tests/integration`) must be added or updated for any change that crosses a package/app boundary. See `tests/integration/README.md` for the rules and the pre-PR checklist.
6. The associated GitHub issue must be closed and the `status:in-progress` label removed.

## Hard Rules

- **DO NOT TOUCH:** If an issue says DO NOT TOUCH a file, do not modify it, full stop.
- **Browser Recording:** Every UI-touching issue requires a browser recording Artifact.
- **Environment Variables:** All environment variables must be defined in `.env.example` files across packages, and loaded properly without committing secrets.

## Reviewing PRs (Reviewer Role)

Implementing a change and reviewing it are **separate roles**. When you are
asked to review, look over, or comment on a PR, follow the reviewer workflow in
[`docs/reviewer-role.md`](docs/reviewer-role.md): verify the change against the
real source and the Definition of Done, comment specifically and frugally, and
remember that reviewers recommend — they do not merge their own work.

## Architecture References

- **Scoring Formula:** `packages/scoring` contains the single source of truth for point calculations.
- **State Machines:** Draft and league state transitions must follow the shared state machines in `packages/shared`.

## Autonomous Agent Workflow

You are an autonomous coding agent working on Skyzlimitz/AniDraft. Find your own next task.

### Step 1 — Pick the next task
- Run: `gh issue list --repo Skyzlimitz/AniDraft --state open --label agent-ready --json number,title,labels,body --limit 100`
- Pick the lowest-numbered issue whose Dependencies are all closed. Tie-break: prefer `area:infra` first, then `area:auth`, then everything else.
- Tell the user the issue number and one-sentence reason. WAIT for confirmation.

### Step 2 — Claim the issue (after confirmation)
Do this BEFORE the plan stage so other agents/humans don't double-pick it.

```bash
# Ensure the in-progress label exists (idempotent, only creates on first run)
gh label list --repo Skyzlimitz/AniDraft --json name --jq '.[].name' | grep -qx "status:in-progress" \
  || gh label create "status:in-progress" --repo Skyzlimitz/AniDraft --color "fbca04" \
       --description "An agent is actively working on this issue"

# Claim it: add in-progress, drop agent-ready so no one else grabs it
gh issue edit <N> --repo Skyzlimitz/AniDraft \
  --add-label status:in-progress --remove-label agent-ready

# Announce pickup
gh issue comment <N> --repo Skyzlimitz/AniDraft \
  --body "Picked up by autonomous agent. Producing PLAN.md..."
```

### Step 3 — Per-issue workflow
Follow the standard per-issue workflow:
  load context → verify deps → produce PLAN.md (including the unit-test plan)
  → STOP for plan approval → execute (with unit tests) → open PR with `Closes #<N>`.

Specifically:
- **Write unit tests** for every function/module/behavior you add or change. Tests must pass via `pnpm test`. If the issue genuinely has no testable logic, justify it in PLAN.md and PR.
- **Update integration tests** in `tests/integration` whenever your change crosses a package/app boundary (e.g. a server action wiring `shared` + `db` + `scoring`, or a change to a shared schema/contract). Follow the checklist in `tests/integration/README.md`.
- PR description includes `Closes #<N>`, the approved plan, ticked acceptance criteria with evidence, a Tests section, and verification artifacts.
- Do NOT merge your own PR.

### Step 4 — Close the loop (after PR merges)
- Confirm PR merged: `gh pr view <PR#> --json state`
- Confirm issue auto-closed via "Closes #<N>"; if not:
  `gh issue close <N> --repo Skyzlimitz/AniDraft --comment "Resolved by #<PR>"`
- Remove the in-progress label (works on closed issues too):
  `gh issue edit <N> --repo Skyzlimitz/AniDraft --remove-label status:in-progress`

### Additional Hard rules
- Never pick an `agent-blocked` or `human-only` issue.
- Never review-and-merge your own PR. Reviewing a PR is a separate role — see
  [`docs/reviewer-role.md`](docs/reviewer-role.md).
- Never start coding before the user approves both the picked issue AND the plan.
- No PR without tests for new logic (explicit justification required if none).
- Every completed task must end with the GitHub issue CLOSED and `status:in-progress` removed.
- One issue at a time. Do not batch.
- **If you abandon a task** (blocked, errored, giving up): release the lock.
  `gh issue edit <N> --add-label agent-ready --remove-label status:in-progress` and comment why. Never leave a stale `status:in-progress` label on an issue you're no longer working.
