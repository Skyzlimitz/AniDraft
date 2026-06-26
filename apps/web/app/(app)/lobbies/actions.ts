"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { joinPublicLeague } from "@/lib/leagues/joinPublicLeague";

/**
 * Result the lobby's Join button renders. `joined`/`already_member` carry the
 * `leagueId` for a follow-up link; the rest are terminal messages. There is no
 * `unauthenticated` variant — a signed-out clicker is redirected to sign-in
 * before any result is produced.
 */
export type JoinLobbyState =
  | { status: "idle" }
  | { status: "joined"; leagueId: string }
  | { status: "already_member"; leagueId: string }
  | { status: "not_found" }
  | { status: "wrong_state" }
  | { status: "league_full" }
  | { status: "error" };

/**
 * Server Action behind the lobby Join button. `leagueId` is bound on the client;
 * the action always derives fresh state from the join attempt, so it ignores the
 * `prevState`/`formData` that `useActionState` would otherwise pass (a zero-arg
 * function is still assignable to React's action type).
 *
 * Server Actions are reachable by direct POST, so this re-checks `auth()` itself
 * rather than trusting the page gate: a signed-out caller is redirected to
 * sign-in with a `callbackUrl` back to the lobby; a signed-in one runs the
 * idempotent {@link joinPublicLeague}. On any membership-changing outcome we
 * `revalidatePath('/lobbies')` so the list re-renders with fresh seat counts
 * (and drops the league if that join filled it).
 */
export async function joinLobbyAction(
  leagueId: string,
): Promise<JoinLobbyState> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    redirect(`/sign-in?callbackUrl=${encodeURIComponent("/lobbies")}`);
  }

  try {
    const result = await joinPublicLeague(db, userId, leagueId);
    // `joined` / `already_member` change what the list should show; revalidate
    // so seat counts and membership badges reflect the new state.
    revalidatePath("/lobbies");

    switch (result.status) {
      case "joined":
        return { status: "joined", leagueId: result.leagueId };
      case "already_member":
        return { status: "already_member", leagueId: result.leagueId };
      case "not_found":
        return { status: "not_found" };
      case "wrong_state":
        return { status: "wrong_state" };
      case "league_full":
        return { status: "league_full" };
    }
  } catch (error) {
    console.error("Failed to join public league", error);
    return { status: "error" };
  }
}
