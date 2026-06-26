import { joinLeagueSchema } from "@anidraft/shared";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { joinLeague } from "@/lib/leagues/joinLeague";

/**
 * `POST /api/leagues/join` — add the signed-in user to a private league by
 * invite code.
 *
 * The proxy (`proxy.ts`) deliberately does NOT cover `/api`, so this handler
 * owns its own auth check. The body is validated with the shared
 * `joinLeagueSchema` (`{ inviteCode }`); the domain `joinLeague` then returns a
 * tagged result which this handler maps to a status code:
 *
 * - `joined`         -> 201 `{ status, leagueId }`
 * - `already_member` -> 200 `{ status, leagueId }` (idempotent: not an error)
 * - `invalid_code`   -> 404
 * - `expired`        -> 410 Gone
 * - `wrong_state`    -> 409 Conflict
 * - `league_full`    -> 409 Conflict
 *
 * The `/join/[code]` page calls `joinLeague` directly server-side; this route is
 * the equivalent JSON endpoint for programmatic callers.
 */
export async function POST(request: Request): Promise<Response> {
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

  const parsed = joinLeagueSchema.safeParse(body);
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
    result = await joinLeague(db, userId, parsed.data.inviteCode);
  } catch (error) {
    // e.g. a DB failure. Log for diagnosis and return a shaped 500 rather than
    // letting Next surface an unhandled rejection.
    console.error("Failed to join league", error);
    return Response.json({ error: "Failed to join league" }, { status: 500 });
  }

  switch (result.status) {
    case "joined":
      return Response.json(result, { status: 201 });
    case "already_member":
      return Response.json(result, { status: 200 });
    case "invalid_code":
      return Response.json(result, { status: 404 });
    case "expired":
      return Response.json(result, { status: 410 });
    case "wrong_state":
    case "league_full":
      return Response.json(result, { status: 409 });
  }
}
