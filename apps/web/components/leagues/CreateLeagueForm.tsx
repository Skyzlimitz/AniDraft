"use client";

import { useState } from "react";
import Link from "next/link";
import {
  MAX_LEAGUE_PLAYERS,
  MIN_LEAGUE_PLAYERS,
  type LeagueVisibility,
} from "@anidraft/shared";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Client form for `POST /api/leagues`. Collects the league settings, posts JSON
 * to the create-league route, and renders either field-level validation errors
 * (mirrored from the server's Zod `fieldErrors`) or a success panel — showing
 * the invite code for a private league, or a lobby confirmation for a public
 * one.
 *
 * The form is the single source of input; the server re-validates with the same
 * `createLeagueSchema`, so client-side `required`/`min`/`max` attributes are a
 * UX nicety, not the security boundary.
 */

const SEASONS = ["WINTER", "SPRING", "SUMMER", "FALL"] as const;

/** A small window of selectable years, clamped to the schema's 2020–2030. */
const CURRENT_YEAR = new Date().getFullYear();
const YEARS = [CURRENT_YEAR, CURRENT_YEAR + 1].filter(
  (year) => year >= 2020 && year <= 2030,
);

interface CreateLeagueSuccess {
  leagueId: string;
  inviteCode: string | null;
  visibility: LeagueVisibility;
}

type FieldErrors = Record<string, string[] | undefined>;

const inputClasses =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export function CreateLeagueForm() {
  const [visibility, setVisibility] = useState<LeagueVisibility>("private");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<CreateLeagueSuccess | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setFieldErrors({});
    setFormError(null);

    const form = event.currentTarget;
    const data = new FormData(form);
    const draftStartsAt = (data.get("draftStartsAt") as string) || undefined;

    const payload = {
      name: (data.get("name") as string).trim(),
      visibility,
      season: data.get("season") as string,
      seasonYear: Number(data.get("seasonYear")),
      maxPlayers: Number(data.get("maxPlayers")),
      ...(draftStartsAt ? { draftStartsAt } : {}),
    };

    try {
      const res = await fetch("/api/leagues", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.status === 201) {
        const body = (await res.json()) as {
          leagueId: string;
          inviteCode: string | null;
        };
        setSuccess({ ...body, visibility });
        return;
      }

      if (res.status === 400) {
        const body = (await res.json()) as { fieldErrors?: FieldErrors };
        setFieldErrors(body.fieldErrors ?? {});
        setFormError("Please fix the highlighted fields and try again.");
        return;
      }

      if (res.status === 401) {
        setFormError("Your session expired. Please sign in again.");
        return;
      }

      setFormError("Something went wrong creating your league.");
    } catch {
      setFormError("Network error — check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function copyInvite(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard may be unavailable (e.g. insecure context); the code is still
      // visible for manual copy.
    }
  }

  if (success) {
    return (
      <div
        role="status"
        className="space-y-5 rounded-xl border border-border bg-card p-6"
      >
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">League created 🎉</h2>
          <p className="text-sm text-muted-foreground">
            Your league is in <span className="font-medium">setup</span>. Invite
            players, then finalize to start the draft.
          </p>
        </div>

        {success.visibility === "private" && success.inviteCode ? (
          <div className="space-y-2">
            <p className="text-sm font-medium">Invite code</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-center font-mono text-lg tracking-[0.3em]">
                {success.inviteCode}
              </code>
              <Button
                type="button"
                variant="outline"
                onClick={() => copyInvite(success.inviteCode as string)}
              >
                {copied ? "Copied!" : "Copy"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Share this code so players can join your private league.
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Your public league is now listed in the lobby for anyone to join.
          </p>
        )}

        <div className="flex gap-3">
          <Button asChild>
            <Link href="/leagues">Go to my leagues</Link>
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setSuccess(null);
              setCopied(false);
            }}
          >
            Create another
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6" noValidate>
      {formError && (
        <div
          role="alert"
          className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive-foreground"
        >
          {formError}
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
          required
          minLength={3}
          maxLength={50}
          placeholder="Spring 2026 Showdown"
          className={inputClasses}
          aria-invalid={fieldErrors.name ? "true" : undefined}
        />
        <FieldError errors={fieldErrors.name} />
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Visibility</legend>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <VisibilityOption
            value="private"
            label="Private"
            description="Invite-only. Players join with a code you share."
            selected={visibility === "private"}
            onSelect={setVisibility}
          />
          <VisibilityOption
            value="public"
            label="Public"
            description="Listed in the lobby. 90s pick timer, fixed settings."
            selected={visibility === "public"}
            onSelect={setVisibility}
          />
        </div>
      </fieldset>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <label htmlFor="season" className="block text-sm font-medium">
            Season
          </label>
          <select
            id="season"
            name="season"
            defaultValue="SPRING"
            className={inputClasses}
          >
            {SEASONS.map((season) => (
              <option key={season} value={season}>
                {season.charAt(0) + season.slice(1).toLowerCase()}
              </option>
            ))}
          </select>
          <FieldError errors={fieldErrors.season} />
        </div>

        <div className="space-y-2">
          <label htmlFor="seasonYear" className="block text-sm font-medium">
            Year
          </label>
          <select
            id="seasonYear"
            name="seasonYear"
            defaultValue={String(YEARS[0])}
            className={inputClasses}
          >
            {YEARS.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
          <FieldError errors={fieldErrors.seasonYear} />
        </div>
      </div>

      <div className="space-y-2">
        <label htmlFor="maxPlayers" className="block text-sm font-medium">
          Max players
        </label>
        <input
          id="maxPlayers"
          name="maxPlayers"
          type="number"
          required
          min={MIN_LEAGUE_PLAYERS}
          max={MAX_LEAGUE_PLAYERS}
          defaultValue={8}
          className={inputClasses}
          aria-invalid={fieldErrors.maxPlayers ? "true" : undefined}
        />
        <p className="text-xs text-muted-foreground">
          Between {MIN_LEAGUE_PLAYERS} and {MAX_LEAGUE_PLAYERS} players.
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
          className={inputClasses}
          aria-invalid={fieldErrors.draftStartsAt ? "true" : undefined}
        />
        <p className="text-xs text-muted-foreground">
          Leave blank to schedule the draft later.
        </p>
        <FieldError errors={fieldErrors.draftStartsAt} />
      </div>

      <Button type="submit" disabled={submitting} className="w-full">
        {submitting ? "Creating…" : "Create league"}
      </Button>
    </form>
  );
}

function FieldError({ errors }: { errors: string[] | undefined }) {
  if (!errors || errors.length === 0) return null;
  return (
    <p className="text-xs text-destructive-foreground">{errors[0]}</p>
  );
}

function VisibilityOption({
  value,
  label,
  description,
  selected,
  onSelect,
}: {
  value: LeagueVisibility;
  label: string;
  description: string;
  selected: boolean;
  onSelect: (value: LeagueVisibility) => void;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer flex-col gap-1 rounded-lg border p-4 transition-colors",
        selected
          ? "border-primary bg-accent"
          : "border-border hover:border-input",
      )}
    >
      <span className="flex items-center gap-2">
        <input
          type="radio"
          name="visibility"
          value={value}
          checked={selected}
          onChange={() => onSelect(value)}
          className="size-4 accent-primary"
        />
        <span className="text-sm font-medium">{label}</span>
      </span>
      <span className="pl-6 text-xs text-muted-foreground">{description}</span>
    </label>
  );
}
