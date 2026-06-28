"use client";

import { useMemo, useState } from "react";
import {
  MAX_LEAGUE_PLAYERS,
  MAX_PICK_TIMER_SECONDS,
  MIN_LEAGUE_PLAYERS,
  MIN_PICK_TIMER_SECONDS,
} from "@anidraft/shared";

import { Button } from "@/components/ui/button";
import { FinalizeLeagueControl } from "@/components/leagues/FinalizeLeagueControl";

import { toDateTimeLocal } from "@/lib/leagues/datetime";
import type { LeagueMemberView } from "@/lib/leagues/getLeagueSettings";
import type { EditableField } from "@/lib/leagues/updateLeagueSettings";
import type { LeagueSettingsView } from "@/lib/leagues/updateLeagueSettings";

/**
 * The fields still editable once a league is `finalized` — only the draft start
 * time. Mirrors `editableFieldsFor("finalized")` in `updateLeagueSettings`, kept
 * as a local constant so this client component doesn't import that server-side
 * module (and its DB deps). The API remains the boundary; this only drives the
 * optimistic UI lock after an in-page finalize.
 */
const FINALIZED_EDITABLE_FIELDS: readonly EditableField[] = ["draftStartsAt"];

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

export function PrivateLeagueSettings({
  league,
  canEdit,
  editableFields,
  members,
}: {
  league: LeagueSettingsView;
  canEdit: boolean;
  editableFields: readonly EditableField[];
  members: LeagueMemberView[];
}) {
  const [current, setCurrent] = useState<LeagueSettingsView>(league);
  // Editable set lives in state so an in-page finalize can narrow it (to just the
  // draft time) without a reload; seeded from the server-computed prop.
  const [editable, setEditable] =
    useState<readonly EditableField[]>(editableFields);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Member roster state lives here so a successful kick can drop the player from
  // the list immediately (acceptance criterion), without a page reload.
  const [roster, setRoster] = useState<LeagueMemberView[]>(members);
  const [pendingKick, setPendingKick] = useState<LeagueMemberView | null>(null);
  const [kicking, setKicking] = useState(false);
  const [kickError, setKickError] = useState<string | null>(null);

  // The commissioner can only remove players while the league is in setup; the
  // server enforces this too (403 once finalized), this just hides the controls.
  const canKick = canEdit && current.status === "setup";

  async function handleKick(member: LeagueMemberView) {
    setKicking(true);
    setKickError(null);
    try {
      const res = await fetch(
        `/api/leagues/${current.id}/members/${member.userId}`,
        { method: "DELETE" },
      );

      if (res.status === 200 || res.status === 404) {
        // 404 means the player is already gone (kicked elsewhere / never a
        // member) — either way, reflect that they're not on the roster.
        setRoster((prev) => prev.filter((m) => m.userId !== member.userId));
        setPendingKick(null);
        return;
      }

      if (res.status === 403) {
        setKickError(
          "You can't remove this player — the league may have moved past setup.",
        );
        return;
      }

      if (res.status === 401) {
        setKickError("Your session expired. Please sign in again.");
        return;
      }

      setKickError("Something went wrong removing this player.");
    } catch {
      setKickError("Network error — check your connection and try again.");
    } finally {
      setKicking(false);
    }
  }

  const canEditField = useMemo(() => {
    const set = new Set(editable);
    return (field: EditableField) => canEdit && set.has(field);
  }, [canEdit, editable]);

  // Nothing is editable (read-only viewer, or a drafting+ league) → render the
  // summary card with no form controls.
  const hasEditable = canEdit && editable.length > 0;

  // Once finalized, lock everything but the draft time and reflect the new
  // status, so the form, roster controls, and finalize button all update in
  // place — the server has already made this authoritative.
  function handleFinalized(finalized: LeagueSettingsView) {
    setCurrent((prev) => ({ ...prev, ...finalized }));
    setEditable(FINALIZED_EDITABLE_FIELDS);
  }

  // The finalize control is the commissioner's, and only while the league is
  // still in setup.
  const canFinalize = canEdit && current.status === "setup";

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setFieldErrors({});
    setFormError(null);
    setSaved(false);

    const data = new FormData(event.currentTarget);

    // Send only the fields that are both editable from this state AND actually
    // changed. Resending an untouched field is wasteful, and for `draftStartsAt`
    // it's a correctness bug: a schedule that's still in the future when the
    // page loads can lapse into the past before the commissioner saves an
    // unrelated edit, and resending that now-past timestamp would trip the
    // schema's future-only check and 400 the whole PATCH. A diff-only payload
    // lets name/maxPlayers edits through regardless of a stale schedule.
    const payload: Record<string, unknown> = {};
    if (canEditField("name")) {
      const value = (data.get("name") as string).trim();
      if (value !== current.name) payload.name = value;
    }
    if (canEditField("maxPlayers")) {
      const value = Number(data.get("maxPlayers"));
      if (value !== current.maxPlayers) payload.maxPlayers = value;
    }
    if (canEditField("pickTimerSeconds")) {
      const value = Number(data.get("pickTimerSeconds"));
      if (value !== current.pickTimerSeconds) payload.pickTimerSeconds = value;
    }
    if (canEditField("draftStartsAt")) {
      const raw = (data.get("draftStartsAt") as string) || "";
      if (raw !== toDateTimeLocal(current.draftStartsAt)) {
        // Convert the timezone-less `datetime-local` value to a full ISO string
        // (with the viewer's UTC offset applied) so the server stores the
        // instant the commissioner intended, not the same wall-clock time read
        // in the server's timezone. An empty input clears the schedule (`null`).
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
        setFormError("Only the commissioner can edit these settings.");
        return;
      }

      if (res.status === 409) {
        setFormError(
          current.visibility === "public"
            ? "Public league settings are fixed and can't be changed."
            : "These settings are locked now that the league has moved past setup.",
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
    <div className="space-y-10">
      <form onSubmit={handleSubmit} className="space-y-6" noValidate>
        {!canEdit && (
          <div
            role="note"
            className="rounded-md border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground"
          >
            You&apos;re viewing this league&apos;s settings. Only the
            commissioner can change them.
          </div>
        )}

        {canEdit && !hasEditable && (
          <div
            role="note"
            className="rounded-md border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground"
          >
            {current.visibility === "public"
              ? "Public league settings are fixed and can't be changed."
              : "Settings are locked once the league moves past setup."}
          </div>
        )}

        {canEdit && current.status === "finalized" && (
          <div
            role="status"
            className="rounded-md border border-primary/40 bg-accent px-4 py-3 text-sm"
          >
            League finalized. The roster and pool are locked — only the draft
            start time can still be changed.
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
            Between {MIN_LEAGUE_PLAYERS} and {MAX_LEAGUE_PLAYERS}, and never
            below the current {current.memberCount}{" "}
            {current.memberCount === 1 ? "member" : "members"}.
          </p>
          <FieldError errors={fieldErrors.maxPlayers} />
        </div>

        <div className="space-y-2">
          <label
            htmlFor="pickTimerSeconds"
            className="block text-sm font-medium"
          >
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
            Between {MIN_PICK_TIMER_SECONDS} and {MAX_PICK_TIMER_SECONDS}{" "}
            seconds.
          </p>
          <FieldError errors={fieldErrors.pickTimerSeconds} />
        </div>

        <div className="space-y-2">
          <label htmlFor="draftStartsAt" className="block text-sm font-medium">
            Draft start{" "}
            <span className="font-normal text-muted-foreground">
              (optional)
            </span>
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

      {/* Roster is members-only: the page sends an empty list to non-members,
          so there's nothing to render for them. */}
      {roster.length > 0 && (
        <MemberRoster
          members={roster}
          canKick={canKick}
          onKick={(member) => {
            setKickError(null);
            setPendingKick(member);
          }}
        />
      )}

      {canFinalize && (
        <FinalizeLeagueControl
          leagueId={current.id}
          onFinalized={handleFinalized}
        />
      )}

      {pendingKick && (
        <ConfirmKickDialog
          member={pendingKick}
          kicking={kicking}
          error={kickError}
          onCancel={() => {
            if (kicking) return;
            setPendingKick(null);
            setKickError(null);
          }}
          onConfirm={() => handleKick(pendingKick)}
        />
      )}
    </div>
  );
}

const memberLabel = (member: LeagueMemberView) =>
  member.name?.trim() ? member.name : "Unnamed player";

/**
 * The active roster. Each non-commissioner row gets a Remove button when the
 * viewer is the commissioner and the league is still in setup. The
 * commissioner's own row is never removable (no self-kick).
 */
function MemberRoster({
  members,
  canKick,
  onKick,
}: {
  members: LeagueMemberView[];
  canKick: boolean;
  onKick: (member: LeagueMemberView) => void;
}) {
  return (
    <section className="space-y-3" aria-labelledby="members-heading">
      <div className="space-y-1">
        <h2 id="members-heading" className="text-lg font-semibold">
          Members
        </h2>
        <p className="text-sm text-muted-foreground">
          {members.length} {members.length === 1 ? "player" : "players"} in this
          league.
        </p>
      </div>

      <ul className="divide-y divide-border rounded-md border border-border">
        {members.map((member) => {
          const isCommissioner = member.role === "commissioner";
          return (
            <li
              key={member.userId}
              className="flex items-center justify-between gap-3 px-4 py-3"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">
                  {memberLabel(member)}
                </span>
                <span className="text-xs text-muted-foreground">
                  {isCommissioner ? "Commissioner" : "Player"}
                </span>
              </span>
              {canKick && !isCommissioner && (
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={() => onKick(member)}
                >
                  Remove
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * Confirmation modal shown before a kick takes effect. Backed by a fixed
 * overlay rather than a shadcn Dialog (not yet in `components/ui`); it traps
 * nothing but is labelled for assistive tech and disables its controls while
 * the request is in flight.
 */
function ConfirmKickDialog({
  member,
  kicking,
  error,
  onCancel,
  onConfirm,
}: {
  member: LeagueMemberView;
  kicking: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-kick-title"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm space-y-4 rounded-lg border border-border bg-background p-6 shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="space-y-2">
          <h2 id="confirm-kick-title" className="text-lg font-semibold">
            Remove {memberLabel(member)}?
          </h2>
          <p className="text-sm text-muted-foreground">
            They&apos;ll be removed from the league and their seat freed up.
            They can re-join later with an invite.
          </p>
        </div>

        {error && (
          <div
            role="alert"
            className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground"
          >
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={kicking}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={onConfirm}
            disabled={kicking}
          >
            {kicking ? "Removing…" : "Remove player"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function FieldError({ errors }: { errors: string[] | undefined }) {
  if (!errors || errors.length === 0) return null;
  return <p className="text-xs text-destructive-foreground">{errors[0]}</p>;
}
