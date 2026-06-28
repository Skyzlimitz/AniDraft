/**
 * AniList GraphQL client with rate-limit pacing, 429 retry + exponential
 * backoff, and optional authenticated requests (issue #42).
 *
 * Consumers: the cron snapshot worker and the season-pool fetcher (live), and
 * web readers (cache-only — they should read the `anime` / `episodes` mirror in
 * `@anidraft/db`, not call this directly). This module is the single live
 * transport; caching is a separate concern owned by the cron writer.
 *
 * Transport guarantees:
 * - Every request passes through a `Pacer` (default: the process-wide
 *   `sharedPacer`), so the aggregate rate stays under AniList's ~90 req/min cap
 *   across all client instances in-process.
 * - A 429 (or transient 5xx) is retried with the backoff schedule
 *   `[1s, 2s, 4s, 8s, 16s]`, honouring a `Retry-After` header when present.
 *   After the retries are exhausted the call rejects with a typed
 *   `AniListRateLimitError` (429) or `AniListHttpError` (5xx).
 * - A GraphQL-level `errors` array (AniList answers 200 with `errors` for bad
 *   fields) rejects with `AniListGraphQLError`; other 4xx with `AniListHttpError`.
 */

import {
  GET_ANIME_BY_ID_QUERY,
  GET_EPISODE_SCORES_QUERY,
  SEARCH_SEASON_POOL_QUERY,
} from "./queries";
import { Pacer, sharedPacer } from "./pacer";
import type { Anime, EpisodeScore, SeasonPoolFilter } from "./types";

const ANILIST_API_URL = "https://graphql.anilist.co";

/**
 * Backoff waits before each retry, in ms: 1s, 2s, 4s, 8s, 16s. Index `i` is the
 * wait before the `(i+1)`th retry. With the default `maxRetries = 5` this is the
 * full schedule; a `Retry-After` response header overrides the scheduled wait.
 */
export const BACKOFF_SCHEDULE_MS = [1000, 2000, 4000, 8000, 16000] as const;

/** Default number of retries after the initial attempt (→ up to 6 requests). */
export const DEFAULT_MAX_RETRIES = 5;

/** Base class for every error this client throws — lets callers `catch` one type. */
export class AniListError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/**
 * Thrown when a request keeps getting 429 and the retries are exhausted.
 * `attempts` is the total number of requests made (initial + retries).
 */
export class AniListRateLimitError extends AniListError {
  constructor(
    readonly attempts: number,
    readonly retryAfterMs: number | null,
  ) {
    super(
      `AniList rate limit: gave up after ${attempts} attempt(s) (HTTP 429)`,
    );
  }
}

/** A non-retryable HTTP failure (any non-2xx that isn't a retried 429/5xx). */
export class AniListHttpError extends AniListError {
  constructor(
    readonly status: number,
    readonly statusText: string,
  ) {
    super(`AniList HTTP error: ${status} ${statusText}`);
  }
}

/** A GraphQL-level failure (HTTP 200 with a non-empty `errors` array). */
export class AniListGraphQLError extends AniListError {
  constructor(readonly errors: Array<{ message: string }>) {
    super(`AniList GraphQL error: ${errors.map((e) => e.message).join("; ")}`);
  }
}

/** Thrown by `getAnimeById` / `getEpisodeScores` when the media id has no match. */
export class AniListNotFoundError extends AniListError {
  constructor(readonly id: number) {
    super(`AniList media not found: ${id}`);
  }
}

export interface AniListClientOptions {
  /**
   * Bearer token for authenticated requests. Defaults to `process.env.ANILIST_TOKEN`.
   * Read queries work unauthenticated; a token only raises the rate ceiling and
   * is required for viewer-scoped fields the app doesn't use yet.
   */
  token?: string;
  /** GraphQL endpoint. Defaults to `https://graphql.anilist.co`. */
  endpoint?: string;
  /**
   * Pacer enforcing the inter-request gap. Defaults to the process-wide
   * `sharedPacer`, so all clients share one rate window. Pass a dedicated
   * `new Pacer(...)` only to isolate a client (e.g. in a test).
   */
  pacer?: Pacer;
  /** Retries after the initial attempt on 429/5xx. Defaults to 5. */
  maxRetries?: number;
  /** Backoff schedule (ms) per retry. Defaults to `BACKOFF_SCHEDULE_MS`. */
  backoffScheduleMs?: readonly number[];
  /** `fetch` implementation. Defaults to the global `fetch` (injectable for tests). */
  fetchImpl?: typeof fetch;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Read `ANILIST_TOKEN` without depending on `@types/node`. */
function envToken(): string | undefined {
  const env = (
    globalThis as {
      process?: { env?: Record<string, string | undefined> };
    }
  ).process?.env;
  return env?.ANILIST_TOKEN;
}

/** Parse a `Retry-After` header (delta-seconds form) into ms, or null. */
function parseRetryAfterMs(headers: Headers): number | null {
  const raw = headers.get("Retry-After");
  if (raw === null) return null;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null;
}

interface SeasonPoolResponse {
  Page: {
    pageInfo: { currentPage: number; hasNextPage: boolean };
    media: Anime[];
  };
}

interface EpisodeScoresResponse {
  Media: {
    id: number;
    episodes: number | null;
    averageScore: number | null;
    airingSchedule: {
      pageInfo: { hasNextPage: boolean };
      nodes: Array<{ episode: number; airingAt: number | null }>;
    } | null;
  } | null;
}

export class AniListClient {
  private readonly token: string | undefined;
  private readonly endpoint: string;
  private readonly pacer: Pacer;
  private readonly maxRetries: number;
  private readonly backoff: readonly number[];
  private readonly fetchImpl: typeof fetch;

  constructor(options: AniListClientOptions = {}) {
    this.token = options.token ?? envToken();
    this.endpoint = options.endpoint ?? ANILIST_API_URL;
    this.pacer = options.pacer ?? sharedPacer;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.backoff = options.backoffScheduleMs ?? BACKOFF_SCHEDULE_MS;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  /** Wait before retry `attempt` (0-based): the `Retry-After` header if given,
   * else the backoff schedule (clamped to its last entry). */
  private retryDelayMs(attempt: number, retryAfterMs: number | null): number {
    if (retryAfterMs !== null) return retryAfterMs;
    const i = Math.min(attempt, this.backoff.length - 1);
    return this.backoff[i] ?? 0;
  }

  /**
   * POST a GraphQL query, with pacing + retry. Resolves with the `data` payload
   * (never `null`) or rejects with a typed `AniListError` subclass.
   */
  async request<T>(
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    const body = JSON.stringify({ query, variables });

    // attempt 0 is the initial request; 1..maxRetries are retries.
    for (let attempt = 0; ; attempt++) {
      await this.pacer.acquire();
      const response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers,
        body,
      });

      const retryable = response.status === 429 || response.status >= 500;
      if (retryable) {
        if (attempt < this.maxRetries) {
          const retryAfterMs = parseRetryAfterMs(response.headers);
          await sleep(this.retryDelayMs(attempt, retryAfterMs));
          continue;
        }
        // Retries exhausted.
        if (response.status === 429) {
          throw new AniListRateLimitError(
            attempt + 1,
            parseRetryAfterMs(response.headers),
          );
        }
        throw new AniListHttpError(response.status, response.statusText);
      }

      if (!response.ok) {
        throw new AniListHttpError(response.status, response.statusText);
      }

      const json = (await response.json()) as {
        data: T;
        errors?: Array<{ message: string }>;
      };
      if (json.errors && json.errors.length > 0) {
        throw new AniListGraphQLError(json.errors);
      }
      return json.data;
    }
  }

  /** Fetch a single anime's metadata by AniList media id. */
  async getAnimeById(id: number): Promise<Anime> {
    const data = await this.request<{ Media: Anime | null }>(
      GET_ANIME_BY_ID_QUERY,
      { id },
    );
    if (!data.Media) throw new AniListNotFoundError(id);
    return data.Media;
  }

  /**
   * Fetch the per-season draftable pool: TV-format, non-adult anime, most
   * popular first. Walks every page (AniList caps `perPage` at 50) up to
   * `maxPages` (default 10).
   */
  async searchSeasonPool(filter: SeasonPoolFilter): Promise<Anime[]> {
    const { season, year, maxPages = 10 } = filter;
    const all: Anime[] = [];
    for (let page = 1; page <= maxPages; page++) {
      const data = await this.request<SeasonPoolResponse>(
        SEARCH_SEASON_POOL_QUERY,
        { season, seasonYear: year, page, perPage: 50 },
      );
      all.push(...data.Page.media);
      if (!data.Page.pageInfo.hasNextPage) break;
    }
    return all;
  }

  /**
   * Fetch per-episode scores for an anime: one row per scheduled episode, each
   * paired with the show-level `averageScore` (AniList has no per-episode
   * rating). `airingSchedule` is a paginated connection, so every page is walked
   * (up to `maxPages`, AniList caps `perPage` at 50) — a long-running show is not
   * truncated to its first page. When the schedule is empty (e.g. a finished
   * show) but the episode count is known, falls back to `1..episodes` with
   * unknown air dates.
   */
  async getEpisodeScores(
    animeId: number,
    maxPages = 10,
  ): Promise<EpisodeScore[]> {
    const nodes: Array<{ episode: number; airingAt: number | null }> = [];
    let media: EpisodeScoresResponse["Media"] = null;
    for (let page = 1; page <= maxPages; page++) {
      const data = await this.request<EpisodeScoresResponse>(
        GET_EPISODE_SCORES_QUERY,
        { id: animeId, page, perPage: 50 },
      );
      media = data.Media;
      if (!media) throw new AniListNotFoundError(animeId);
      nodes.push(...(media.airingSchedule?.nodes ?? []));
      if (!media.airingSchedule?.pageInfo.hasNextPage) break;
    }
    if (!media) throw new AniListNotFoundError(animeId);

    const score = media.averageScore;
    if (nodes.length > 0) {
      return [...nodes]
        .sort((a, b) => a.episode - b.episode)
        .map((n) => ({
          episode: n.episode,
          airedAt: n.airingAt !== null ? new Date(n.airingAt * 1000) : null,
          score,
        }));
    }

    const count = media.episodes ?? 0;
    return Array.from({ length: count }, (_, i) => ({
      episode: i + 1,
      airedAt: null,
      score,
    }));
  }
}

/**
 * Lazily-created default client, shared by the standalone convenience functions
 * below. Uses the env token and the process-wide `sharedPacer`.
 */
let defaultClient: AniListClient | undefined;
function getDefaultClient(): AniListClient {
  return (defaultClient ??= new AniListClient());
}

/** `getAnimeById` on the default client. See {@link AniListClient.getAnimeById}. */
export function getAnimeById(id: number): Promise<Anime> {
  return getDefaultClient().getAnimeById(id);
}

/** `searchSeasonPool` on the default client. See {@link AniListClient.searchSeasonPool}. */
export function searchSeasonPool(filter: SeasonPoolFilter): Promise<Anime[]> {
  return getDefaultClient().searchSeasonPool(filter);
}

/** `getEpisodeScores` on the default client. See {@link AniListClient.getEpisodeScores}. */
export function getEpisodeScores(animeId: number): Promise<EpisodeScore[]> {
  return getDefaultClient().getEpisodeScores(animeId);
}
