"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { LeagueSettingsView } from "@/lib/leagues/updateLeagueSettings";

/**
 * The commissioner's "Finalize league" control (issue #37): a button plus a
 * confirmation modal that POSTs to `/api/leagues/[id]/finalize`. Shared by both
 * {@link PrivateLeagueSettings} and {@link PublicLobbySettings} so the finalize
 * flow (confirmation copy, error/precondition handling, request shaping) lives
 * in one place; each settings form renders it only while it owns an editable,
 * still-in-`setup` league and reacts to {@link onFinalized} to lock its inputs.
 *
 * Finalizing is a one-way transition that locks the roster, the pool, and every
 * setting except the draft start time, so the modal makes that explicit before
 * the commissioner commits. The API is the real boundary: it re-checks the
 * commissioner, the preconditions, and idempotency, and this control surfaces
 * each failure shape (422 precondition list, 403/409/401) as readable copy.
 */

/** A finalize precondition failure, as the 422 response shapes it. */
interface PreconditionFailure {
  code: string;
  message: string;
}

export function FinalizeLeagueControl({
  leagueId,
  onFinalized,
}: {
  leagueId: string;
  /** Called with the finalized league view once the API confirms the change. */
  onFinalized: (league: LeagueSettingsView) => void;
}) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failures, setFailures] = useState<PreconditionFailure[]>([]);

  function close() {
    if (submitting) return;
    setOpen(false);
    setError(null);
    setFailures([]);
  }

  async function handleFinalize() {
    setSubmitting(true);
    setError(null);
    setFailures([]);
    try {
      const res = await fetch(`/api/leagues/${leagueId}/finalize`, {
        method: "POST",
      });

      if (res.status === 200) {
        const body = (await res.json()) as {
          league: LeagueSettingsView & { finalizedAt: string | null };
        };
        onFinalized({ ...body.league });
        setOpen(false);
        return;
      }

      if (res.status === 422) {
        const body = (await res.json()) as { failures?: PreconditionFailure[] };
        setFailures(body.failures ?? []);
        return;
      }

      if (res.status === 403) {
        setError("Only the commissioner can finalize this league.");
        return;
      }

      if (res.status === 409) {
        setError(
          "This league has already moved past setup and can't be finalized again.",
        );
        return;
      }

      if (res.status === 401) {
        setError("Your session expired. Please sign in again.");
        return;
      }

      setError("Something went wrong finalizing the league.");
    } catch {
      setError("Network error — check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="space-y-3" aria-labelledby="finalize-heading">
      <div className="space-y-1">
        <h2 id="finalize-heading" className="text-lg font-semibold">
          Finalize league
        </h2>
        <p className="text-sm text-muted-foreground">
          Lock the roster, pool, and settings (except the draft time) and get
          ready for the draft. This can&apos;t be undone.
        </p>
      </div>
      <Button
        type="button"
        onClick={() => {
          setError(null);
          setFailures([]);
          setOpen(true);
        }}
      >
        Finalize league
      </Button>

      {open && (
        <ConfirmFinalizeDialog
          submitting={submitting}
          error={error}
          failures={failures}
          onCancel={close}
          onConfirm={handleFinalize}
        />
      )}
    </section>
  );
}

/**
 * Confirmation modal shown before finalize takes effect. Mirrors the kick
 * dialog's pattern (a labelled fixed overlay, controls disabled while the
 * request is in flight) and additionally renders the server's precondition
 * failures inline so the commissioner sees exactly what to fix.
 */
function ConfirmFinalizeDialog({
  submitting,
  error,
  failures,
  onCancel,
  onConfirm,
}: {
  submitting: boolean;
  error: string | null;
  failures: PreconditionFailure[];
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-finalize-title"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm space-y-4 rounded-lg border border-border bg-background p-6 shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="space-y-2">
          <h2 id="confirm-finalize-title" className="text-lg font-semibold">
            Finalize this league?
          </h2>
          <p className="text-sm text-muted-foreground">
            The roster, draft pool, and settings will lock. You&apos;ll still be
            able to change the draft start time, but nothing else. This
            can&apos;t be undone.
          </p>
        </div>

        {failures.length > 0 && (
          <div
            role="alert"
            className="space-y-1 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground"
          >
            <p className="font-medium">Not ready to finalize yet:</p>
            <ul className="list-disc space-y-1 pl-5">
              {failures.map((failure) => (
                <li key={failure.code}>{failure.message}</li>
              ))}
            </ul>
          </div>
        )}

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
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button type="button" onClick={onConfirm} disabled={submitting}>
            {submitting ? "Finalizing…" : "Finalize league"}
          </Button>
        </div>
      </div>
    </div>
  );
}
