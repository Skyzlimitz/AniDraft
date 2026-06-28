import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AniListClient,
  AniListGraphQLError,
  AniListHttpError,
  AniListNotFoundError,
  AniListRateLimitError,
  BACKOFF_SCHEDULE_MS,
  DEFAULT_MAX_RETRIES,
} from "../client";
import { Pacer } from "../pacer";
import type { Anime } from "../types";

/**
 * Tests for the AniList client (issue #42). `fetch` is injected per-client so no
 * real network call is made, and a zero-interval `Pacer` plus a zero/short
 * backoff schedule keep the retry tests instant — the timing of the *real*
 * backoff schedule is asserted separately with fake timers.
 */

function anime(id: number, overrides: Partial<Anime> = {}): Anime {
  return {
    id,
    title: { romaji: `Show ${id}`, english: null, native: null },
    format: "TV",
    status: "RELEASING",
    description: null,
    season: "SPRING",
    seasonYear: 2026,
    startDate: { year: 2026, month: 4, day: 1 },
    episodes: 12,
    averageScore: 80,
    meanScore: 81,
    popularity: 1000,
    isAdult: false,
    genres: ["Action"],
    coverImage: { extraLarge: null, large: "l", medium: "m", color: null },
    bannerImage: null,
    siteUrl: `https://anilist.co/anime/${id}`,
    ...overrides,
  };
}

function ok(data: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: new Headers(),
    json: async () => ({ data }),
  } as unknown as Response;
}

function gqlErrors(messages: string[]): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: new Headers(),
    json: async () => ({
      data: null,
      errors: messages.map((m) => ({ message: m })),
    }),
  } as unknown as Response;
}

function httpError(status: number, retryAfter?: number): Response {
  const headers = new Headers();
  if (retryAfter !== undefined) headers.set("Retry-After", String(retryAfter));
  return {
    ok: false,
    status,
    statusText: status === 429 ? "Too Many Requests" : "Error",
    headers,
    json: async () => ({}),
  } as unknown as Response;
}

/** A client wired with an injected fetch, an isolated zero-gap pacer, and a
 * zero backoff schedule (so retries don't actually sleep). */
function testClient(fetchImpl: typeof fetch, opts = {}) {
  return new AniListClient({
    fetchImpl,
    pacer: new Pacer(0),
    backoffScheduleMs: [0, 0, 0, 0, 0],
    ...opts,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("getAnimeById", () => {
  it("returns typed anime metadata", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok({ Media: anime(42) }));
    const client = testClient(fetchImpl);

    const result = await client.getAnimeById(42);

    expect(result.id).toBe(42);
    expect(result.format).toBe("TV");
    expect(result.title.romaji).toBe("Show 42");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("throws AniListNotFoundError when the id has no match", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok({ Media: null }));
    const client = testClient(fetchImpl);

    await expect(client.getAnimeById(999)).rejects.toBeInstanceOf(
      AniListNotFoundError,
    );
  });
});

describe("searchSeasonPool", () => {
  it("walks every page and aggregates the media", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        ok({
          Page: {
            pageInfo: { currentPage: 1, hasNextPage: true },
            media: [anime(1), anime(2)],
          },
        }),
      )
      .mockResolvedValueOnce(
        ok({
          Page: {
            pageInfo: { currentPage: 2, hasNextPage: false },
            media: [anime(3)],
          },
        }),
      );
    const client = testClient(fetchImpl);

    const result = await client.searchSeasonPool({
      season: "SPRING",
      year: 2026,
    });

    expect(result.map((m) => m.id)).toEqual([1, 2, 3]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    // perPage is pinned at AniList's max.
    const firstBody = JSON.parse(
      (fetchImpl.mock.calls[0]![1] as RequestInit).body as string,
    );
    expect(firstBody.variables).toMatchObject({
      season: "SPRING",
      seasonYear: 2026,
      page: 1,
      perPage: 50,
    });
  });

  it("stops at maxPages even if more pages remain", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      ok({
        Page: {
          pageInfo: { currentPage: 1, hasNextPage: true },
          media: [anime(1)],
        },
      }),
    );
    const client = testClient(fetchImpl);

    const result = await client.searchSeasonPool({
      season: "FALL",
      year: 2025,
      maxPages: 3,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(result).toHaveLength(3);
  });
});

describe("getEpisodeScores", () => {
  it("pairs each scheduled episode with the show score, sorted by episode", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      ok({
        Media: {
          id: 7,
          episodes: 3,
          averageScore: 77,
          airingSchedule: {
            pageInfo: { hasNextPage: false },
            nodes: [
              { episode: 2, airingAt: 2000 },
              { episode: 1, airingAt: 1000 },
            ],
          },
        },
      }),
    );
    const client = testClient(fetchImpl);

    const result = await client.getEpisodeScores(7);

    expect(result).toEqual([
      { episode: 1, airedAt: new Date(1_000_000), score: 77 },
      { episode: 2, airedAt: new Date(2_000_000), score: 77 },
    ]);
    // perPage is pinned at AniList's max for the airingSchedule connection.
    const firstBody = JSON.parse(
      (fetchImpl.mock.calls[0]![1] as RequestInit).body as string,
    );
    expect(firstBody.variables).toMatchObject({ id: 7, page: 1, perPage: 50 });
  });

  it("walks every airingSchedule page until hasNextPage is false", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        ok({
          Media: {
            id: 9,
            episodes: 3,
            averageScore: 60,
            airingSchedule: {
              pageInfo: { hasNextPage: true },
              nodes: [
                { episode: 1, airingAt: 1000 },
                { episode: 2, airingAt: 2000 },
              ],
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        ok({
          Media: {
            id: 9,
            episodes: 3,
            averageScore: 60,
            airingSchedule: {
              pageInfo: { hasNextPage: false },
              nodes: [{ episode: 3, airingAt: 3000 }],
            },
          },
        }),
      );
    const client = testClient(fetchImpl);

    const result = await client.getEpisodeScores(9);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.map((e) => e.episode)).toEqual([1, 2, 3]);
    const secondBody = JSON.parse(
      (fetchImpl.mock.calls[1]![1] as RequestInit).body as string,
    );
    expect(secondBody.variables).toMatchObject({ id: 9, page: 2, perPage: 50 });
  });

  it("stops at maxPages even if more schedule pages remain", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      ok({
        Media: {
          id: 10,
          episodes: null,
          averageScore: 50,
          airingSchedule: {
            pageInfo: { hasNextPage: true },
            nodes: [{ episode: 1, airingAt: 1000 }],
          },
        },
      }),
    );
    const client = testClient(fetchImpl);

    const result = await client.getEpisodeScores(10, 2);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.map((e) => e.episode)).toEqual([1, 1]);
  });

  it("falls back to 1..episodes when the airing schedule is empty", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      ok({
        Media: {
          id: 8,
          episodes: 2,
          averageScore: null,
          airingSchedule: { pageInfo: { hasNextPage: false }, nodes: [] },
        },
      }),
    );
    const client = testClient(fetchImpl);

    const result = await client.getEpisodeScores(8);

    expect(result).toEqual([
      { episode: 1, airedAt: null, score: null },
      { episode: 2, airedAt: null, score: null },
    ]);
  });

  it("throws AniListNotFoundError when the media is missing", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok({ Media: null }));
    const client = testClient(fetchImpl);

    await expect(client.getEpisodeScores(404)).rejects.toBeInstanceOf(
      AniListNotFoundError,
    );
  });
});

describe("retry + backoff", () => {
  it("retries a 429 then resolves on success", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(httpError(429))
      .mockResolvedValueOnce(httpError(429))
      .mockResolvedValueOnce(ok({ Media: anime(1) }));
    const client = testClient(fetchImpl);

    const result = await client.getAnimeById(1);

    expect(result.id).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("gives up after the default retries with a typed AniListRateLimitError", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(httpError(429));
    const client = testClient(fetchImpl);

    const error = await client.getAnimeById(1).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AniListRateLimitError);
    expect((error as AniListRateLimitError).attempts).toBe(
      DEFAULT_MAX_RETRIES + 1,
    );
    // initial attempt + DEFAULT_MAX_RETRIES retries.
    expect(fetchImpl).toHaveBeenCalledTimes(DEFAULT_MAX_RETRIES + 1);
  });

  it("honours a custom maxRetries", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(httpError(429));
    const client = testClient(fetchImpl, { maxRetries: 2 });

    await expect(client.getAnimeById(1)).rejects.toBeInstanceOf(
      AniListRateLimitError,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("retries transient 5xx then throws AniListHttpError when exhausted", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(httpError(503));
    const client = testClient(fetchImpl, { maxRetries: 1 });

    const error = await client.getAnimeById(1).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AniListHttpError);
    expect((error as AniListHttpError).status).toBe(503);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not retry a non-429 4xx", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(httpError(400));
    const client = testClient(fetchImpl);

    await expect(client.getAnimeById(1)).rejects.toBeInstanceOf(
      AniListHttpError,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("surfaces GraphQL-level errors without retrying", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(gqlErrors(["bad field"]));
    const client = testClient(fetchImpl);

    const error = await client.getAnimeById(1).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AniListGraphQLError);
    expect((error as Error).message).toContain("bad field");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("waits the scheduled backoff between retries", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(httpError(429))
      .mockResolvedValueOnce(ok({ Media: anime(1) }));
    const client = new AniListClient({
      fetchImpl,
      pacer: new Pacer(0),
      backoffScheduleMs: [5000],
      maxRetries: 1,
    });

    let settled = false;
    const promise = client.getAnimeById(1).then((r) => {
      settled = true;
      return r;
    });

    // Let the initial request + 429 handling run; the backoff timer is now armed.
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(4999);
    expect(settled).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    const result = await promise;
    expect(result.id).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("prefers a Retry-After header over the backoff schedule", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(httpError(429, 2)) // Retry-After: 2s
      .mockResolvedValueOnce(ok({ Media: anime(1) }));
    const client = new AniListClient({
      fetchImpl,
      pacer: new Pacer(0),
      backoffScheduleMs: [60000], // would be a minute without the header
      maxRetries: 1,
    });

    const promise = client.getAnimeById(1);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(2000);

    const result = await promise;
    expect(result.id).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe("authentication", () => {
  it("sends a bearer token when one is supplied", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok({ Media: anime(1) }));
    const client = testClient(fetchImpl, { token: "secret-token" });

    await client.getAnimeById(1);

    const headers = (fetchImpl.mock.calls[0]![1] as RequestInit)
      .headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer secret-token");
  });

  it("omits the Authorization header when no token is set", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok({ Media: anime(1) }));
    const client = testClient(fetchImpl, { token: undefined });

    await client.getAnimeById(1);

    const headers = (fetchImpl.mock.calls[0]![1] as RequestInit)
      .headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });
});

describe("constants", () => {
  it("uses the 1s/2s/4s/8s/16s backoff schedule by default", () => {
    expect(BACKOFF_SCHEDULE_MS).toEqual([1000, 2000, 4000, 8000, 16000]);
    expect(DEFAULT_MAX_RETRIES).toBe(5);
  });
});
