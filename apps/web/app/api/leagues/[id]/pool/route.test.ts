import { beforeEach, describe, expect, it, vi } from "vitest";

// The route pulls in `@/auth`, `@/lib/db`, the pool domain logic, and the
// AniList-backed fetcher/searcher, all of which touch validated env / a real
// libsql client or network at import time. Mock them so the handler's own
// behaviour (auth gate, validation, response shaping) is what gets exercised.
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/leagues/seasonPool", () => ({
  fetchSeasonPool: vi.fn(),
  searchPool: vi.fn(),
}));
vi.mock("@/lib/leagues/poolEditor", () => ({
  getPoolEditor: vi.fn(),
  searchPoolCandidates: vi.fn(),
  updatePoolOverrides: vi.fn(),
}));

import { auth } from "@/auth";
import {
  getPoolEditor,
  searchPoolCandidates,
  updatePoolOverrides,
} from "@/lib/leagues/poolEditor";

import { GET, PUT } from "./route";

const authMock = vi.mocked(auth);
const getMock = vi.mocked(getPoolEditor);
const searchMock = vi.mocked(searchPoolCandidates);
const updateMock = vi.mocked(updatePoolOverrides);

const params = Promise.resolve({ id: "league-1" });

function getRequest(search?: string): Request {
  const url = search
    ? `http://localhost/api/leagues/league-1/pool?search=${encodeURIComponent(search)}`
    : "http://localhost/api/leagues/league-1/pool";
  return new Request(url);
}

function putRequest(body: unknown): Request {
  return new Request("http://localhost/api/leagues/league-1/pool", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const sampleView = {
  leagueId: "league-1",
  leagueName: "Pool League",
  season: "SPRING" as const,
  seasonYear: 2026,
  status: "setup" as const,
  frozen: false,
  entries: [],
};

describe("GET /api/leagues/[id]/pool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects an unauthenticated request with 401", async () => {
    authMock.mockResolvedValue(null as never);
    const res = await GET(getRequest(), { params });
    expect(res.status).toBe(401);
    expect(getMock).not.toHaveBeenCalled();
  });

  it("returns the editor view with 200", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } } as never);
    getMock.mockResolvedValue({ status: "ok", view: sampleView });

    const res = await GET(getRequest(), { params });
    const json = (await res.json()) as { view: { leagueId: string } };

    expect(res.status).toBe(200);
    expect(json.view.leagueId).toBe("league-1");
  });

  it("returns 404 for an unknown league", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } } as never);
    getMock.mockResolvedValue({ status: "not_found" });
    const res = await GET(getRequest(), { params });
    expect(res.status).toBe(404);
  });

  it("returns 403 for a non-commissioner", async () => {
    authMock.mockResolvedValue({ user: { id: "user-2" } } as never);
    getMock.mockResolvedValue({ status: "forbidden" });
    const res = await GET(getRequest(), { params });
    expect(res.status).toBe(403);
  });

  it("returns 403 for a public-lobby commissioner", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } } as never);
    getMock.mockResolvedValue({ status: "public_unsupported" });
    const res = await GET(getRequest(), { params });
    const json = (await res.json()) as { error: string };
    expect(res.status).toBe(403);
    expect(json.error).toContain("fixed pool");
  });

  it("routes a ?search= query to the search path", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } } as never);
    searchMock.mockResolvedValue({
      status: "ok",
      results: [{ anilistId: 1, title: "Found", coverImage: null }],
    });

    const res = await GET(getRequest("found"), { params });
    const json = (await res.json()) as {
      results: { title: string }[];
    };

    expect(res.status).toBe(200);
    expect(getMock).not.toHaveBeenCalled();
    expect(searchMock).toHaveBeenCalled();
    expect(json.results[0]?.title).toBe("Found");
  });

  it("returns a shaped 500 when the read throws", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } } as never);
    getMock.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await GET(getRequest(), { params });
    expect(res.status).toBe(500);
  });
});

describe("PUT /api/leagues/[id]/pool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects an unauthenticated request with 401", async () => {
    authMock.mockResolvedValue(null as never);
    const res = await PUT(putRequest({ exclusions: [], additions: [] }), {
      params,
    });
    expect(res.status).toBe(401);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("returns 400 when the body is not valid JSON", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } } as never);
    const res = await PUT(putRequest("not json"), { params });
    expect(res.status).toBe(400);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("returns 400 with field errors on invalid input", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } } as never);
    const res = await PUT(putRequest({ exclusions: ["nope"] }), { params });
    const json = (await res.json()) as {
      fieldErrors: Record<string, string[]>;
    };
    expect(res.status).toBe(400);
    expect(json.fieldErrors.exclusions).toBeDefined();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("saves and returns 200", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } } as never);
    updateMock.mockResolvedValue({
      status: "saved",
      exclusionCount: 1,
      additionCount: 0,
    });

    const res = await PUT(putRequest({ exclusions: [5], additions: [] }), {
      params,
    });
    const json = (await res.json()) as { status: string };

    expect(res.status).toBe(200);
    expect(json.status).toBe("saved");
    expect(updateMock).toHaveBeenCalledWith({}, "league-1", "user-1", {
      exclusions: [5],
      additions: [],
    });
  });

  it("returns 403 for a public-lobby commissioner", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } } as never);
    updateMock.mockResolvedValue({ status: "public_unsupported" });
    const res = await PUT(putRequest({ exclusions: [1], additions: [] }), {
      params,
    });
    expect(res.status).toBe(403);
  });

  it("returns 403 for a non-commissioner", async () => {
    authMock.mockResolvedValue({ user: { id: "user-2" } } as never);
    updateMock.mockResolvedValue({ status: "forbidden" });
    const res = await PUT(putRequest({ exclusions: [1], additions: [] }), {
      params,
    });
    expect(res.status).toBe(403);
  });

  it("returns 404 for an unknown league", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } } as never);
    updateMock.mockResolvedValue({ status: "not_found" });
    const res = await PUT(putRequest({ exclusions: [], additions: [] }), {
      params,
    });
    expect(res.status).toBe(404);
  });

  it("returns 409 when the pool is frozen", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } } as never);
    updateMock.mockResolvedValue({
      status: "frozen",
      leagueStatus: "finalized",
    });
    const res = await PUT(putRequest({ exclusions: [1], additions: [] }), {
      params,
    });
    const json = (await res.json()) as { leagueStatus: string };
    expect(res.status).toBe(409);
    expect(json.leagueStatus).toBe("finalized");
  });

  it("returns a shaped 500 when the update throws", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } } as never);
    updateMock.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await PUT(putRequest({ exclusions: [], additions: [] }), {
      params,
    });
    expect(res.status).toBe(500);
  });
});
