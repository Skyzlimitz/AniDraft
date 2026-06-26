import { beforeEach, describe, expect, it, vi } from "vitest";

// The route pulls in `@/auth`, `@/lib/db`, and the join-league logic, all of
// which touch validated env / a real libsql client at import time. Mock them so
// the handler's own behaviour (auth gate, validation, result -> status mapping)
// is what gets exercised.
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/leagues/joinLeague", () => ({ joinLeague: vi.fn() }));
vi.mock("@/lib/leagues/joinPublicLeague", () => ({
  joinPublicLeague: vi.fn(),
}));

import { auth } from "@/auth";
import { joinLeague } from "@/lib/leagues/joinLeague";
import { joinPublicLeague } from "@/lib/leagues/joinPublicLeague";

import { POST } from "./route";

const authMock = vi.mocked(auth);
const joinLeagueMock = vi.mocked(joinLeague);
const joinPublicLeagueMock = vi.mocked(joinPublicLeague);

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/leagues/join", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validBody = { inviteCode: "JOIN2345" };

describe("POST /api/leagues/join", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "user-1" } } as never);
  });

  it("rejects an unauthenticated request with 401", async () => {
    authMock.mockResolvedValue(null as never);

    const res = await POST(postRequest(validBody));

    expect(res.status).toBe(401);
    expect(joinLeagueMock).not.toHaveBeenCalled();
  });

  it("returns 400 when the body is not valid JSON", async () => {
    const res = await POST(
      new Request("http://localhost/api/leagues/join", {
        method: "POST",
        body: "not json",
      }),
    );

    expect(res.status).toBe(400);
    expect(joinLeagueMock).not.toHaveBeenCalled();
  });

  it("returns 400 with field errors when the invite code is malformed", async () => {
    const res = await POST(postRequest({ inviteCode: "short" }));
    const json = (await res.json()) as {
      fieldErrors: Record<string, string[]>;
    };

    expect(res.status).toBe(400);
    expect(json.fieldErrors.inviteCode).toBeDefined();
    expect(joinLeagueMock).not.toHaveBeenCalled();
  });

  it("returns 201 with the league id when the join succeeds", async () => {
    joinLeagueMock.mockResolvedValue({
      status: "joined",
      leagueId: "league-1",
    });

    const res = await POST(postRequest(validBody));
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json).toEqual({ status: "joined", leagueId: "league-1" });
    expect(joinLeagueMock).toHaveBeenCalledWith({}, "user-1", "JOIN2345");
  });

  it("returns 200 (not an error) when the user is already a member", async () => {
    joinLeagueMock.mockResolvedValue({
      status: "already_member",
      leagueId: "league-1",
    });

    const res = await POST(postRequest(validBody));

    expect(res.status).toBe(200);
  });

  it("maps invalid_code to 404", async () => {
    joinLeagueMock.mockResolvedValue({ status: "invalid_code" });

    const res = await POST(postRequest(validBody));

    expect(res.status).toBe(404);
  });

  it("maps expired to 410", async () => {
    joinLeagueMock.mockResolvedValue({ status: "expired" });

    const res = await POST(postRequest(validBody));

    expect(res.status).toBe(410);
  });

  it("maps wrong_state to 409", async () => {
    joinLeagueMock.mockResolvedValue({
      status: "wrong_state",
      leagueId: "league-1",
      leagueStatus: "drafting",
    });

    const res = await POST(postRequest(validBody));

    expect(res.status).toBe(409);
  });

  it("maps league_full to 409", async () => {
    joinLeagueMock.mockResolvedValue({
      status: "league_full",
      leagueId: "league-1",
    });

    const res = await POST(postRequest(validBody));

    expect(res.status).toBe(409);
  });

  it("returns a shaped 500 when the join throws", async () => {
    joinLeagueMock.mockRejectedValue(new Error("db exploded"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST(postRequest(validBody));
    const json = (await res.json()) as { error: string };

    expect(res.status).toBe(500);
    expect(json.error).toBe("Failed to join league");
  });

  it("returns 400 with no league identifier in the body", async () => {
    const res = await POST(postRequest({}));

    expect(res.status).toBe(400);
    expect(joinLeagueMock).not.toHaveBeenCalled();
    expect(joinPublicLeagueMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/leagues/join — public lobby (no code)", () => {
  const publicBody = { leagueId: "league-uuid" };

  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "user-1" } } as never);
  });

  it("routes a leagueId body to joinPublicLeague, not joinLeague", async () => {
    joinPublicLeagueMock.mockResolvedValue({
      status: "joined",
      leagueId: "league-uuid",
    });

    const res = await POST(postRequest(publicBody));
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json).toEqual({ status: "joined", leagueId: "league-uuid" });
    expect(joinPublicLeagueMock).toHaveBeenCalledWith(
      {},
      "user-1",
      "league-uuid",
    );
    expect(joinLeagueMock).not.toHaveBeenCalled();
  });

  it("returns 400 when leagueId is blank", async () => {
    const res = await POST(postRequest({ leagueId: "   " }));
    const json = (await res.json()) as {
      fieldErrors: Record<string, string[]>;
    };

    expect(res.status).toBe(400);
    expect(json.fieldErrors.leagueId).toBeDefined();
    expect(joinPublicLeagueMock).not.toHaveBeenCalled();
  });

  it("maps already_member to 200", async () => {
    joinPublicLeagueMock.mockResolvedValue({
      status: "already_member",
      leagueId: "league-uuid",
    });

    const res = await POST(postRequest(publicBody));

    expect(res.status).toBe(200);
  });

  it("maps not_found to 404 (private league rejects a no-code join)", async () => {
    joinPublicLeagueMock.mockResolvedValue({ status: "not_found" });

    const res = await POST(postRequest(publicBody));

    expect(res.status).toBe(404);
  });

  it("maps wrong_state to 409", async () => {
    joinPublicLeagueMock.mockResolvedValue({
      status: "wrong_state",
      leagueId: "league-uuid",
      leagueStatus: "drafting",
    });

    const res = await POST(postRequest(publicBody));

    expect(res.status).toBe(409);
  });

  it("maps league_full to 409", async () => {
    joinPublicLeagueMock.mockResolvedValue({
      status: "league_full",
      leagueId: "league-uuid",
    });

    const res = await POST(postRequest(publicBody));

    expect(res.status).toBe(409);
  });

  it("prefers the invite-code path when the body carries both fields", async () => {
    joinLeagueMock.mockResolvedValue({
      status: "joined",
      leagueId: "league-1",
    });

    const res = await POST(
      postRequest({ inviteCode: "JOIN2345", leagueId: "league-uuid" }),
    );

    expect(res.status).toBe(201);
    expect(joinLeagueMock).toHaveBeenCalledWith({}, "user-1", "JOIN2345");
    expect(joinPublicLeagueMock).not.toHaveBeenCalled();
  });
});
