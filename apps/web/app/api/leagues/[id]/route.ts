import { updateLeagueSettingsSchema } from "@anidraft/shared";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { updateLeagueSettings } from "@/lib/leagues/updateLeagueSettings";

/**
 * `PATCH /api/leagues/[id]` — a commissioner edits a private league's settings.
 *
 * The proxy (`proxy.ts`) deliberately does NOT cover `/api`, so this handler
 * owns its own auth check. The body is a partial update validated with the
 * shared `updateLeagueSettingsSchema` (static bounds); the state- and
 * member-count-dependent rules live in {@link updateLeagueSettings}, whose
 * tagged result maps to a status code:
 *
 * - `updated`             -> 200 `{ status, league }`
 * - `not_found`           -> 404
 * - `forbidden`           -> 403 (caller is not the commissioner)
 * - `locked`              -> 409 (the supplied fields aren't editable from this
 *                            league state; `editableFields` says what is)
 * - `invalid_max_players` -> 400 `{ fieldErrors: { maxPlayers } }`
 *
 * `params` is a Promise in this Next version (App Router), hence the `await`.
 */
export async function PATCH(
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

  const parsed = updateLeagueSettingsSchema.safeParse(body);
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
    result = await updateLeagueSettings(db, id, userId, parsed.data);
  } catch (error) {
    // e.g. a DB failure. Log for diagnosis and return a shaped 500 rather than
    // letting Next surface an unhandled rejection.
    console.error("Failed to update league settings", error);
    return Response.json(
      { error: "Failed to update league settings" },
      { status: 500 },
    );
  }

  switch (result.status) {
    case "updated":
      return Response.json(result, { status: 200 });
    case "not_found":
      return Response.json(result, { status: 404 });
    case "forbidden":
      return Response.json(
        { error: "Only the commissioner can edit league settings" },
        { status: 403 },
      );
    case "locked":
      return Response.json(
        {
          error: "These settings can't be changed from the league's state",
          leagueStatus: result.leagueStatus,
          editableFields: result.editableFields,
        },
        { status: 409 },
      );
    case "invalid_max_players":
      return Response.json(
        {
          error: "Validation failed",
          fieldErrors: {
            maxPlayers: [
              `Max players can't be below the current ${result.memberCount} member${
                result.memberCount === 1 ? "" : "s"
              }`,
            ],
          },
        },
        { status: 400 },
      );
    default: {
      // Exhaustiveness guard: a future result status added without a case here
      // becomes a compile error, not an implicit `undefined` return.
      const _exhaustive: never = result;
      console.error("Unhandled update result", _exhaustive);
      return Response.json(
        { error: "Failed to update league settings" },
        { status: 500 },
      );
    }
  }
}
