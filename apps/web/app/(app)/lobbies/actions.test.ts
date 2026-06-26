import { beforeEach, describe, expect, it, vi } from "vitest";

// The action pulls in `@/auth`, `@/lib/db`, the join logic, and Next's
// cache/navigation helpers — all of which touch validated env, a real libsql
// client, or framework internals at import time. Mock them so the action's own
// behaviour (auth gate, result mapping, revalidation) is what gets exercised.
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/leagues/joinPublicLeague", () => ({
  joinPublicLeague: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  // The real `redirect` throws a control-flow error; mirror that so code after
  // it doesn't run and the test can assert the redirect target.
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { joinPublicLeague } from "@/lib/leagues/joinPublicLeague";

import { joinLobbyAction, type JoinLobbyState } from "./actions";

const authMock = vi.mocked(auth);
const joinMock = vi.mocked(joinPublicLeague);
const revalidateMock = vi.mocked(revalidatePath);
const redirectMock = vi.mocked(redirect);

describe("joinLobbyAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects a signed-out user to sign-in with a callback and never joins", async () => {
    authMock.mockResolvedValue(null as never);

    await expect(joinLobbyAction("league-1")).rejects.toThrow(
      "NEXT_REDIRECT:/sign-in?callbackUrl=%2Flobbies",
    );
    expect(redirectMock).toHaveBeenCalledWith(
      "/sign-in?callbackUrl=%2Flobbies",
    );
    expect(joinMock).not.toHaveBeenCalled();
  });

  it("joins and revalidates the lobby on success", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } } as never);
    joinMock.mockResolvedValue({ status: "joined", leagueId: "league-1" });

    const state = await joinLobbyAction("league-1");

    expect(joinMock).toHaveBeenCalledWith({}, "user-1", "league-1");
    expect(revalidateMock).toHaveBeenCalledWith("/lobbies");
    expect(state).toEqual({ status: "joined", leagueId: "league-1" });
  });

  it("maps each domain result to its action state", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } } as never);

    const cases: Array<[Awaited<ReturnType<typeof joinPublicLeague>>, JoinLobbyState]> = [
      [
        { status: "already_member", leagueId: "L" },
        { status: "already_member", leagueId: "L" },
      ],
      [{ status: "not_found" }, { status: "not_found" }],
      [
        { status: "wrong_state", leagueId: "L", leagueStatus: "drafting" },
        { status: "wrong_state" },
      ],
      [{ status: "league_full", leagueId: "L" }, { status: "league_full" }],
    ];

    for (const [domain, expected] of cases) {
      joinMock.mockResolvedValueOnce(domain);
      const state = await joinLobbyAction("L");
      expect(state).toEqual(expected);
    }
    // Membership-changing or not, every attempt revalidates the list.
    expect(revalidateMock).toHaveBeenCalledTimes(cases.length);
  });

  it("returns an error state (not a throw) when the join blows up", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } } as never);
    joinMock.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const state = await joinLobbyAction("league-1");

    expect(state).toEqual({ status: "error" });
  });
});
