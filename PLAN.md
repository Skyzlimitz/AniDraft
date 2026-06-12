# PLAN — Issue #20: Auth.js (NextAuth v5) setup in apps/web

## Decision 1: Auth.js v5 (confirmed) — `next-auth@5.0.0-beta.31`

v5 is the App Router-native line: it provides the universal `auth()` helper,
`handlers` for the route handler, and first-class server-component support.
v4 (`latest` npm tag) predates the App Router model and its
`getServerSession(authOptions)` ergonomics are deprecated going forward.
v5 ships under the `beta` npm dist-tag (`5.0.0-beta.31`), but it is what the
official Auth.js docs install and its peer range explicitly includes
`next ^16.0.0` and `react ^19` (verified against the registry) — matching our
`next@16.2.6` / `react@19.2.4`. **Pin the exact beta version** in
`apps/web/package.json` so a future beta can't drift in silently.

Adapter: `@auth/drizzle-adapter@1.11.2`.

## Decision 2: Session strategy — **JWT** (encrypted cookie), not database

- **Works in `proxy.ts` without a DB round-trip.** The route-protection
  middleware must check the session on every matched request; with JWT the
  check is local cookie decryption. Database sessions would add a Turso
  round-trip per request and couple the proxy layer to the DB.
- **Turso write economics.** Database sessions write on sign-in and update on
  rolling expiry; JWT sessions cost zero DB operations.
- **The adapter is still used** (for persisting users/accounts at sign-in time
  and OAuth account linking, once providers land), so we lose nothing for #21/#22.
- Tradeoff accepted for MVP: JWT sessions can't be revoked server-side before
  expiry. Acceptable for a hobby league app; revisit if we need admin bans.

`strategy: "jwt"` is set explicitly (the adapter's presence would otherwise
flip the default to `"database"`). The JWT/session callbacks copy `user.id`
(`token.sub`) onto `session.user.id` so server code can key DB rows by user id.

## Decision 3: Drizzle adapter + the #39 circularity

#20 says auth tables "will be created in the schema task" (#39); #39 says
"`users` is created by Auth.js adapter; we add app-specific columns". The
adapter cannot be wired without table objects existing at compile time, so one
issue must own the base tables. **Recommendation: #20 owns the standard
Auth.js tables**, since #20 is the issue that must compile against them and
the auth-table shape is dictated by the adapter contract, not by app design:

- Create `packages/db/src/schema/auth.ts` with the four canonical Auth.js
  SQLite tables exactly per the adapter spec: `users`, `accounts`, `sessions`,
  `verificationTokens`. No app-specific columns — `display_name` etc. stay
  in #39, which will extend `users` in place.
- Export them from `packages/db/src/schema/index.ts` (keeps the documented
  `#39/#40/#41` comment for the remaining stubs).
- Add `createDb` schema wiring so `db` instances are schema-aware.
- **No migration generated here** — #39's files list owns "Create migration
  via drizzle-kit", and generating one now would force #39 into a second
  migration for its column additions. The acceptance criterion "Drizzle
  adapter writes to expected tables" is structurally satisfied (adapter bound
  to real table objects, typechecked); the live write round-trip lands with
  #39's migration, as the criterion's own parenthetical anticipates.

This is a deliberate deviation from the issue's Files list (it touches
`packages/db`) — flagged here for plan approval.

## Decision 4: Where `auth()` lives + file deviations for Next 16

- **Create `apps/web/auth.ts`** (repo-root-of-app, per Auth.js convention):
  `export const { handlers, auth, signIn, signOut } = NextAuth({...})`.
  Server components / server actions / route handlers import
  `import { auth } from "@/auth"` (the `@/*` alias → `apps/web/*` exists).
- **Create `apps/web/app/api/auth/[...nextauth]/route.ts`**: re-export
  `GET`/`POST` from `handlers`.
- **Create `apps/web/proxy.ts` — NOT `middleware.ts`.** The issue predates
  Next 16: in `next@16.2.6` the `middleware` file convention is deprecated and
  renamed to `proxy` (verified in `node_modules/next/dist/docs/.../proxy.md`;
  Node.js runtime, same matcher semantics). Deviation flagged for approval.
  The proxy only refreshes/validates the session cookie via `auth` as the
  exported handler with a matcher that excludes `/api`, static assets, and
  favicon — **no route protection rules yet** (no sign-in UI exists; gating
  specific routes belongs to the sign-in/UI issues).
- `providers: []` — explicitly empty; Google/Discord are #21/#22.
  `trustHost: true` is NOT needed (Vercel sets it); rely on `AUTH_SECRET` env.

## Decision 5: Env vars

`apps/web/.env.example` gains:

```
AUTH_SECRET=   # openssl rand -base64 32
AUTH_URL=      # http://localhost:3000 locally; unset on Vercel (auto-detected)
```

Root `.env.example` already lists `AUTH_SECRET` (and Discord vars for #22) —
unchanged. `apps/web` reads `DATABASE_URL` / `DATABASE_AUTH_TOKEN` (same names
as root `.env.example`) to build the adapter's db instance via a new
`apps/web/lib/db.ts` (`createDb(process.env.DATABASE_URL ?? "file:./dev.db", ...)`),
so the app boots without Turso credentials in dev.

## Files

- Create `packages/db/src/schema/auth.ts` — canonical Auth.js tables (users, accounts, sessions, verificationTokens).
- Modify `packages/db/src/schema/index.ts` — export auth tables.
- Create `apps/web/auth.ts` — NextAuth config: Drizzle adapter, JWT strategy, empty providers, session callback exposing `user.id`.
- Create `apps/web/lib/db.ts` — singleton db instance for the web app.
- Create `apps/web/app/api/auth/[...nextauth]/route.ts` — `export const { GET, POST } = handlers`.
- Create `apps/web/proxy.ts` — auth middleware (Next 16 name), asset-excluding matcher.
- Modify `apps/web/package.json` — `next-auth` (pinned beta), `@auth/drizzle-adapter`.
- Modify `apps/web/.env.example` — `AUTH_SECRET`, `AUTH_URL`.

## Tests

- **Unit (`apps/web`)**: `auth.test.ts` — config assertions: providers empty,
  `strategy === "jwt"`, session callback maps `token.sub` → `session.user.id`;
  `proxy.test.ts` — matcher excludes `/api/auth`, `_next/static`, includes app
  routes (exercise the exported `config.matcher` regex).
- **Integration (`tests/integration/src/auth-db.test.ts`)** — required: this
  change crosses the web↔db boundary. Bind `DrizzleAdapter` to an in-memory
  libsql db (`file::memory:`), apply the auth-table DDL via
  `drizzle-kit`-generated SQL pushed inline (no committed migration),
  round-trip `createUser`/`getUser` through the adapter against
  `@anidraft/db` schema objects. This is also the executable evidence for
  acceptance criterion 3.
- **Manual verification artifact**: `pnpm --filter web dev`, then
  `curl http://localhost:3000/api/auth/session` → `null` body with 200 —
  captured terminal output goes in the PR.

## Out of scope (per issue)

No Google/Discord providers, no sign-in UI, no route-gating rules, no
drizzle-kit migration files (owned by #39).

## Verification

- `pnpm lint && pnpm typecheck && pnpm test` green at root.
- Dev server boots with no env beyond defaults; `/api/auth/session` returns
  `null` (200) unauthenticated — curl output in PR.
- Integration test proves adapter writes/reads the schema tables.
