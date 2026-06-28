# PLAN — Issue #42: `packages/anilist` client with retry + backoff

A GraphQL client for AniList with rate-limit pacing, 429/5xx retry with
exponential backoff, and optional authenticated requests. Used live by the cron
snapshot worker and the season-pool fetcher; web readers should consume the
cached `anime` / `episodes` mirror in `@anidraft/db` rather than calling it.

## Decisions (the plan-stage recommendations)

- **GraphQL client: raw `fetch`.** No `graphql-request`/`urql` dependency. The
  app needs three small queries and one transport policy (pace + retry); a thin
  `fetch` wrapper is fewer moving parts, zero deps, and trivially mockable in
  tests by injecting `fetchImpl`. The existing `queryAniList` in `index.ts`
  already proved the pattern.
- **Auth: `process.env.ANILIST_TOKEN`** read without `@types/node` (a typed
  `globalThis.process` narrow). Read queries work unauthenticated; a token only
  raises the rate ceiling, so it is optional. Added to `.env.example`.
- **Backoff: `[1s, 2s, 4s, 8s, 16s]`, default 5 retries** (initial + 5 = up to
  6 requests). A `Retry-After` response header, when present, overrides the
  scheduled wait.
- **Pacing: one request / 700ms ≈ 85 req/min**, via a process-wide singleton
  `sharedPacer`. Every client that doesn't pass its own pacer shares it, so the
  cap holds across all instances in-process — not just per client.
- **Typed responses: hand-written** (`types.ts`), no codegen. Each query in
  `queries.ts` maps field-for-field to a type, reviewable side by side.

## Files

- `packages/anilist/src/types.ts` — `Anime`, `EpisodeScore`, `SeasonPoolFilter`,
  `AniListSeason`, `AniListFormat` (the canonical home for `AniListSeason`, which
  `index.ts` now imports).
- `packages/anilist/src/pacer.ts` — `Pacer` (slot-reservation spacing) +
  `sharedPacer` singleton + `DEFAULT_MIN_INTERVAL_MS`.
- `packages/anilist/src/queries.ts` — `MEDIA_FIELDS`, `GET_ANIME_BY_ID_QUERY`,
  `SEARCH_SEASON_POOL_QUERY` (TV, `!isAdult`), `GET_EPISODE_SCORES_QUERY`.
- `packages/anilist/src/client.ts` — `AniListClient` (`request`, `getAnimeById`,
  `searchSeasonPool`, `getEpisodeScores`), bound standalone helpers, and typed
  errors (`AniListError`, `AniListRateLimitError`, `AniListHttpError`,
  `AniListGraphQLError`, `AniListNotFoundError`).
- `packages/anilist/src/__tests__/client.test.ts` + `pacer.test.ts` — unit tests,
  HTTP fully mocked via injected `fetchImpl`; backoff timing via fake timers.
- `packages/anilist/src/index.ts` — re-exports the new modules; the legacy thin
  transport (`queryAniList` / `fetchSeasonAnime` / `searchAnime`, issue #36) is
  preserved for its existing consumers.
- `.env.example` (root + package) — `ANILIST_TOKEN`.

## Per-episode scores — why `score` is the show-level value

AniList exposes no per-episode community rating, only one show-level
`averageScore`. So `getEpisodeScores` pairs each scheduled episode (from
`airingSchedule`) with that show-level score at fetch time — exactly what
`episodes.score_when_last_fetched` in `@anidraft/db` stores. When the airing
schedule is empty but the episode count is known, it falls back to
`1..episodes` with unknown air dates.

## Tests

Unit (mocked HTTP): `getAnimeById` typed result + not-found; `searchSeasonPool`
pagination/aggregation/`maxPages`/variables; `getEpisodeScores` mapping, sort,
empty-schedule fallback, not-found; retry resolves after 429; gives up after 5
retries with `AniListRateLimitError` (attempts = 6); custom `maxRetries`; 5xx
retried then `AniListHttpError`; non-429 4xx not retried; GraphQL errors;
backoff timing + `Retry-After` precedence (fake timers); auth header presence.
Pacer: zero-interval, spacing across 2–3 acquisitions, negative-interval guard,
`sharedPacer` default. 29 tests.

## Acceptance criteria coverage

- `getAnimeById(id)` → typed `Anime`. ✓
- `searchSeasonPool({season, year})` → TV, `!isAdult` array (filter in query). ✓
- `getEpisodeScores(animeId)` → per-episode score array. ✓
- 429 retry with backoff, typed give-up error after the retries. ✓
- Pacer enforces ≤85 req/min across all in-process instances (singleton). ✓

## Note on the real-API integration artifact

The required manual integration test against the live AniList API could not be
run from the CI/agent environment: `graphql.anilist.co` is not on the
environment's egress allow-list (the proxy answers `403` to the CONNECT). The
client is otherwise fully exercised by the mocked unit suite; the live check
should be run from a network that permits AniList.

## Out of scope

Caching (cron writer / web reader own it), codegen, the per-episode community
score AniList doesn't expose.
