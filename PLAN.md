# PLAN — Issue #31: Public lobby listing page

A site-wide `/lobbies` page listing public leagues that are currently accepting
joiners, with a working "Join" button for each.

## Lifecycle rule (what appears)

A league shows in the lobby **iff** all of:

- `visibility = 'public'` — private leagues are invite-only and never listed;
- `status = 'setup'` — only pre-draft leagues take new players (the same gate
  `joinLeague` enforces);
- **active members < `maxPlayers`** — a full league is not joinable. "Active"
  means `kickedAt IS NULL`, mirroring the seat-counting rule in
  `joinLeague.ts`; a kicked member frees a seat.

The moment a league leaves `setup` or fills its last seat it drops off the
lobby, so every row is genuinely joinable when rendered (the join action
re-checks under a transaction to close the small race).

## List item content

Per row: league **name**, **commissioner** display name (`user.name`, may be
null → "Unknown"), **player count / max** (`memberCount / maxPlayers`),
**season** (`Spring 2026`), **draft time** (`draftStartsAt`, or "Draft time TBD"
when unscheduled), and a **Join** button. If the viewer is already a member
(e.g. the commissioner of their own public league), the button is replaced by a
"You're in" badge so they don't hit an `already_member` error.

## Sort order — recommendation: most-recently-created first

Default `ORDER BY created_at DESC`. Rationale: `draftStartsAt` is **nullable**
(commissioners may schedule the draft later — see `createLeagueSchema`), so
"draft-time ascending" would have to bucket the many null-draft-time lobbies
somewhere arbitrary. Newest-first is well-defined for every row, surfaces fresh
lobbies (which have the most open seats and the longest runway to fill), and is
the least surprising default for a "what's new to join" page. Draft-time sorting
can be added later as an opt-in once scheduling is common.

## Pagination — recommendation: offset (`?page=`)

Offset pagination with a fixed `LOBBY_PAGE_SIZE` (12) and 1-based `?page=N`.
Rationale: the joinable-public-lobby set is small and short-lived (leagues leave
the set as soon as they draft or fill), so the usual offset drawbacks —
expensive deep offsets, drift across pages under heavy insert load — don't bite
at this scale, and offset gives us a simple "Page N of M" control with
prev/next links that a cursor can't express as cleanly. The query is bounded by
`LIMIT/OFFSET`; a sibling `COUNT`-style query yields `totalPages`. If the lobby
ever grows to thousands of concurrent open leagues, switching the data layer to
a keyset cursor is a localized change behind `listLobbies`.

## Join mechanics — public leagues have no invite code

`createLeague` only generates an `invite_codes` row for **private** leagues, so
the existing `/join/[code]` flow cannot join a public lobby league. This issue
therefore adds a code-free, id-keyed public-join path:

- `apps/web/lib/leagues/joinPublicLeague.ts` — pure domain logic
  `joinPublicLeague(db, userId, leagueId)`, mirroring `joinLeague`'s
  one-transaction, idempotent shape. Discriminated result:
  `joined | already_member | not_found | wrong_state | league_full`.
  `not_found` covers both a missing league and a **non-public** one (so the
  endpoint can't be used to gate-crash a private league by id).
- `apps/web/app/(app)/lobbies/actions.ts` — a `"use server"` action wrapping it:
  re-checks `auth()` (redirects a signed-out clicker to
  `/sign-in?callbackUrl=/lobbies`), runs the join, `revalidatePath('/lobbies')`,
  and returns a small state object the button renders.

## Files

- `apps/web/lib/leagues/listLobbies.ts` — `listLobbies(db, {page, pageSize,
  viewerId})` → `{ lobbies, total, page, pageSize, totalPages }`.
- `apps/web/lib/leagues/listLobbies.test.ts` — unit, migrated libsql.
- `apps/web/lib/leagues/joinPublicLeague.ts` + `.test.ts` — unit, every branch +
  the full-league race + public-only guard.
- `apps/web/app/(app)/lobbies/page.tsx` — server component: parse `?page`, call
  `listLobbies`, render the grid + pagination; empty state when none.
- `apps/web/app/(app)/lobbies/actions.ts` — the join server action.
- `apps/web/components/leagues/LobbyCard.tsx` + `JoinLobbyButton.tsx` (client,
  `useActionState` for pending + result feedback).
- `apps/web/proxy.ts` — add `/lobbies` to `PUBLIC_ROUTES` so the lobby is
  browsable signed-out (discovery); the **Join** action still requires auth.
- `apps/web/proxy.test.ts` — cover the new public route.
- `tests/integration/src/lobby-listing-flow.test.ts` — listing + public-join
  across `@anidraft/shared` + `@anidraft/db`.
- `apps/web/e2e/lobbies.spec.ts` — browser artifact: list, join, re-render.

## Tests

Unit: `listLobbies` (lifecycle filter — excludes private / non-setup / full;
sort; pagination math; member counts ignore kicked; viewer flag),
`joinPublicLeague` (all branches, public-only guard, race), the action wrapper
(auth redirect, result mapping), and `proxy` (public route). Integration:
create public leagues then list + join across package boundaries. E2E: seeded
public lobbies, screenshot the list, join one, screenshot the result.

## Acceptance criteria coverage

- Lists public, setup, not-full leagues with name/commissioner/count/draft-time
  + join button → `listLobbies` + `LobbyCard`.
- Pagination → offset `?page=` with `totalPages`.
- Sort default → newest-first.
- Lifecycle (state=setup AND members<max) → the `listLobbies` WHERE/HAVING.

## Out of scope

League detail page (`/leagues/[id]` doesn't exist yet — Join stays on `/lobbies`
and revalidates), draft-time sort option, real-time seat updates.
