<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Web app conventions

## Styling — Tailwind CSS v4 + shadcn/ui (decision)

This app uses **Tailwind CSS v4** (not v3). Rationale: v4 is the default in the
installed Next.js (`next/dist/docs/.../11-css.md`), needs no JS config to run,
and is the version shadcn/ui targets going forward.

- Tailwind is configured **CSS-first**: design tokens live in `app/globals.css`
  inside `@theme` / `:root`, not in `tailwind.config.ts`. The config file only
  declares `content` globs and the dark-mode strategy.
- PostCSS uses `@tailwindcss/postcss` (`postcss.config.mjs`).
- UI primitives are added via **shadcn/ui** into `components/ui`. Config is in
  `components.json`; the `cn()` helper lives in `lib/utils.ts`.
- The app ships **dark by default** — the AniDraft palette is set on `:root` and
  `<html>` carries the `dark` class.

## Structure

- Routes live under `app/` (no `src/`). Route groups: `(marketing)`, `(app)`,
  `(auth)`.
- Path alias `@/*` maps to the app root, so `@/components/ui/button`,
  `@/lib/utils`, etc.

## Visual verification

UI-touching changes need a screenshot artifact (Definition of Done). The
`Web Screenshot` GitHub Actions workflow (`.github/workflows/web-screenshot.yml`)
builds the app, runs every Playwright spec in `e2e/`, and uploads the whole
`apps/web/screenshots/` directory as the `web-screenshots` artifact on every PR
that touches `apps/web`. Run the specs locally with `pnpm --filter web e2e`
(first time: `pnpm --filter web exec playwright install chromium`).

### Authed, data-dependent screenshots

Public pages can be captured from a plain spec, but most routes live under
`(app)` and need a signed-in user plus seeded data. The harness handles both:

- **Auth** — import `test`/`expect` from `./auth` (instead of
  `@playwright/test`). The `auth` fixture (`e2e/auth.ts`) injects a minted
  Auth.js session cookie for the seeded commissioner (`TEST_USER` in
  `e2e/session.ts`), so `(app)` routes render the authenticated UI instead of
  redirecting to `/sign-in`. Keep importing from `@playwright/test` for the
  signed-out path.
- **Data** — `e2e/global-setup.ts` migrates a throwaway libSQL file and seeds
  `TEST_USER`. Seed anything else your page needs (leagues, memberships) from
  inside the spec using the `@libsql/client` patterns in the existing specs.

To add a new authed screenshot:

1. Create `e2e/<feature>.spec.ts` importing from `./auth`.
2. Seed the rows your page reads **inside the test body** (see
   `e2e/settings.spec.ts` for the paired public/private league example). Seed
   in-test rather than in `test.beforeAll` so each fixture is self-contained.
3. `await page.goto("/your/(app)/route")`, assert on the rendered UI, then
   `await page.screenshot({ path: "screenshots/<name>.png", fullPage: true })`.
   Anything written under `screenshots/` is uploaded by the workflow above.

Keep screenshots **deterministic**: pin any time-dependent seed data (e.g. seed
`draftStartsAt` at a fixed UTC instant, as `settings.spec.ts` does). The
Playwright project pins `timezoneId: "UTC"` and the web server runs with
`TZ=UTC` so `datetime-local` inputs render the same wall-clock value everywhere.

`e2e/settings.spec.ts` is the reference example: it seeds one public lobby and
one private league (both owned by the commissioner, both in `setup`) and
captures `settings-public-lobby.png` and `settings-private-league.png` so the
stripped lobby form (max players + draft start + fixed-rules panel) and the full
private form are reviewable side by side.
