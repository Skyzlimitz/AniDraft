import { beforeEach, describe, expect, it, vi } from "vitest";

// The route pulls in `@/auth`, `@/lib/db`, and the kick logic, all of which
// touch validated env / a real libsql client at import time. Mock them so the
// handler's own behaviour (auth gate, response shaping) is what gets exercised.
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/leagues/kickPlayer", () => ({ kickPlayer: vi.fn() }));

import { auth } from "@/auth";
import { kickPlayer } from "@/lib/leagues/kickPlayer";

import { DELETE } from "./route";

const authMock = vi.mocked(auth);
const kickMock = vi.mocked(kickPlayer);

function deleteRequest(): Request {
  return new Request("http://localhost/api/leagues/league-1/members/user-2", {
    method: "DELETE",
  });
}

const params = Promise.resolve({ id: "league-1", userId: "user-2" });

describe("DELETE /api/leagues/[id]/members/[userId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects an unauthenticated request with 401", async () => {
    authMock.mockResolvedValue(null as never);

    const res = await DELETE(deleteRequest(), { params });

    expect(res.status).toBe(401);
    expect(kickMock).not.toHaveBeenCalled();
  });

  it("kicks the player and returns 200", async () => {
    authMock.mockResolvedValue({ user: { id: "commish" } } as never);
    kickMock.mockResolvedValue({ status: "kicked", userId: "user-2" });

    const res = await DELETE(deleteRequest(), { params });
    const json = (await res.json()) as { status: string; userId: string };

    expect(res.status).toBe(200);
    expect(json).toEqual({ status: "kicked", userId: "user-2" });
    expect(kickMock).toHaveBeenCalledWith({}, "league-1", "commish", "user-2");
  });

  it("returns 404 for an unknown league", async () => {
    authMock.mockResolvedValue({ user: { id: "commish" } } as never);
    kickMock.mockResolvedValue({ status: "not_found" });

    const res = await DELETE(deleteRequest(), { params });
    expect(res.status).toBe(404);
  });

  it("returns 404 when the target isn't a member", async () => {
    authMock.mockResolvedValue({ user: { id: "commish" } } as never);
    kickMock.mockResolvedValue({ status: "member_not_found" });

    const res = await DELETE(deleteRequest(), { params });
    expect(res.status).toBe(404);
  });

  it("returns 403 when the caller is not the commissioner", async () => {
    authMock.mockResolvedValue({ user: { id: "user-3" } } as never);
    kickMock.mockResolvedValue({ status: "forbidden" });

    const res = await DELETE(deleteRequest(), { params });
    expect(res.status).toBe(403);
  });

  it("returns 403 for a public-lobby kick", async () => {
    authMock.mockResolvedValue({ user: { id: "commish" } } as never);
    kickMock.mockResolvedValue({ status: "public_forbidden" });

    const res = await DELETE(deleteRequest(), { params });
    expect(res.status).toBe(403);
  });

  it("returns 403 once the league has moved past setup", async () => {
    authMock.mockResolvedValue({ user: { id: "commish" } } as never);
    kickMock.mockResolvedValue({ status: "locked", leagueStatus: "finalized" });

    const res = await DELETE(deleteRequest(), { params });
    const json = (await res.json()) as { leagueStatus: string };

    expect(res.status).toBe(403);
    expect(json.leagueStatus).toBe("finalized");
  });

  it("returns 400 when the commissioner tries to kick themselves", async () => {
    authMock.mockResolvedValue({ user: { id: "commish" } } as never);
    kickMock.mockResolvedValue({ status: "self_kick" });

    const res = await DELETE(deleteRequest(), { params });
    expect(res.status).toBe(400);
  });

  it("returns a shaped 500 when the kick throws", async () => {
    authMock.mockResolvedValue({ user: { id: "commish" } } as never);
    kickMock.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await DELETE(deleteRequest(), { params });
    const json = (await res.json()) as { error: string };

    expect(res.status).toBe(500);
    expect(json.error).toBe("Failed to remove player");
  });
});
