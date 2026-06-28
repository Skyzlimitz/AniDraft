import { beforeEach, describe, expect, it, vi } from "vitest";

// The route pulls in `@/auth`, `@/lib/db`, the finalize domain logic, and the
// AniList-backed season fetcher, all of which touch validated env / a real
// libsql client or network at import time. Mock them so the handler's own
// behaviour (auth gate, result → status mapping) is what gets exercised.
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/leagues/seasonPool", () => ({ fetchSeasonPool: vi.fn() }));
vi.mock("@/lib/leagues/finalizeLeague", async () => {
  // Keep the real `preconditionMessage` (pure, no side effects) so the 422 body
  // carries the genuine copy; only the DB-touching `finalizeLeague` is faked.
  const actual = await vi.importActual<
    typeof import("@/lib/leagues/finalizeLeague")
  >("@/lib/leagues/finalizeLeague");
  return { ...actual, finalizeLeague: vi.fn() };
});

import { auth } from "@/auth";
import { finalizeLeague } from "@/lib/leagues/finalizeLeague";

import { POST } from "./route";

const authMock = vi.mocked(auth);
const finalizeMock = vi.mocked(finalizeLeague);

const params = Promise.resolve({ id: "league-1" });

function postRequest(): Request {
  return new Request("http://localhost/api/leagues/league-1/finalize", {
    method: "POST",
  });
}

const sampleLeague = {
  id: "league-1",
  name: "Test League",
  status: "finalized" as const,
  visibility: "private" as const,
  finalizedAt: new Date("2026-06-28T00:00:00Z"),
  memberCount: 4,
};

describe("POST /api/leagues/[id]/finalize", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects an unauthenticated request with 401", async () => {
    authMock.mockResolvedValue(null as never);
    const res = await POST(postRequest(), { params });
    expect(res.status).toBe(401);
    expect(finalizeMock).not.toHaveBeenCalled();
  });

  it("returns 200 with the finalized league", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } } as never);
    finalizeMock.mockResolvedValue({
      status: "finalized",
      league: sampleLeague,
    });

    const res = await POST(postRequest(), { params });
    const json = (await res.json()) as {
      status: string;
      league: { id: string };
    };

    expect(res.status).toBe(200);
    expect(json.status).toBe("finalized");
    expect(json.league.id).toBe("league-1");
  });

  it("maps already_finalized to 200 (idempotent)", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } } as never);
    finalizeMock.mockResolvedValue({
      status: "already_finalized",
      league: sampleLeague,
    });

    const res = await POST(postRequest(), { params });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { status: string }).status).toBe(
      "already_finalized",
    );
  });

  it("returns 404 for an unknown league", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } } as never);
    finalizeMock.mockResolvedValue({ status: "not_found" });
    const res = await POST(postRequest(), { params });
    expect(res.status).toBe(404);
  });

  it("returns 403 for a non-commissioner", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } } as never);
    finalizeMock.mockResolvedValue({ status: "forbidden" });
    const res = await POST(postRequest(), { params });
    expect(res.status).toBe(403);
  });

  it("returns 409 for a league past finalize", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } } as never);
    finalizeMock.mockResolvedValue({
      status: "invalid_state",
      leagueStatus: "drafting",
    });
    const res = await POST(postRequest(), { params });
    const json = (await res.json()) as { leagueStatus: string };
    expect(res.status).toBe(409);
    expect(json.leagueStatus).toBe("drafting");
  });

  it("returns 422 with per-failure messages when preconditions fail", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } } as never);
    finalizeMock.mockResolvedValue({
      status: "preconditions_failed",
      failures: [
        { code: "too_few_members", required: 2, actual: 1 },
        { code: "draft_start_missing" },
      ],
    });

    const res = await POST(postRequest(), { params });
    const json = (await res.json()) as {
      failures: { code: string; message: string }[];
    };

    expect(res.status).toBe(422);
    expect(json.failures).toHaveLength(2);
    expect(json.failures[0]?.code).toBe("too_few_members");
    expect(json.failures[0]?.message).toContain("at least 2 members");
    expect(json.failures[1]?.message).toContain("draft start time");
  });

  it("returns 500 when the domain logic throws", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } } as never);
    finalizeMock.mockRejectedValue(new Error("db down"));
    const res = await POST(postRequest(), { params });
    expect(res.status).toBe(500);
  });
});
