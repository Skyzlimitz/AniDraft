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

## Fallback Strategy (required, since per-episode scores don't exist)

Use **`Media.trends`**, filtered to entries where `episode` is non-null and `releasing: true`, as a weekly show-level score sample tied to each episode's air date. This gives a score that moves over the course of a season and can be attributed to "the score as of episode N," without claiming it's an episode-specific rating.

### Query shape

```graphql
query EpisodeScoreSamples($mediaId: Int!) {
  Media(id: $mediaId) {
    id
    title {
      romaji
    }
    averageScore
    trends(releasing: true, sort: DATE_DESC) {
      nodes {
        date
        episode
        averageScore
        releasing
      }
    }
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
      "averageScore": 89,
      "trends": {
        "nodes": [
          { "date": 1699920000, "episode": 9, "averageScore": 88, "releasing": true },
          { "date": 1699315200, "episode": 8, "averageScore": 87, "releasing": true },
          { "date": 1698710400, "episode": 7, "averageScore": 86, "releasing": true }
        ]
      }
    }
  }
}
```

## Impact on Scoring Formula

The scoring engine must be updated to treat "episode score" as **the series' cumulative `averageScore` sampled at the time that episode aired**, not an independent per-episode rating. Any formula component described as "per-episode score" should be renamed/documented as "show-level score sampled at episode N" to avoid implying a more granular signal than AniList actually provides.

## Conclusion

- [x] Per-episode score availability: **denied** — confirmed only show-level scores exist.
- [x] Fallback strategy proposed: sample `Media.trends` (show-level `averageScore`) keyed by `episode`/`date`.
- [ ] Scoring epic issues should be updated to reflect this before downstream scoring-engine work starts.
