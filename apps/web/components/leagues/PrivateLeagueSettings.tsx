"use client";

import { useMemo, useState } from "react";
import {
  MAX_LEAGUE_PLAYERS,
  MAX_PICK_TIMER_SECONDS,
  MIN_LEAGUE_PLAYERS,
  MIN_PICK_TIMER_SECONDS,
} from "@anidraft/shared";

import { Button } from "@/components/ui/button";

import type { EditableField } from "@/lib/leagues/updateLeagueSettings";
import type { LeagueSettingsView } from "@/lib/leagues/updateLeagueSettings";

/**
 * Commissioner settings form for a private league (`PATCH /api/leagues/[id]`).
 *
 * One component covers every viewer + state combination:
 * - A non-commissioner (`canEdit=false`) sees a fully read-only summary.
 * - The commissioner sees inputs, but only the fields editable from the
 *   league's current lifecycle state are enabled (`editableFields`). In `setup`
 *   that's all four; once `finalized`, only the draft start; once drafting or
 *   later, none (the form collapses to the read-only summary).
 *
 * The form posts only the editable fields and mirrors the server's Zod
 * `fieldErrors` back onto the inputs; client-side `min`/`max` attributes are a
 * UX nicety, not the security boundary (the API re-validates).
 */

type FieldErrors = Record<string, string[] | undefined>;

const inputClasses =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-60";

/** Format a `Date` for an `<input type="datetime-local">` value (local time). */
function toDateTimeLocal(date: Date | null): string {
  if (!date) return "";
  // datetime-local wants `YYYY-MM-DDTHH:mm` in local time; trim the seconds and
  // timezone the ISO string carries by building from local parts.
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

export function PrivateLeagueSettings({
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

  // Nothing is editable (read-only viewer, or a drafting+ league) → render the
  // summary card with no form controls.
  const hasEditable = canEdit && editableFields.length > 0;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setFieldErrors({});
    setFormError(null);
    setSaved(false);

    const data = new FormData(event.currentTarget);

    // Send only the fields editable from this state. `draftStartsAt` maps an
    // empty input to an explicit `null` (clear the schedule).
    const payload: Record<string, unknown> = {};
    if (canEditField("name")) {
      payload.name = (data.get("name") as string).trim();
    }
    if (canEditField("maxPlayers")) {
      payload.maxPlayers = Number(data.get("maxPlayers"));
    }
    if (canEditField("pickTimerSeconds")) {
      payload.pickTimerSeconds = Number(data.get("pickTimerSeconds"));
    }
    if (canEditField("draftStartsAt")) {
      const raw = (data.get("draftStartsAt") as string) || "";
      payload.draftStartsAt = raw === "" ? null : raw;
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
        setFormError("Only the commissioner can edit these settings.");
        return;
      }

      if (res.status === 409) {
        setFormError(
          "These settings are locked now that the league has moved past setup.",
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
          You&apos;re viewing this league&apos;s settings. Only the commissioner
          can change them.
        </div>
      )}

      {canEdit && !hasEditable && (
        <div
          role="note"
          className="rounded-md border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground"
        >
          Settings are locked once the league moves past setup.
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
        <label htmlFor="name" className="block text-sm font-medium">
          League name
        </label>
        <input
          id="name"
          name="name"
          type="text"
          defaultValue={current.name}
          minLength={3}
          maxLength={50}
          disabled={!canEditField("name")}
          className={inputClasses}
          aria-invalid={fieldErrors.name ? "true" : undefined}
        />
        <FieldError errors={fieldErrors.name} />
      </div>

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
        <label htmlFor="pickTimerSeconds" className="block text-sm font-medium">
          Pick timer (seconds)
        </label>
        <input
          id="pickTimerSeconds"
          name="pickTimerSeconds"
          type="number"
          defaultValue={current.pickTimerSeconds}
          min={MIN_PICK_TIMER_SECONDS}
          max={MAX_PICK_TIMER_SECONDS}
          disabled={!canEditField("pickTimerSeconds")}
          className={inputClasses}
          aria-invalid={fieldErrors.pickTimerSeconds ? "true" : undefined}
        />
        <p className="text-xs text-muted-foreground">
          Between {MIN_PICK_TIMER_SECONDS} and {MAX_PICK_TIMER_SECONDS} seconds.
        </p>
        <FieldError errors={fieldErrors.pickTimerSeconds} />
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

      {hasEditable && (
        <Button type="submit" disabled={submitting} className="w-full">
          {submitting ? "Saving…" : "Save settings"}
        </Button>
      )}
    </form>
  );
}

function FieldError({ errors }: { errors: string[] | undefined }) {
  if (!errors || errors.length === 0) return null;
  return <p className="text-xs text-destructive-foreground">{errors[0]}</p>;
}
