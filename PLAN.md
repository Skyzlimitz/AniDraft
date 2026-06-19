# PLAN — Issue #25: Protected routes middleware

Redirect unauthenticated visitors away from every route except the public
allowlist, sending them to `/sign-in` with a `callbackUrl` back to where they
were headed.

## Decision 1: File — `proxy.ts`, not `middleware.ts`

The issue names `apps/web/middleware.ts`, but this Next version (16.2.6)
**renamed middleware to "proxy"** (see `apps/web/AGENTS.md` and the existing
`apps/web/proxy.ts`, which already mounts `NextAuth(authConfig).auth` as the
matched-route handler). There is no `middleware.ts`. We extend the existing
`proxy.ts` — the same layer the issue means.

## Decision 2: Allowlist, not denylist (deny-by-default)

We gate with an **allowlist** of public routes (`/`, `/sign-in`); everything
else requires a session. Rationale: fail-closed. A newly added route is
protected automatically instead of leaking until someone remembers to add it to
a denylist. The list is tiny and unlikely to churn.

The OAuth callback (`/api/auth/*`) is also public but never reaches this logic:
`config.matcher` already excludes every `/api` path from the proxy, so Auth.js's
own endpoints are untouched.

## Decision 3: Where the rule list lives — `proxy.ts`

The allowlist is a two-entry `PUBLIC_ROUTES` constant co-located with the proxy.
A separate config file or DB table would be over-engineering for two paths. The
**decision** is split into a pure `decideProxyAction(pathname, isLoggedIn)`
function so it is unit-testable without constructing a request; the `auth()`
wrapper just translates its result into a `NextResponse`.

## Decision 4: `callbackUrl` is the bare pathname

The redirect target is `/sign-in?callbackUrl=<pathname>` (e.g.
`/sign-in?callbackUrl=/leagues`), matching the acceptance criteria verbatim. A
pathname is a valid URL query value unencoded — RFC 3986 permits `/` in the
query component, and app pathnames contain none of the characters (`?`, `#`,
`&`) that would need escaping. Honoring `callbackUrl` inside the sign-in flow is
**not** changed here: `components/auth/actions.ts` already returns the user to
`/leagues` after sign-in, which satisfies the issue's round-trip artifact. Full
callbackUrl consumption is a sign-in-page concern, deferred.

## Decision 5: API-route auth — documented, deferred

API routes are excluded from `config.matcher`, so the proxy never runs on them.
Each API route handler will do its own `auth()` check when API routes land.
Documented in the `proxy` doc comment; no code here.

## Files

- Modify: `apps/web/proxy.ts` — route-gating logic + public allowlist.
- Modify: `apps/web/proxy.test.ts` — unit tests for the new logic.
- Add: `apps/web/e2e/protected-routes.spec.ts` — browser artifact (redirect +
  public-route reachability).
- Modify: `apps/web/playwright.config.ts` — `AUTH_TRUST_HOST=true` for the test
  server (Vercel sets this implicitly in real deploys; `next start` outside
  Vercel rejects the host as untrusted, which would block the proxy's redirect).

## Unit-test plan (`pnpm test`)

- `isPublicRoute`: public routes true; protected and near-miss prefixes
  (`/sign-in-now`, `/leagues/`) false.
- `decideProxyAction`: authenticated → `next` on any route; unauthenticated →
  `next` on public, `redirect` to `/sign-in?callbackUrl=<path>` on protected,
  preserving nested paths; no redirect loop from `/sign-in`.
- Existing matcher tests retained.

No integration test: the change stays within `apps/web` and crosses no
package/app boundary (it reuses the existing `authConfig`).

## Acceptance criteria → evidence

- [x] `/leagues` unauthenticated → `/sign-in?callbackUrl=/leagues` — verified via
  `curl` (307 + Location) in dev and prod (`AUTH_TRUST_HOST`) modes, and unit
  tests.
- [x] Public routes (`/`, `/sign-in`) reachable unauthenticated — `curl` 200.
- [x] Authenticated user reaches protected routes — `decideProxyAction(_, true)`
  returns `next`; unit-tested.

## Verification artifacts

- Plan: this file.
- Browser recording: `e2e/protected-routes.spec.ts` runs in the Web Screenshot
  workflow, uploading `screenshots/protected-redirect.png` (sign-in page after
  the redirect, URL bar showing `?callbackUrl=/leagues`).
