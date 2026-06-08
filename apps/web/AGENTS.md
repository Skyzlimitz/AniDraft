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
