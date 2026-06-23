import { createLeagueSchema } from "@anidraft/shared";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { createLeague } from "@/lib/leagues/createLeague";

/**
 * `POST /api/leagues` — create a league for the signed-in user.
 *
 * The proxy (`proxy.ts`) deliberately does NOT cover `/api`, so this handler
 * owns its own auth check. The body is validated with the shared
 * `createLeagueSchema`; on success the creator becomes the league's
 * commissioner and (for a private league) an invite code is returned.
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

  const parsed = createLeagueSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        error: "Validation failed",
        fieldErrors: parsed.error.flatten().fieldErrors,
      },
      { status: 400 },
    );
  }

  try {
    const result = await createLeague(db, userId, parsed.data);
    return Response.json(result, { status: 201 });
  } catch (error) {
    // e.g. invite-code exhaustion or a DB failure. Log for diagnosis and return
    // a shaped 500 rather than letting Next surface an unhandled rejection.
    console.error("Failed to create league", error);
    return Response.json({ error: "Failed to create league" }, { status: 500 });
  }
}
