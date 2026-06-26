"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import {
  joinLobbyAction,
  type JoinLobbyState,
} from "@/app/(app)/lobbies/actions";

/**
 * Client Join control for one lobby row. Wraps the {@link joinLobbyAction}
 * Server Action with `useActionState` for a pending spinner and inline result
 * feedback. `leagueId` is bound here so the action's own signature stays the
 * `(prevState, formData)` shape `useActionState` requires.
 *
 * A successful or already-member join also triggers `revalidatePath('/lobbies')`
 * server-side, so the surrounding list re-renders with fresh seat counts; this
 * component just reflects the outcome for the row the user clicked.
 */

const INITIAL: JoinLobbyState = { status: "idle" };

export function JoinLobbyButton({
  leagueId,
  leagueName,
}: {
  leagueId: string;
  leagueName: string;
}) {
  // `joinLobbyAction` takes only the league id; `useActionState` still calls it
  // with (prevState, formData), which the bound zero-extra-arg function ignores.
  const boundAction = joinLobbyAction.bind(null, leagueId);
  const [state, formAction, pending] = useActionState(boundAction, INITIAL);

  if (state.status === "joined" || state.status === "already_member") {
    return (
      <p
        role="status"
        className="text-sm font-medium text-primary"
        aria-live="polite"
      >
        {state.status === "joined" ? "You're in 🎉" : "Already a member 👍"}
      </p>
    );
  }

  return (
    <form action={formAction} className="flex flex-col items-end gap-1">
      <Button type="submit" size="sm" disabled={pending} aria-label={`Join ${leagueName}`}>
        {pending ? "Joining…" : "Join"}
      </Button>
      {state.status !== "idle" && (
        <p
          role="alert"
          className="text-right text-xs text-destructive-foreground"
          aria-live="polite"
        >
          {messageFor(state.status)}
        </p>
      )}
    </form>
  );
}

/** Short explanation for a join that couldn't complete (league changed). */
function messageFor(status: "not_found" | "wrong_state" | "league_full" | "error"): string {
  switch (status) {
    case "league_full":
      return "Just filled up — try another.";
    case "wrong_state":
      return "This league already started.";
    case "not_found":
      return "This league is no longer open.";
    case "error":
      return "Something went wrong. Try again.";
  }
}
