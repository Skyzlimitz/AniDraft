# Reviewer Role

This document defines the **reviewer role** for AniDraft: how an agent (or
human) should review a pull request. It is the counterpart to the implementer
role described in [`AGENTS.md`](../AGENTS.md) under *Autonomous Agent Workflow*.

The implementer writes the change; the reviewer is an **independent second
pair of eyes** that checks the change against the codebase, the conventions,
and the Definition of Done before it merges. The two roles are deliberately
separate — see [Hard Rules](#hard-rules).

## When the reviewer role applies

Adopt this role whenever you are asked to "review", "look over", "check", or
"comment on" a PR, or when you receive PR activity events for a PR you are
watching. If you are the one who authored the change, you are **not** acting as
its reviewer (see Hard Rules).

## What to review

Review in roughly this order — cheapest signal first, judgment last.

1. **Does it build and pass?** Check CI status. If CI is unavailable or you
   need to verify locally, check out the branch and run the suite:

   ```bash
   git fetch origin <branch> && git checkout <branch>
   pnpm install
   pnpm lint && pnpm typecheck && pnpm test
   ```

2. **Does it do what it claims?** Read the PR description, then read the diff
   against the actual source. Do not trust the description's claims about
   behavior — **verify assertions against the real code**. If a test asserts
   `calculateDraftSize(8) === 6`, open `packages/shared` and confirm the
   formula actually produces that.

3. **Conventions** (from `AGENTS.md` → *Coding Standards*):
   - No `any` types — `unknown` + narrowing instead.
   - `const` over `let`; never `var`.
   - Named exports (except Next.js pages/layouts).
   - Server actions for mutations in `apps/web`.
   - Zod validation on all user inputs; schemas live in `packages/shared`.
   - CSS Modules for styling — no inline styles, no Tailwind.

4. **Definition of Done** (from `AGENTS.md`): acceptance criteria met,
   verification artifacts present, browser recording for UI-touching changes,
   unit tests for every function/module/behavior added or changed, and the
   linked issue referenced via `Closes #<N>`.

5. **Tests are meaningful, not just present.** Do they test the actual
   behavior, or are they tautological / asserting on stubs in a way that will
   silently rot? Flag assertions that bake in assumptions the description
   explicitly says it is *not* making.

6. **Secrets & config.** No committed secrets; new env vars added to the
   relevant `.env.example`.

7. **Managed blocks.** Edits inside `<!-- BEGIN:* -->` / `<!-- END:* -->`
   marker blocks (e.g. `git-agent-rules`, `nextjs-agent-rules` in `AGENTS.md`)
   are injected/synced from templates and can be overwritten. Flag any change
   inside one and ask whether it belongs in an un-managed section instead.

## How to comment

- **Be specific and actionable.** Comment on the exact line, say what is wrong,
  and propose the fix. "This is confusing" is not a review; "rename
  `episodesAired` — `AniListMedia.episodes` is the total count, not aired" is.
- **Be frugal.** Post only comments that genuinely matter. Do not narrate every
  line or restate what the code obviously does. Skip pure style nits that the
  linter/Prettier already enforce.
- **Distinguish blocking from non-blocking.** Prefix or otherwise mark
  must-fix issues (correctness, security, broken contracts) versus optional
  suggestions (naming, clarity).
- **Use inline comments** for line-specific issues and a single **summary**
  for the overall verdict and cross-cutting concerns.

## Review verdicts

Map your conclusion to exactly one outcome:

| Verdict | Use when |
|---------|----------|
| **Approve** | Meets the DoD and conventions; any remaining comments are optional/non-blocking. |
| **Comment** | Observations worth raising, but no firm accept/reject stance (e.g. you were only asked to "comment where things don't make sense"). |
| **Request changes** | One or more blocking issues: failing/missing tests, broken behavior, convention violations, security problems. |

End every review with a short summary: what you verified, the blocking issues
(if any), and the non-blocking suggestions — in that order.

## Hard Rules

- **Reviewers do not merge.** Approval is a recommendation, not a merge. The
  same person never both authors and merges the same PR.
- **Never review your own change as if independent.** If you wrote the code,
  say so and defer the accept/reject decision to a human or another agent.
- **Do not push to the author's branch** to "just fix it" unless the author or
  user explicitly asks. Surface the issue in a comment instead.
- **Verify, don't assume.** Every behavioral claim in a PR description must be
  checked against the actual source before you rely on it in your review.
- **Read before you flag a deletion or a `DO NOT TOUCH` file.** If a change
  modifies a file an issue marked `DO NOT TOUCH`, that is an automatic blocker.
