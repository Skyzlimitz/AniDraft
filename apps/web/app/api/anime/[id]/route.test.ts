import { beforeEach, describe, expect, it, vi } from "vitest";

// The route pulls in `@/lib/db` (a real libsql client at import time) and the
// cache reader. Mock both so the handler's own behaviour (id validation,
// response shaping) is what gets exercised.
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/anime/getCachedAnime", () => ({ getCachedAnime: vi.fn() }));

import { getCachedAnime } from "@/lib/anime/getCachedAnime";

import { GET } from "./route";

const getCachedAnimeMock = vi.mocked(getCachedAnime);

function getRequest(id: string): Request {
  return new Request(`http://localhost/api/anime/${id}`);
}

function paramsFor(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

const sampleCached = {
  anime: {
    id: 12345,
    title: "Sample Show",
    romajiTitle: "Sample Show",
    englishTitle: null,
    format: "TV" as const,
    season: "SPRING" as const,
    seasonYear: 2026,
    startDate: new Date("2026-04-05T00:00:00.000Z"),
    episodesPlanned: 12,
    coverImageUrl: null,
    isAdult: false,
  },
  episodes: [
    {
      episodeNumber: 1,
      airDate: new Date("2026-04-12T00:00:00.000Z"),
      score: 78,
      fetchedAt: new Date("2026-04-13T00:00:00.000Z"),
    },
  ],
  fetchedAt: new Date("2026-04-13T00:00:00.000Z"),
  stale: false,
};

describe("GET /api/anime/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 for a non-numeric id without hitting the cache", async () => {
    const res = await GET(getRequest("abc"), paramsFor("abc"));
    expect(res.status).toBe(400);
    expect(getCachedAnimeMock).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-positive id", async () => {
    const res = await GET(getRequest("0"), paramsFor("0"));
    expect(res.status).toBe(400);
    expect(getCachedAnimeMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the anime is not in the cache", async () => {
    getCachedAnimeMock.mockResolvedValue(null);

    const res = await GET(getRequest("12345"), paramsFor("12345"));

    expect(res.status).toBe(404);
    expect(getCachedAnimeMock).toHaveBeenCalledWith({}, 12345);
  });

  it("returns 200 with the cached anime data", async () => {
    getCachedAnimeMock.mockResolvedValue(sampleCached);

    const res = await GET(getRequest("12345"), paramsFor("12345"));
    const json = (await res.json()) as {
      anime: { id: number };
      episodes: { score: number }[];
      stale: boolean;
    };

    expect(res.status).toBe(200);
    expect(json.anime.id).toBe(12345);
    expect(json.episodes[0]?.score).toBe(78);
    expect(json.stale).toBe(false);
  });

  it("sets a shared-cache Cache-Control header on the 200", async () => {
    getCachedAnimeMock.mockResolvedValue(sampleCached);

    const res = await GET(getRequest("12345"), paramsFor("12345"));

    expect(res.status).toBe(200);
    const cacheControl = res.headers.get("Cache-Control") ?? "";
    expect(cacheControl).toContain("public");
    expect(cacheControl).toContain("s-maxage=");
    expect(cacheControl).toContain("stale-while-revalidate=");
  });

  it("passes the stale flag through to the response", async () => {
    getCachedAnimeMock.mockResolvedValue({ ...sampleCached, stale: true });

    const res = await GET(getRequest("12345"), paramsFor("12345"));
    const json = (await res.json()) as { stale: boolean };

    expect(res.status).toBe(200);
    expect(json.stale).toBe(true);
  });

  it("serves cached data without the handler performing any fetch", async () => {
    getCachedAnimeMock.mockResolvedValue(sampleCached);
    // The cache reader is mocked, so a real AniList call can only come from the
    // handler itself — stub fetch to throw so any such call fails the test.
    const fetchSpy = vi.fn(() => {
      throw new Error("network is unavailable");
    });
    vi.stubGlobal("fetch", fetchSpy);

    const res = await GET(getRequest("12345"), paramsFor("12345"));

    expect(res.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("returns a shaped 500 when the cache read throws", async () => {
    getCachedAnimeMock.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await GET(getRequest("12345"), paramsFor("12345"));
    const json = (await res.json()) as { error: string };

    expect(res.status).toBe(500);
    expect(json.error).toBe("Failed to load anime");
  });
});
