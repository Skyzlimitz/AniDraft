import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { joinLeagueSchema, type LeagueStatus } from "@anidraft/shared";

import { auth } from "@/auth";
import { Button } from "@/components/ui/button";
import { db } from "@/lib/db";
import { joinLeague, type JoinLeagueResult } from "@/lib/leagues/joinLeague";

export const metadata: Metadata = {
  title: "Join a league · AniDraft",
  description: "Join a private AniDraft league with your invite code.",
};

// This page mutates `league_members` as a side effect of being visited, so it
// must never be statically cached or its result reused. `auth()` already opts
// the route into dynamic rendering (it reads cookies); this makes that explicit.
export const dynamic = "force-dynamic";

/**
 * `/join/[code]` — join a private league via its invite code.
 *
 * The proxy already gates `(app)` routes, but we re-check the session here so we
 * can send a signed-out visitor to `/sign-in` with a `callbackUrl` that brings
 * them right back to this invite after they authenticate (instead of a generic
 * landing). Once authed, the join runs server-side via {@link joinLeague}, which
 * is idempotent — a refresh or a second visit shows "already a member" rather
 * than inserting a duplicate.
 *
 * `params` is a Promise in this Next version (App Router), hence the `await`.
 */
export default async function JoinLeaguePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;

  const session = await auth();
  if (!session?.user?.id) {
    redirect(`/sign-in?callbackUrl=${encodeURIComponent(`/join/${code}`)}`);
  }

  // A malformed code can't match any invite; skip the DB round-trip and render
  // the same "not valid" outcome the lookup would have produced.
  const parsed = joinLeagueSchema.safeParse({ inviteCode: code });
  const result: JoinLeagueResult = parsed.success
    ? await joinLeague(db, session.user.id, parsed.data.inviteCode)
    : { status: "invalid_code" };

  const outcome = describeOutcome(result);

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-16 sm:px-6">
      <div
        role="status"
        className="space-y-4 rounded-xl border border-border bg-card p-6 text-center"
      >
        <div className="space-y-2">
          <span className="text-3xl" aria-hidden="true">
            {outcome.icon}
          </span>
          <h1 className="text-xl font-semibold tracking-tight">
            {outcome.title}
          </h1>
          <p className="text-sm text-muted-foreground">{outcome.body}</p>
        </div>

        <div className="flex justify-center gap-3 pt-2">
          {outcome.leagueHref && (
            <Button asChild>
              <Link href={outcome.leagueHref}>Go to league</Link>
            </Button>
          )}
          <Button asChild variant={outcome.leagueHref ? "ghost" : "default"}>
            <Link href="/leagues">My leagues</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}

interface Outcome {
  icon: string;
  title: string;
  body: string;
  /** Link to the joined league, when the user is (now) a member. */
  leagueHref?: string;
}

/** Map a {@link JoinLeagueResult} to user-facing copy. */
function describeOutcome(result: JoinLeagueResult): Outcome {
  switch (result.status) {
    case "joined":
      return {
        icon: "🎉",
        title: "You're in!",
        body: "You've joined the league. Head over to see the roster and get ready to draft.",
        leagueHref: `/leagues/${result.leagueId}`,
      };
    case "already_member":
      return {
        icon: "👍",
        title: "You're already in this league",
        body: "No need to join again — you're already a member.",
        leagueHref: `/leagues/${result.leagueId}`,
      };
    case "invalid_code":
      return {
        icon: "🔍",
        title: "That invite code isn't valid",
        body: "Double-check the link with whoever invited you — this code doesn't match any league.",
      };
    case "expired":
      return {
        icon: "⌛",
        title: "This invite has expired",
        body: "Ask the league commissioner for a fresh invite link.",
      };
    case "wrong_state":
      return {
        icon: "🚦",
        title: "This league isn't taking new players",
        body: wrongStateBody(result.leagueStatus),
      };
    case "league_full":
      return {
        icon: "🚪",
        title: "This league is full",
        body: "Every seat is taken. Ask the commissioner if a spot opens up.",
      };
    default:
      // Exhaustiveness guard: a future `JoinLeagueResult` status added without a
      // case here becomes a compile error rather than rendering an empty card.
      return unexpectedOutcome(result);
  }
}

/**
 * Fallback {@link Outcome} for an unreachable result status. The `never`
 * parameter makes adding a `JoinLeagueResult` variant without a case above a
 * compile error.
 */
function unexpectedOutcome(result: never): Outcome {
  console.error("Unhandled join result", result);
  return {
    icon: "⚠️",
    title: "Something went wrong",
    body: "We couldn't process this invite. Please try again later.",
  };
}

/** State-specific explanation for why a non-`setup` league can't be joined. */
function wrongStateBody(status: LeagueStatus): string {
  switch (status) {
    case "finalized":
      return "The commissioner has locked the roster and the draft is about to begin, so it's no longer accepting new players.";
    case "drafting":
      return "The draft is already underway, so it's no longer accepting new players.";
    case "in_season":
      return "The season has already started, so it's no longer accepting new players.";
    case "completed":
      return "This league's season has already wrapped up.";
    case "setup":
      // Unreachable: `setup` leagues are joinable and never produce wrong_state.
      return "This league is no longer accepting new players.";
  }
}
