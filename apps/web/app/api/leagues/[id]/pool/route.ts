import { updatePoolOverridesSchema } from "@anidraft/shared";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import {
  getPoolEditor,
  searchPoolCandidates,
  updatePoolOverrides,
} from "@/lib/leagues/poolEditor";
import { fetchSeasonPool, searchPool } from "@/lib/leagues/seasonPool";

/**
 * `/api/leagues/[id]/pool` — the commissioner pool-override endpoint (issue #36).
 *
 * The proxy (`proxy.ts`) deliberately does NOT cover `/api`, so each handler
 * owns its own auth check. All three operations gate on the same rule (private
 * league + caller is its commissioner), enforced in the domain layer whose
 * tagged result maps to a status code:
 *
 * - `GET`                  → the editor view (auto pool reconciled with overrides)
 * - `GET ?search=<query>`  → `{ results }`, AniList title search for shows to add
 * - `PUT`                  → replace the full override set
 *
 * Shared result → status mapping:
 * - `not_found`           → 404
 * - `forbidden`           → 403 (caller is not the commissioner)
 * - `public_unsupported`  → 403 (public lobby — fixed pool, no editor)
 * - `frozen` (PUT only)   → 409 (league past `setup`; overrides are frozen)
 *
 * `params` is a Promise in this Next version (App Router), hence the `await`.
 */

/** 403 body for both forbidden cases, with a reason precise to each. */
function forbidden(reason: "forbidden" | "public_unsupported"): Response {
  return Response.json(
    {
      error:
        reason === "public_unsupported"
          ? "Public lobbies use a fixed pool and have no override editor"
          : "Only the commissioner can edit this league's pool",
    },
    { status: 403 },
  );
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;

  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const search = new URL(request.url).searchParams.get("search");

  try {
    // A `?search=` query is the "add a show" picker; otherwise return the editor
    // view. Both share the private-league-commissioner gate.
    if (search !== null) {
      const result = await searchPoolCandidates(
        db,
        id,
        userId,
        search,
        searchPool,
      );
      switch (result.status) {
        case "ok":
          return Response.json({ results: result.results }, { status: 200 });
        case "not_found":
          return Response.json({ error: "League not found" }, { status: 404 });
        case "forbidden":
        case "public_unsupported":
          return forbidden(result.status);
      }
    }

    const result = await getPoolEditor(db, id, userId, fetchSeasonPool);
    switch (result.status) {
      case "ok":
        return Response.json({ view: result.view }, { status: 200 });
      case "not_found":
        return Response.json({ error: "League not found" }, { status: 404 });
      case "forbidden":
      case "public_unsupported":
        return forbidden(result.status);
    }
  } catch (error) {
    console.error("Failed to load pool editor", error);
    return Response.json({ error: "Failed to load pool" }, { status: 500 });
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;

  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = updatePoolOverridesSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        error: "Validation failed",
        fieldErrors: parsed.error.flatten().fieldErrors,
      },
      { status: 400 },
    );
  }

  let result;
  try {
    result = await updatePoolOverrides(db, id, userId, parsed.data);
  } catch (error) {
    console.error("Failed to update pool overrides", error);
    return Response.json(
      { error: "Failed to update pool" },
      { status: 500 },
    );
  }

  switch (result.status) {
    case "saved":
      return Response.json(result, { status: 200 });
    case "not_found":
      return Response.json({ error: "League not found" }, { status: 404 });
    case "forbidden":
    case "public_unsupported":
      return forbidden(result.status);
    case "frozen":
      return Response.json(
        {
          error: "The pool is frozen now that the league has been finalized",
          leagueStatus: result.leagueStatus,
        },
        { status: 409 },
      );
    default: {
      // Exhaustiveness guard: a new result status added without a case here
      // becomes a compile error, not an implicit `undefined` return.
      const _exhaustive: never = result;
      console.error("Unhandled pool update result", _exhaustive);
      return Response.json({ error: "Failed to update pool" }, { status: 500 });
    }
  }
}
