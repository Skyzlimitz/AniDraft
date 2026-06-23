import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { CreateLeagueForm } from "@/components/leagues/CreateLeagueForm";

export const metadata: Metadata = {
  title: "Create a league · AniDraft",
  description: "Spin up a private or public AniDraft league.",
};

/**
 * `/leagues/new` — the create-league page. The proxy already gates `(app)`
 * routes, but we re-check the session here so the page never renders the form
 * to a signed-out user (and so `CreateLeagueForm` can assume an authenticated
 * caller hits the API).
 */
export default async function NewLeaguePage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/sign-in?callbackUrl=%2Fleagues%2Fnew");
  }

  return (
    <main className="mx-auto w-full max-w-xl px-4 py-10 sm:px-6">
      <div className="mb-8 space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          Create a league
        </h1>
        <p className="text-sm text-muted-foreground">
          Set up your league, then invite players and finalize to start the
          draft.
        </p>
      </div>

      <CreateLeagueForm />
    </main>
  );
}
