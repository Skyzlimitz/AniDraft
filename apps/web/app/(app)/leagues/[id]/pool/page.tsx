import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { auth } from "@/auth";
import { PoolEditor } from "@/components/leagues/PoolEditor";
import { db } from "@/lib/db";
import { getPoolEditor } from "@/lib/leagues/poolEditor";
import { fetchSeasonPool } from "@/lib/leagues/seasonPool";

export const metadata: Metadata = {
  title: "Draft pool · AniDraft",
  description: "Add or remove shows from your league's draft pool before finalize.",
};

// Reads the live league + AniList pool and drives a mutation, so it must never
// be statically cached. `auth()` already opts the route into dynamic rendering;
// this makes the intent explicit.
export const dynamic = "force-dynamic";

/**
 * `/leagues/[id]/pool` — the commissioner pool-override editor (issue #36).
 *
 * The proxy gates `(app)` routes, but we re-check the session here so a
 * signed-out visitor is sent to `/sign-in` with a `callbackUrl` back to this
 * page. Everything else is the same gate the API enforces, via
 * {@link getPoolEditor}: the page exists only for the **commissioner** of a
 * **private** league. A non-commissioner, a public-lobby commissioner, or an
 * unknown league all render a 404 here — we don't distinguish "forbidden" from
 * "missing" in the UI to avoid leaking which leagues exist; the API answers the
 * precise 403/404 for programmatic callers.
 *
 * Once the league finalizes, `view.frozen` is true and the editor renders
 * read-only.
 *
 * `params` is a Promise in this Next version (App Router), hence the `await`.
 */
export default async function LeaguePoolPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const session = await auth();
  if (!session?.user?.id) {
    redirect(`/sign-in?callbackUrl=${encodeURIComponent(`/leagues/${id}/pool`)}`);
  }

  const result = await getPoolEditor(db, id, session.user.id, fetchSeasonPool);
  if (result.status !== "ok") {
    // not_found / forbidden / public_unsupported all collapse to a 404 in the UI.
    notFound();
  }

  const { view } = result;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
      <div className="mb-8 space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Draft pool</h1>
        <p className="text-sm text-muted-foreground">
          {view.frozen
            ? "This league is finalized — the draft pool is locked."
            : "Add or remove shows before you finalize. These changes lock once the league is finalized."}
        </p>
      </div>

      <PoolEditor view={view} />
    </main>
  );
}
