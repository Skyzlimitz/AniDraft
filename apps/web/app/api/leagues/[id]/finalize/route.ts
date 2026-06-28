import { auth } from "@/auth";
import { db } from "@/lib/db";
import {
  finalizeLeague,
  preconditionMessage,
} from "@/lib/leagues/finalizeLeague";
import { fetchSeasonPool } from "@/lib/leagues/seasonPool";

/**
 * `POST /api/leagues/[id]/finalize` — a commissioner closes setup and locks the
 * league for drafting (issue #37).
 *
 * The proxy (`proxy.ts`) deliberately does NOT cover `/api`, so this handler
 * owns its own auth check. There's no request body: finalize is a pure state
 * transition. The preconditions (≥2 members, pool ≥ players, future draft time),
 * the commissioner gate, and idempotency all live in {@link finalizeLeague},
 * whose tagged result maps to a status code:
 *
 * - `finalized`            → 200 `{ status, league }`
 * - `already_finalized`    → 200 `{ status, league }` (idempotent double-click)
 * - `not_found`            → 404
 * - `forbidden`            → 403 (caller is not the commissioner)
 * - `invalid_state`        → 409 (league already past finalize)
 * - `preconditions_failed` → 422 `{ error, failures }` (start conditions unmet)
 *
 * `params` is a Promise in this Next version (App Router), hence the `await`.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;

  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let result;
  try {
    result = await finalizeLeague(db, id, userId, fetchSeasonPool);
  } catch (error) {
    console.error("Failed to finalize league", error);
    return Response.json(
      { error: "Failed to finalize league" },
      { status: 500 },
    );
  }

  switch (result.status) {
    case "finalized":
    case "already_finalized":
      return Response.json(result, { status: 200 });
    case "not_found":
      return Response.json({ error: "League not found" }, { status: 404 });
    case "forbidden":
      return Response.json(
        { error: "Only the commissioner can finalize this league" },
        { status: 403 },
      );
    case "invalid_state":
      return Response.json(
        {
          error:
            "This league has already moved past setup and can't be finalized",
          leagueStatus: result.leagueStatus,
        },
        { status: 409 },
      );
    case "preconditions_failed":
      return Response.json(
        {
          error: "The league isn't ready to finalize yet",
          failures: result.failures.map((failure) => ({
            ...failure,
            message: preconditionMessage(failure),
          })),
        },
        { status: 422 },
      );
    default: {
      // Exhaustiveness guard: a new result status added without a case here
      // becomes a compile error, not an implicit `undefined` return.
      const _exhaustive: never = result;
      console.error("Unhandled finalize result", _exhaustive);
      return Response.json(
        { error: "Failed to finalize league" },
        { status: 500 },
      );
    }
  }
}
