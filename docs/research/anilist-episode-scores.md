# AniList: Per-Episode Score Availability (SPIKE)

## Question

Does the AniList GraphQL API expose per-episode community scores, or only show-level scores?

## Answer

**Per-episode community scores are NOT available.** AniList only exposes show-level (whole-series) scores. There is no `Episode` type, and none of the episode-related fields (`airingSchedule`, `streamingEpisodes`) carry a score.

## Evidence

Reviewed the full `Media` object schema and every type that references episodes ([AniList/docs](https://github.com/AniList/docs)):

- **`Media`** — score fields are `averageScore: Int` and `meanScore: Int`. Both are aggregated across the entire series, not per episode.
- **`AiringSchedule`** (`Media.airingSchedule`, `Media.nextAiringEpisode`) — fields: `id`, `airingAt`, `timeUntilAiring`, `episode`, `mediaId`, `media`. No score field.
- **`MediaStreamingEpisode`** (`Media.streamingEpisodes`) — fields: `title`, `thumbnail`, `url`, `site`. No score field.
- **`MediaStats`** (`Media.stats`) — `scoreDistribution: [ScoreDistribution]` is a histogram of all-time user scores (10–100) for the whole series, not per episode.
- **`MediaRank`** (`Media.rankings`) — ranks the whole series within a season/year/format. No episode granularity.
- **`MediaTrend`** (`Media.trends`) — this is the closest thing to episode-level data: it's a **daily snapshot** with `date`, `episode` (the episode number released that day, if any), and `averageScore` (the series' weighted average score *as of that day*). `averageScore` is still the cumulative show score, not a score for that specific episode — it just happens to be sampled on the day an episode airs.

No object in the schema represents "this episode was rated X".

Other anime/TV data sources (AniDB, TMDB, Trakt, OMDb/IMDb) do expose true per-episode ratings — see "Alternatives Considered" below — but the decision below is to not use them.

## Decision: Use AniList's Show-Level `averageScore` Directly

Alternative per-episode-capable sources were evaluated (AniDB per-episode `<rating>` votes, TMDB episode `vote_average`, Trakt episode ratings, OMDb/IMDb episode ratings). All are viable but each adds a second data provider, separate rate limits/auth, and weaker anime coverage than AniList for niche/seasonal titles.

**Decision: skip per-episode sourcing entirely. The scoring engine uses AniList's `Media.averageScore` (whole-series score) as the sole score input.** No `Media.trends` sampling, no second API integration. This trades per-episode granularity for simplicity and a single, reliable, already-integrated data source.

### Query shape

```graphql
query ShowScore($mediaId: Int!) {
  Media(id: $mediaId) {
    id
    title {
      romaji
    }
    averageScore
  }
}
```

### Example response

```json
{
  "data": {
    "Media": {
      "id": 21519,
      "title": { "romaji": "Frieren: Beyond Journey's End" },
      "averageScore": 89
    }
  }
}
```

## Impact on Scoring Formula

Any formula component previously described as "per-episode score" must be renamed to "series average score" (`Media.averageScore`). The scoring engine does not vary this input by episode — every episode of a given series uses the same `averageScore` value at score-computation time.

## Alternatives Considered (rejected)

| Source | Per-episode scores? | Why rejected |
|---|---|---|
| AniList `Media.trends` | Show score sampled by air date, not true per-episode | Adds complexity for marginal signal over flat `averageScore` |
| AniDB | Yes (`<rating votes="N">`) | Second API/auth, strict rate limits, thinner coverage for new/niche shows |
| TMDB | Yes (`vote_average` per episode) | Anime metadata/vote volume weaker than anime-native sources |
| Trakt | Yes (rating/votes per episode) | Anime vote counts low; general-TV-skewed userbase |
| OMDb (IMDb) | Yes (`imdbRating` per episode) | Unofficial wrapper, tight free-tier limits, thin anime coverage |

## Conclusion

- [x] Per-episode score availability: **denied** — confirmed only show-level scores exist on AniList.
- [x] Fallback strategy decided: use `Media.averageScore` (whole-series score) directly, no secondary data source.
- [ ] Scoring epic issues should be updated to reflect this before downstream scoring-engine work starts.
