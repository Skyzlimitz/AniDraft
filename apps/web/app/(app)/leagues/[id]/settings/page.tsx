import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { auth } from "@/auth";
import { PrivateLeagueSettings } from "@/components/leagues/PrivateLeagueSettings";
import { PublicLobbySettings } from "@/components/leagues/PublicLobbySettings";
import { db } from "@/lib/db";
import { getLeagueSettings } from "@/lib/leagues/getLeagueSettings";
import { editableFieldsForLeague } from "@/lib/leagues/updateLeagueSettings";

export const metadata: Metadata = {
  title: "League settings · AniDraft",
  description: "Edit your league's settings while it's in setup.",
};

// Reads live league + membership state and (via the form) drives a mutation, so
// it must never be statically cached. `auth()` already opts the route into
// dynamic rendering; this makes the intent explicit.
export const dynamic = "force-dynamic";

/**
 * `/leagues/[id]/settings` — the commissioner settings page (issue #33).
 *
 * The proxy gates `(app)` routes, but we re-check the session here so a
 * signed-out visitor is sent to `/sign-in` with a `callbackUrl` back to this
 * page. A missing league renders a 404. Both commissioner and non-commissioner
 * members reach the page: the commissioner gets an editable form (only the
 * fields legal for the league's lifecycle state), everyone else a read-only
 * view — the API (`PATCH /api/leagues/[id]`) is the real access boundary and
 * answers a non-commissioner with 403.
 *
 * The *shape* of the form depends on the league's visibility (issue #34): a
 * **private** league gets the full {@link PrivateLeagueSettings} editor, a
 * **public ("lobby")** league the stripped {@link PublicLobbySettings} — only
 * max players + draft start, since the pick timer and pool are fixed. Both
 * paths receive the same `editableFields` allowlist, which `editableFieldsForLeague`
 * has already narrowed for public leagues, so the API and UI agree on one set.
 *
 * `params` is a Promise in this Next version (App Router), hence the `await`.
 */
export default async function LeagueSettingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const session = await auth();
  if (!session?.user?.id) {
    redirect(
      `/sign-in?callbackUrl=${encodeURIComponent(`/leagues/${id}/settings`)}`,
    );
  }

  const access = await getLeagueSettings(db, id, session.user.id);
  if (!access) {
    notFound();
  }

  const { league, isCommissioner, members } = access;
  const isPublic = league.visibility === "public";
  const editableFields = editableFieldsForLeague(
    league.visibility,
    league.status,
  );

  return (
    <main className="mx-auto w-full max-w-xl px-4 py-10 sm:px-6">
      <div className="mb-8 space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          {isPublic ? "Lobby settings" : "League settings"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {isCommissioner
            ? isPublic
              ? "Public lobbies use fixed rules. You can still set the player count and draft time before the draft starts."
              : "Tune your league while it's in setup. Most settings lock once you finalize."
            : "Settings for this league. Only the commissioner can change them."}
        </p>
      </div>

      {isPublic ? (
        <PublicLobbySettings
          league={league}
          canEdit={isCommissioner}
          editableFields={editableFields}
        />
      ) : (
        <PrivateLeagueSettings
          league={league}
          canEdit={isCommissioner}
          editableFields={editableFields}
          members={members}
        />
      )}
    </main>
  );
}
