# PLAN — Issue #30: Join league via invite code

Let an authenticated user join a private league by visiting `/join/[code]`,
with friendly, specific messages for every failure mode.

## Files

- Create `apps/web/lib/leagues/joinLeague.ts` — pure domain logic (no HTTP/Next),
  mirrors the `createLeague.ts` shape so it is unit-testable against a real
  migrated libsql DB.
- Create `apps/web/app/api/leagues/join/route.ts` — `POST /api/leagues/join`,
  the JSON wrapper around `joinLeague` (auth gate + Zod validate + shaped
  responses), mirroring `app/api/leagues/route.ts`.
- Create `apps/web/app/(app)/join/[code]/page.tsx` — server component that
  resolves the code, gates on auth (redirect to `/sign-in?callbackUrl=...`),
  runs the join server-side, and renders the outcome message + link.

## Domain logic — `joinLeague(db, userId, code)`

Runs in one transaction and returns a discriminated result so callers render the
right message without parsing strings:

| result           | when                                                       |
| ---------------- | ---------------------------------------------------------- |
| `joined`         | all checks pass; a `player` membership row is inserted     |
| `already_member` | a membership row for (league, user) already exists         |
| `invalid_code`   | code not found (or dangling -> no league)                  |
| `expired`        | code past `expiresAt`, or `uses >= maxUses`                |
| `wrong_state`    | league not in `setup` (carries `leagueStatus` for wording) |
| `league_full`    | active members (`kickedAt IS NULL`) >= `maxPlayers`        |

Check order (most-helpful-message-first): code exists -> league exists ->
already-member -> expired/used-up -> wrong state -> full -> join. On `joined` we
also bump `invite_codes.uses`. The whole thing is one transaction so the
member-count check and the insert can't race two simultaneous joiners past
`maxPlayers`.

The page performs the join on visit (acceptance criterion #1: "visiting ... adds
the user"). This is a GET-triggered write, which is safe here because
`joinLeague` is idempotent — a second visit returns `already_member` and never
inserts twice (the composite PK `(league_id, user_id)` also enforces this).

## Page -> message mapping

`joined` -> "You're in!" + link; `already_member` -> "You're already in this
league" + link; `invalid_code` -> "invite code isn't valid"; `expired` ->
"invite link has expired"; `wrong_state` -> state-specific copy
(finalized/drafting/in_season/completed); `league_full` -> "league is full".

## Tests

- `apps/web/lib/leagues/joinLeague.test.ts` — unit, every result branch against a
  real migrated DB (same harness as `createLeague.test.ts`), plus the
  full-league race and `uses` increment.
- `apps/web/app/api/leagues/join/route.test.ts` — auth gate, bad JSON, Zod
  failure, and the result->status-code mapping (mocked `joinLeague`).
- `tests/integration/src/league-join-flow.test.ts` — create-then-join across
  `@anidraft/shared` + `@anidraft/db` (full, already-member, wrong-state).
- `apps/web/e2e/join-league.spec.ts` — browser artifact: a seeded user visits
  `/join/[code]` for a league they don't own, joins, and a re-visit shows the
  already-member message.

## Acceptance criteria coverage

- Valid `/join/[code]` while authed adds to `league_members` — page + `joined`.
- Already-member message + link — `already_member`.
- Full league message — `league_full`.
- Wrong-state message — `wrong_state` (per-status copy).

## Out of scope

Re-admitting a previously kicked member (kick/transfer flows are separate
issues); a kicked user's existing row currently reads as `already_member`.
