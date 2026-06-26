import { beforeEach, describe, expect, it, vi } from "vitest";

// The route pulls in `@/auth`, `@/lib/db`, and the update-settings logic, all of
// which touch validated env / a real libsql client at import time. Mock them so
// the handler's own behaviour (auth gate, validation, response shaping) is what
// gets exercised.
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/leagues/updateLeagueSettings", () => ({
  updateLeagueSettings: vi.fn(),
}));

import { auth } from "@/auth";
import { updateLeagueSettings } from "@/lib/leagues/updateLeagueSettings";

import { PATCH } from "./route";

const authMock = vi.mocked(auth);
const updateMock = vi.mocked(updateLeagueSettings);

function patchRequest(body: unknown): Request {
  return new Request("http://localhost/api/leagues/league-1", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const params = Promise.resolve({ id: "league-1" });

describe("PATCH /api/leagues/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects an unauthenticated request with 401", async () => {
    authMock.mockResolvedValue(null as never);

    const res = await PATCH(patchRequest({ name: "New Name" }), { params });

    expect(res.status).toBe(401);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("returns 400 with field errors on invalid input", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } } as never);

    const res = await PATCH(patchRequest({ pickTimerSeconds: 5 }), { params });
    const json = (await res.json()) as {
      fieldErrors: Record<string, string[]>;
    };

    expect(res.status).toBe(400);
    expect(json.fieldErrors.pickTimerSeconds).toBeDefined();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("returns 400 when the update has no fields", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } } as never);

    const res = await PATCH(patchRequest({}), { params });

    expect(res.status).toBe(400);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("returns 400 when the body is not valid JSON", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } } as never);

    const res = await PATCH(patchRequest("not json"), { params });

    expect(res.status).toBe(400);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("updates the league and returns 200", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } } as never);
    updateMock.mockResolvedValue({
      status: "updated",
      league: {
        id: "league-1",
        name: "New Name",
        status: "setup",
        visibility: "private",
        maxPlayers: 8,
        pickTimerSeconds: 90,
        draftStartsAt: null,
        memberCount: 1,
      },
    });

    const res = await PATCH(patchRequest({ name: "New Name" }), { params });
    const json = (await res.json()) as {
      status: string;
      league: { name: string };
    };

    expect(res.status).toBe(200);
    expect(json.status).toBe("updated");
    expect(json.league.name).toBe("New Name");
    expect(updateMock).toHaveBeenCalledWith({}, "league-1", "user-1", {
      name: "New Name",
    });
  });

  it("returns 403 when the caller is not the commissioner", async () => {
    authMock.mockResolvedValue({ user: { id: "user-2" } } as never);
    updateMock.mockResolvedValue({ status: "forbidden" });

    const res = await PATCH(patchRequest({ name: "Hijack" }), { params });

    expect(res.status).toBe(403);
  });

  it("returns 404 for an unknown league", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } } as never);
    updateMock.mockResolvedValue({ status: "not_found" });

    const res = await PATCH(patchRequest({ name: "Ghost" }), { params });

    expect(res.status).toBe(404);
  });

  it("returns 409 when the field isn't editable from the league's state", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } } as never);
    updateMock.mockResolvedValue({
      status: "locked",
      leagueStatus: "finalized",
      editableFields: ["draftStartsAt"],
    });

    const res = await PATCH(patchRequest({ name: "Too late" }), { params });
    const json = (await res.json()) as { editableFields: string[] };

    expect(res.status).toBe(409);
    expect(json.editableFields).toEqual(["draftStartsAt"]);
  });

  it("returns 400 field error when maxPlayers is below the member count", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } } as never);
    updateMock.mockResolvedValue({
      status: "invalid_max_players",
      memberCount: 5,
    });

    const res = await PATCH(patchRequest({ maxPlayers: 4 }), { params });
    const json = (await res.json()) as {
      fieldErrors: Record<string, string[]>;
    };

    expect(res.status).toBe(400);
    expect(json.fieldErrors.maxPlayers?.[0]).toContain("5 members");
  });

  it("returns a shaped 500 when the update throws", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } } as never);
    updateMock.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await PATCH(patchRequest({ name: "New" }), { params });
    const json = (await res.json()) as { error: string };

    expect(res.status).toBe(500);
    expect(json.error).toBe("Failed to update league settings");
  });
});
