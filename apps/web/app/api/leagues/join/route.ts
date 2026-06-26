import { joinLeagueSchema, joinPublicLeagueSchema } from "@anidraft/shared";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { joinLeague } from "@/lib/leagues/joinLeague";
import { joinPublicLeague } from "@/lib/leagues/joinPublicLeague";

/**
 * `POST /api/leagues/join` — add the signed-in user to a league. One endpoint
 * serves both join styles, distinguished by the body:
 *
 * - `{ inviteCode }` — join a **private** league by its invite code
 *   (`joinLeague`).
 * - `{ leagueId }`  — join a **public** lobby with no code, gated only by the
 *   league being `public` + in `setup` + not full (`joinPublicLeague`). A
 *   private league reached by id answers `not_found`, so this is not a backdoor
 *   around the invite-code flow.
 *
 * The proxy (`proxy.ts`) deliberately does NOT cover `/api`, so this handler
 * owns its own auth check. The body is validated with the shared
 * `joinLeagueRequestSchema` (a union of the two shapes); the chosen domain
 * function returns a tagged result which this handler maps to a status code:
 *
 * - `joined`               -> 201 `{ status, leagueId }`
 * - `already_member`       -> 200 `{ status, leagueId }` (idempotent: not an error)
 * - `invalid_code`/`not_found` -> 404
 * - `expired`              -> 410 Gone
 * - `wrong_state`          -> 409 Conflict
 * - `league_full`          -> 409 Conflict
 *
 * The `/join/[code]` page calls `joinLeague` directly server-side and the lobby
 * Join button calls `joinPublicLeague` via a server action; this route is the
 * equivalent JSON endpoint for programmatic callers of either path.
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

  // A body that names a `leagueId` (and no invite code) is a public-lobby join;
  // everything else is validated as an invite-code join, so a malformed code
  // still yields a clean `inviteCode` field error rather than an opaque union
  // error. Picking the schema up front keeps `fieldErrors` per-field.
  const isPublicJoin =
    typeof body === "object" &&
    body !== null &&
    "leagueId" in body &&
    !("inviteCode" in body);

  const parsed = isPublicJoin
    ? joinPublicLeagueSchema.safeParse(body)
    : joinLeagueSchema.safeParse(body);
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
    // Branch on which identifier the validated body carries: a code means the
    // private invite-code join, a bare league id means the public-lobby join.
    result =
      "inviteCode" in parsed.data
        ? await joinLeague(db, userId, parsed.data.inviteCode)
        : await joinPublicLeague(db, userId, parsed.data.leagueId);
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
    // `invalid_code` (bad/dead invite) and `not_found` (no such public league,
    // or a private one reached by id) both reduce to "no league to join here".
    case "invalid_code":
    case "not_found":
      return Response.json(result, { status: 404 });
    case "expired":
      return Response.json(result, { status: 410 });
    case "wrong_state":
    case "league_full":
      return Response.json(result, { status: 409 });
    default: {
      // Exhaustiveness guard: a future `JoinLeagueResult` status added without a
      // case here becomes a compile error, not an implicit `undefined` return
      // (which Next surfaces as "No response is returned from route handler").
      const _exhaustive: never = result;
      console.error("Unhandled join result", _exhaustive);
      return Response.json({ error: "Failed to join league" }, { status: 500 });
    }
  }
}
