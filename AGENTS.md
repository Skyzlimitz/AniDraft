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
5. **PR Creation**: You do NOT need to create the Pull Request via API or CLI. Simply output the PR creation URL (e.g., `https://github.com/Skyzlimitz/AniDraft/pull/new/<branch_name>`) in the chat and tell the user to click it.
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
| Styling | CSS Modules |
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
- **CSS Modules** for styling — no inline styles, no Tailwind

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
