"use client";

import { useMemo, useState } from "react";
import { MAX_LEAGUE_PLAYERS, MIN_LEAGUE_PLAYERS } from "@anidraft/shared";

import { Button } from "@/components/ui/button";

import { toDateTimeLocal } from "@/lib/leagues/datetime";
import type {
  EditableField,
  LeagueSettingsView,
} from "@/lib/leagues/updateLeagueSettings";

/**
 * Commissioner settings form for a **public ("lobby")** league
 * (`PATCH /api/leagues/[id]`), the stripped counterpart to
 * {@link PrivateLeagueSettings} (issue #34).
 *
 * Public lobbies run on uniform, non-negotiable rules: the pick timer is locked
 * to 90s and the pool is fixed to the AniList tag, so this form exposes only the
 * two fields a commissioner may ever tune — **max players** and **draft start**
 * — and shows the locked rules as read-only context. As with the private form,
 * which of the two inputs is enabled depends on the league's lifecycle state via
 * `editableFields` (both in `setup`, only the draft start once `finalized`, none
 * once drafting). The API re-validates and rejects anything outside this
 * allowlist with a 403, so the disabled inputs here are UX, not the boundary.
 *
 * One component covers every viewer + state combination:
 * - A non-commissioner (`canEdit=false`) sees a read-only summary.
 * - The commissioner sees inputs, gated by `editableFields`.
 *
 * The form posts only the editable fields that actually changed and mirrors the
 * server's Zod `fieldErrors` back onto the inputs.
 */

type FieldErrors = Record<string, string[] | undefined>;

const inputClasses =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-60";

export function PublicLobbySettings({
  league,
  canEdit,
  editableFields,
}: {
  league: LeagueSettingsView;
  canEdit: boolean;
  editableFields: readonly EditableField[];
}) {
  const [current, setCurrent] = useState<LeagueSettingsView>(league);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const canEditField = useMemo(() => {
    const set = new Set(editableFields);
    return (field: EditableField) => canEdit && set.has(field);
  }, [canEdit, editableFields]);

  // Nothing is editable (read-only viewer, or a drafting+ lobby) → render the
  // summary card with no submit button.
  const hasEditable = canEdit && editableFields.length > 0;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setFieldErrors({});
    setFormError(null);
    setSaved(false);

    const data = new FormData(event.currentTarget);

    // Send only the allowlisted fields that actually changed. A diff-only
    // payload avoids resending a `draftStartsAt` that may have lapsed into the
    // past since page load (which the schema's future-only check would 400).
    const payload: Record<string, unknown> = {};
    if (canEditField("maxPlayers")) {
      const value = Number(data.get("maxPlayers"));
      if (value !== current.maxPlayers) payload.maxPlayers = value;
    }
    if (canEditField("draftStartsAt")) {
      const raw = (data.get("draftStartsAt") as string) || "";
      if (raw !== toDateTimeLocal(current.draftStartsAt)) {
        // Convert the timezone-less `datetime-local` value to a full ISO string
        // so the server stores the instant the commissioner intended. An empty
        // input clears the schedule (`null`).
        payload.draftStartsAt = raw === "" ? null : new Date(raw).toISOString();
      }
    }

    // Nothing changed — don't bother the server (an empty PATCH 400s anyway).
    if (Object.keys(payload).length === 0) {
      setFormError("No changes to save.");
      setSubmitting(false);
      return;
    }

    try {
      const res = await fetch(`/api/leagues/${current.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.status === 200) {
        const body = (await res.json()) as {
          league: LeagueSettingsView & { draftStartsAt: string | null };
        };
        setCurrent({
          ...body.league,
          draftStartsAt: body.league.draftStartsAt
            ? new Date(body.league.draftStartsAt)
            : null,
        });
        setSaved(true);
        return;
      }

      if (res.status === 400) {
        const body = (await res.json()) as { fieldErrors?: FieldErrors };
        setFieldErrors(body.fieldErrors ?? {});
        setFormError("Please fix the highlighted fields and try again.");
        return;
      }

      if (res.status === 403) {
        setFormError(
          "Public lobbies only allow changing the player count and draft time.",
        );
        return;
      }

      if (res.status === 409) {
        setFormError(
          "These settings are locked now that the draft has been finalized.",
        );
        return;
      }

      if (res.status === 401) {
        setFormError("Your session expired. Please sign in again.");
        return;
      }

      setFormError("Something went wrong saving your settings.");
    } catch {
      setFormError("Network error — check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6" noValidate>
      {!canEdit && (
        <div
          role="note"
          className="rounded-md border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground"
        >
          You&apos;re viewing this lobby&apos;s settings. Only the commissioner
          can change them.
        </div>
      )}

      {canEdit && !hasEditable && (
        <div
          role="note"
          className="rounded-md border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground"
        >
          Lobby settings are locked once the draft starts.
        </div>
      )}

      {formError && (
        <div
          role="alert"
          className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive-foreground"
        >
          {formError}
        </div>
      )}

      {saved && (
        <div
          role="status"
          className="rounded-md border border-primary/40 bg-accent px-4 py-3 text-sm"
        >
          Settings saved.
        </div>
      )}

      <div className="space-y-2">
        <label htmlFor="maxPlayers" className="block text-sm font-medium">
          Max players
        </label>
        <input
          id="maxPlayers"
          name="maxPlayers"
          type="number"
          defaultValue={current.maxPlayers}
          min={MIN_LEAGUE_PLAYERS}
          max={MAX_LEAGUE_PLAYERS}
          disabled={!canEditField("maxPlayers")}
          className={inputClasses}
          aria-invalid={fieldErrors.maxPlayers ? "true" : undefined}
        />
        <p className="text-xs text-muted-foreground">
          Between {MIN_LEAGUE_PLAYERS} and {MAX_LEAGUE_PLAYERS}, and never below
          the current {current.memberCount}{" "}
          {current.memberCount === 1 ? "member" : "members"}.
        </p>
        <FieldError errors={fieldErrors.maxPlayers} />
      </div>

      <div className="space-y-2">
        <label htmlFor="draftStartsAt" className="block text-sm font-medium">
          Draft start{" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <input
          id="draftStartsAt"
          name="draftStartsAt"
          type="datetime-local"
          defaultValue={toDateTimeLocal(current.draftStartsAt)}
          disabled={!canEditField("draftStartsAt")}
          className={inputClasses}
          aria-invalid={fieldErrors.draftStartsAt ? "true" : undefined}
        />
        <p className="text-xs text-muted-foreground">
          Leave blank to schedule the draft later.
        </p>
        <FieldError errors={fieldErrors.draftStartsAt} />
      </div>

      <LockedLobbyRules pickTimerSeconds={current.pickTimerSeconds} />

      {hasEditable && (
        <Button type="submit" disabled={submitting} className="w-full">
          {submitting ? "Saving…" : "Save settings"}
        </Button>
      )}
    </form>
  );
}

/**
 * Read-only summary of the lobby rules a commissioner can't change — the pick
 * timer (fixed at 90s) and the pool (the AniList tag). Shown so the page makes
 * clear *why* only two fields are editable, without offering them as inputs.
 */
function LockedLobbyRules({ pickTimerSeconds }: { pickTimerSeconds: number }) {
  return (
    <div className="space-y-2 rounded-md border border-border bg-muted/40 px-4 py-3">
      <p className="text-sm font-medium">Fixed lobby rules</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm text-muted-foreground">
        <dt>Pick timer</dt>
        <dd>{pickTimerSeconds}s (locked)</dd>
        <dt>Pool</dt>
        <dd>AniList tag (locked)</dd>
      </dl>
    </div>
  );
}

function FieldError({ errors }: { errors: string[] | undefined }) {
  if (!errors || errors.length === 0) return null;
  return <p className="text-xs text-destructive-foreground">{errors[0]}</p>;
}
