import { beforeEach, describe, expect, it, vi } from "vitest";

// The route pulls in `@/auth`, `@/lib/db`, and the create-league logic, all of
// which touch validated env / a real libsql client at import time. Mock them so
// the handler's own behaviour (auth gate, validation, response shaping) is what
// gets exercised.
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/leagues/createLeague", () => ({ createLeague: vi.fn() }));

import { auth } from "@/auth";
import { createLeague } from "@/lib/leagues/createLeague";

import { POST } from "./route";

const authMock = vi.mocked(auth);
const createLeagueMock = vi.mocked(createLeague);

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/leagues", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validBody = {
  name: "Spring Showdown",
  visibility: "private" as const,
  maxPlayers: 8,
  seasonYear: 2026,
  season: "SPRING" as const,
};

describe("POST /api/leagues", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects an unauthenticated request with 401", async () => {
    authMock.mockResolvedValue(null as never);

    const res = await POST(postRequest(validBody));

    expect(res.status).toBe(401);
    expect(createLeagueMock).not.toHaveBeenCalled();
  });

  it("returns 400 with field errors on invalid input", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } } as never);

    const res = await POST(postRequest({ ...validBody, name: "ab" }));
    const json = (await res.json()) as {
      error: string;
      fieldErrors: Record<string, string[]>;
    };

    expect(res.status).toBe(400);
    expect(json.fieldErrors.name).toBeDefined();
    expect(createLeagueMock).not.toHaveBeenCalled();
  });

  it("returns 400 when the body is not valid JSON", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } } as never);

    const res = await POST(
      new Request("http://localhost/api/leagues", {
        method: "POST",
        body: "not json",
      }),
    );

    expect(res.status).toBe(400);
    expect(createLeagueMock).not.toHaveBeenCalled();
  });

  it("creates the league and returns 201 with the invite code", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } } as never);
    createLeagueMock.mockResolvedValue({
      leagueId: "league-1",
      inviteCode: "ABCD2345",
    });

    const res = await POST(postRequest(validBody));
    const json = (await res.json()) as {
      leagueId: string;
      inviteCode: string | null;
    };

    expect(res.status).toBe(201);
    expect(json).toEqual({ leagueId: "league-1", inviteCode: "ABCD2345" });
    expect(createLeagueMock).toHaveBeenCalledWith(
      {},
      "user-1",
      expect.objectContaining({ name: "Spring Showdown" }),
    );
  });

  it("returns a shaped 500 when league creation throws", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } } as never);
    createLeagueMock.mockRejectedValue(
      new Error("Could not generate a unique invite code"),
    );
    // The handler logs the failure; keep test output clean.
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST(postRequest(validBody));
    const json = (await res.json()) as { error: string };

    expect(res.status).toBe(500);
    expect(json.error).toBe("Failed to create league");
  });
});
