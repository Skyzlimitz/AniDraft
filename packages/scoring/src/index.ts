/**
 * Scoring formula — stub.
 *
 * Implementation will be added by Issue #59:
 * packages/scoring formula implementation + unit tests
 *
 * The formula calculates a weekly score for each anime
 * based on AniList metrics (average score, popularity, trending, etc.)
 */

export interface ScoringInput {
  averageScore: number;
  popularity: number;
  trending: number;
  favourites: number;
  episodesAired: number;
}

export interface ScoringResult {
  weeklyScore: number;
  breakdown: Record<string, number>;
}

/**
 * Calculate the weekly score for an anime.
 * Stub — returns 0 until implemented.
 */
export function calculateWeeklyScore(_input: ScoringInput): ScoringResult {
  return {
    weeklyScore: 0,
    breakdown: {},
  };
}
