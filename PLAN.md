# PLAN — Issue #45: Cache-backed `/api/anime/[id]` endpoint

A read-only web endpoint that serves anime metadata + per-episode scores from
the Turso (libSQL) cache **only**. It never calls AniList live, so
user-triggered traffic can't burn the AniList rate limit. The cache is the
`anime` + `episodes` mirror established by issue #39; the season-pool fetcher
(#43) and the cron worker are what populate it.

## Decisions (plan-stage recommendations)

- **Cache reader lives in `apps/web/lib/anime/getCachedAnime.ts`**, HTTP-free, so
  the route stays a thin adapter and the read logic is unit-testable against a
  real migrated libSQL file (the pattern every `lib/leagues/*` reader follows).
  It imports **only** `@anidraft/db` — never `@anidraft/anilist`. That import
  boundary _is_ the "never hits AniList" guarantee.
- **No auth gate.** Anime metadata is public, non-user-scoped data, and the
  whole point of the cache endpoint is to absorb anonymous user traffic. The
  proxy already excludes `/api`, so the route is reachable unauthenticated by
  design. (Contrast the league routes, which gate because they're user-scoped.)
- **Staleness is derived from `episodes.fetched_at`** — the only freshness stamp
  in the schema (`anime` has none). The representative `fetchedAt` is the **most
  recent** episode fetch (episodes are refreshed together, so the newest stamp
  is "when this anime was last refreshed"). `stale = now - fetchedAt > 7 days`.
  An anime row with **no episodes** has no freshness signal, so it reports
  `fetchedAt: null` and `stale: true` (conservative: tells the consumer episode
  data is missing/unrefreshed).
- **`now` is an injectable param** (`= new Date()`) so the 7-day boundary is
  tested deterministically rather than against wall-clock.
- **Id validation:** the route segment must be a positive decimal integer (the
  AniList media id is the `anime` PK). A non-numeric / non-positive id is a
  `400`; a well-formed id that isn't in the cache is a `404`.

## Response shape (`200`)

```jsonc
{
  "anime": {
    "id": 12345,
    "title": "...",
    "romajiTitle": "...",
    "englishTitle": null,
    "format": "TV",
    "season": "SPRING",
    "seasonYear": 2026,
    "startDate": "2026-04-05T00:00:00.000Z",
    "episodesPlanned": 12,
    "coverImageUrl": "https://...",
    "isAdult": false,
  },
  "episodes": [
    {
      "episodeNumber": 1,
      "airDate": "2026-04-12T...",
      "score": 78,
      "fetchedAt": "2026-04-13T...",
    },
  ],
  "fetchedAt": "2026-04-13T...", // most recent episode fetch, or null
  "stale": false,
}
```

## Files

- Create `apps/web/lib/anime/getCachedAnime.ts` — the cache reader.
- Create `apps/web/lib/anime/getCachedAnime.test.ts` — unit tests (real DB).
- Create `apps/web/app/api/anime/[id]/route.ts` — the `GET` handler.
- Create `apps/web/app/api/anime/[id]/route.test.ts` — handler tests.
- Create `tests/integration/src/cached-anime-db.test.ts` — the web-read ↔ `db`
  seam, mirrored against the committed migration chain.

## Tests

- **Unit (`getCachedAnime`)**: hit/miss (404→null), metadata round-trip,
  episodes ordered by number with scores, representative `fetchedAt = max`,
  `stale` true/false either side of the 7-day boundary, no-episodes ⇒
  `stale:true`, and a "fetch stubbed to throw ⇒ still serves cached data" test
  proving the reader has no live network dependency.
- **Unit (route)**: `400` on a non-numeric id, `404` on a cache miss, `200`
  with the cached body, `stale` passthrough, shaped `500`, and an explicit
  "handler performs no `fetch`" assertion.
- **Integration (`cached-anime-db`)**: seed `anime` + `episodes` via
  `@anidraft/db`, mirror the reader's join/staleness derivation, and pin that
  the metadata + per-episode scores read back intact — with `fetch` stubbed to
  throw so an accidental AniList call would fail the test (the verification
  artifact: "with AniList client erroring, the endpoint still serves cache").

## Acceptance criteria → evidence

- [x] GET `/api/anime/12345` returns cached data → route `200` test + reader test
- [x] Never calls AniList directly → import boundary + fetch-stubbed-throws tests
- [x] Returns `stale: true` when data older than 7 days → boundary tests

## Out of scope

UI consumers (separate issues); writing/refreshing the cache (#43 / cron).
