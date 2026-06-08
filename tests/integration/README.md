# Integration Tests

This workspace (`@anidraft/integration-tests`) holds **cross-package**
integration tests for AniDraft. Unlike the per-package unit tests (which live
next to the code they test, e.g. `packages/scoring`), the tests here verify
that packages work **together** — the contracts and data flow _between_
`@anidraft/shared`, `@anidraft/scoring`, `@anidraft/anilist`, `@anidraft/db`,
and the apps.

## Running

```bash
# From the repo root — runs as part of the normal test task
pnpm test

# Just the integration tests
pnpm --filter @anidraft/integration-tests test

# Watch mode while developing
pnpm --filter @anidraft/integration-tests test:watch
```

These tests also run in CI (`.github/workflows/ci.yml`) via `pnpm test`.

## Layout

```
tests/integration/
  src/
    league-lifecycle.test.ts   → create-league + join-league flow (shared)
    scoring-pipeline.test.ts    → anilist media -> scoring contract
  vitest.config.ts
  package.json
```

Add new test files as `src/<feature>.test.ts`.

## 🚨 Agents: update these tests in every PR

**This is a hard requirement, not a suggestion.** When you open a pull request
that adds or changes behavior that crosses a package/app boundary, you MUST add
to or update the integration tests here. Examples of changes that require a new
or updated integration test:

- A new server action, API route, or worker that wires several packages
  together (e.g. validate input → write to `db` → compute a `scoring` value).
- A change to a shared Zod schema, type, or util in `@anidraft/shared` that
  other packages consume.
- A change to the `@anidraft/scoring` formula or its input/output contract.
- A change to the `@anidraft/anilist` client's response shape.
- A change to the `@anidraft/db` schema that other packages read or write.
- Any change to a state machine or end-to-end flow (league setup, drafting,
  weekly snapshots).

### Checklist before opening a PR

- [ ] If my change touches a boundary between two packages/apps, I added or
      updated a test in `tests/integration/src/`.
- [ ] `pnpm --filter @anidraft/integration-tests test` passes locally.
- [ ] `pnpm test` (the full suite, run in CI) passes.
- [ ] The PR description's **Tests** section mentions the integration tests
      I added or updated (or justifies why none were needed).

If a change genuinely has no cross-package behavior to test, say so explicitly
in the PR description — don't silently skip.

## Writing a good integration test

- Test the **seam**, not the internals. Assert on the contract between packages
  (shapes, types, validation results), not on private implementation details.
- Prefer asserting on **contracts** when the far side is still a stub, so the
  test survives the real implementation landing (see `scoring-pipeline.test.ts`
  for an example that pins the shape, not the exact formula output).
- Import packages by their published name (`@anidraft/shared`), not relative
  paths — that's what exercises the real workspace wiring.
- Keep tests deterministic. Don't hit the network; stub or fixture external
  data (e.g. AniList responses).
