import { auth } from "@/auth";
import { db } from "@/lib/db";
import { kickPlayer } from "@/lib/leagues/kickPlayer";

/**
 * `DELETE /api/leagues/[id]/members/[userId]` — a commissioner removes a player
 * from a private league while it's in `setup` (issue #35).
 *
 * The proxy (`proxy.ts`) deliberately does NOT cover `/api`, so this handler
 * owns its own auth check. There is no request body — the league and target
 * user are both path params. All the domain rules (commissioner-only, private
 * leagues only, setup-only, no self-kick, target must be an active member) live
 * in {@link kickPlayer}, whose tagged result maps to a status code:
 *
 * - `kicked`           -> 200 `{ status, userId }`
 * - `not_found`        -> 404 (no league with that id)
 * - `member_not_found` -> 404 (target isn't an active member)
 * - `forbidden`        -> 403 (caller is not the commissioner)
 * - `public_forbidden` -> 403 (public lobby — kick power not granted)
 * - `locked`           -> 403 (league has moved past setup)
 * - `self_kick`        -> 400 (commissioner can't remove themselves)
 *
 * `params` is a Promise in this Next version (App Router), hence the `await`.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; userId: string }> },
): Promise<Response> {
  const { id, userId: targetUserId } = await params;

  const session = await auth();
  const callerId = session?.user?.id;
  if (!callerId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let result;
  try {
    result = await kickPlayer(db, id, callerId, targetUserId);
  } catch (error) {
    // e.g. a DB failure. Log for diagnosis and return a shaped 500 rather than
    // letting Next surface an unhandled rejection.
    console.error("Failed to kick player", error);
    return Response.json({ error: "Failed to remove player" }, { status: 500 });
  }

  switch (result.status) {
    case "kicked":
      return Response.json(result, { status: 200 });
    case "not_found":
      return Response.json({ error: "League not found" }, { status: 404 });
    case "member_not_found":
      return Response.json(
        { error: "That player isn't in this league" },
        { status: 404 },
      );
    case "forbidden":
      return Response.json(
        { error: "Only the commissioner can remove players" },
        { status: 403 },
      );
    case "public_forbidden":
      return Response.json(
        { error: "Players can't be removed from a public lobby" },
        { status: 403 },
      );
    case "locked":
      return Response.json(
        {
          error: "Players can only be removed while the league is in setup",
          leagueStatus: result.leagueStatus,
        },
        { status: 403 },
      );
    case "self_kick":
      return Response.json(
        { error: "The commissioner can't remove themselves" },
        { status: 400 },
      );
    default: {
      // Exhaustiveness guard: a future result status added without a case here
      // becomes a compile error, not an implicit `undefined` return.
      const _exhaustive: never = result;
      console.error("Unhandled kick result", _exhaustive);
      return Response.json(
        { error: "Failed to remove player" },
        { status: 500 },
      );
    }
  }
}
