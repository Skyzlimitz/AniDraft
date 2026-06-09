# PLAN — Issue #6: Shared packages scaffold (db, scoring, anilist, shared)

## Current state (discovered)

The monorepo bootstrap commit (`59faa5a`) already created shells for all four
packages, and later work (integration tests in `tests/integration`) already
imports from them. So most of this issue's mechanical scaffolding exists:

```
packages/db      → src/index.ts, src/schema/index.ts, tsconfig.json, package.json (exports: ".", "./schema")
packages/scoring → src/index.ts, tsconfig.json, package.json (exports: ".")
packages/anilist → src/index.ts, tsconfig.json, package.json (exports: ".")
packages/shared  → src/index.ts (+ types/schemas/utils), tsconfig.json, package.json (exports: ".", "./schemas", "./types", "./utils")
```

What is **missing** to satisfy the acceptance criteria:

- `apps/web` does not yet import a placeholder type from `@anidraft/shared`
  (acceptance criteria #1 and #3).
- `apps/web/next.config.ts` has no `transpilePackages`, so when an app actually
  imports one of these source-TS packages, `next build` would fail to parse it.

## Plan requirement answers (design decisions)

### 1. `exports` map design

Keep the existing **source-export** maps (point `main`/`types`/`exports` at the
raw `./src/index.ts`). Subpath exports stay as already defined:

- `@anidraft/shared` → `.`, `./schemas`, `./types`, `./utils`
- `@anidraft/db` → `.`, `./schema`
- `@anidraft/scoring` → `.`
- `@anidraft/anilist` → `.`

Rationale: a single source of truth, no stale `dist`, instant HMR, and the
subpaths give consumers tree-shakeable, intention-revealing entry points.

### 2. `tsup` vs. Next.js / Node transpilation

**Do NOT add `tsup`.** Use the Turborepo **"Just-in-Time / internal TypeScript
packages"** strategy — packages ship raw `.ts` and each consumer transpiles:

- **apps/web (Next.js):** add `transpilePackages` for the three workspace deps
  so Next compiles their source. (This is the change this issue adds.)
- **apps/realtime, apps/cron (Node):** run via `tsx` in dev; their own `tsc`
  build resolves the package source for types. (Out of scope to wire runtime
  consumption here — placeholders only.)
- Each package keeps a `tsc` `build`/`typecheck` script so `pnpm -r build` and
  `pnpm typecheck` validate the source and can emit declarations on demand.

Avoiding `tsup` removes a build tool, a watch process, and a class of
stale-artifact bugs while everything is still pre-1.0.

### 3. Build-once vs. build-per-app strategy

**Build-per-app.** Each app transpiles the shared source as part of its own
build/dev (Next via `transpilePackages`, workers via `tsx`/`tsc`). There is no
shared pre-built `dist` artifact that apps depend on at runtime. This keeps the
graph simple and guarantees apps never consume a stale shared build. If a future
deployment target needs pre-compiled output, `tsup` can be introduced per
package without changing consumers' import paths.

## Changes

1. `apps/web/next.config.ts` — add
   `transpilePackages: ["@anidraft/db", "@anidraft/shared", "@anidraft/anilist"]`.
2. `apps/web/src/lib/scaffold.ts` — placeholder module that imports a **value**
   and a **type** from each shared dep (`@anidraft/shared`, `@anidraft/db`,
   `@anidraft/anilist`) and exposes a typed constant. Proves the packages
   resolve and expose their type definitions to `apps/web`. No app UI changes,
   so no browser recording is required.

## Tests

- No new runtime logic is added (placeholders only — per the issue's "Out of
  scope"), so there is no new function/module behavior to unit test. The
  scaffold import is validated by `tsc --noEmit` (the web `typecheck` script,
  also run by `next build`).
- Existing `tests/integration` already exercises the cross-package contracts;
  this change does not cross a new package boundary, so no integration-test
  update is required.

## Verification artifacts

- `pnpm --filter "./packages/*" build` — clean `tsc` build of all four packages.
- `pnpm --filter web typecheck` — `apps/web` typechecks with the new import.
