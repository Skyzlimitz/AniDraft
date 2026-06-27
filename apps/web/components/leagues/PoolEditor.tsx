"use client";

import Image from "next/image";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import type {
  PoolEditorView,
  PoolEntry,
  PoolShow,
} from "@/lib/leagues/poolEditor";

/**
 * Commissioner pool-override editor (issue #36) — `GET`/`PUT /api/leagues/[id]/pool`.
 *
 * The editor shows the league's draft pool as two lists derived from one local
 * `entries` array: shows currently **in pool** and shows **excluded** from the
 * auto-fetched AniList season pool. Within a league in `setup`, the commissioner
 * can:
 * - toggle an auto-pool show off (it moves to "Excluded") or back on,
 * - search AniList and **add** a show the season filter missed (a `manual`
 *   entry), and remove that addition again, and
 * - **Save** — which `PUT`s the full override set (the excluded auto ids and the
 *   manual additions). The server replaces the league's overrides wholesale.
 *
 * Once the league is finalized, `view.frozen` is true: the lists render but all
 * controls are gone. The server is the real boundary — it answers 409 to a
 * frozen `PUT` and 403 to a non-commissioner — this just reflects that state.
 */

const SHOW_PLACEHOLDER_TITLE = "Untitled show";

export function PoolEditor({ view }: { view: PoolEditorView }) {
  const [entries, setEntries] = useState<PoolEntry[]>(view.entries);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const frozen = view.frozen;

  // Split for the two lists. Only auto-pool shows can be "excluded"; a manual
  // addition is removed outright, so it never appears in the excluded list.
  const inPool = useMemo(
    () => entries.filter((entry) => !entry.excluded),
    [entries],
  );
  const excluded = useMemo(
    () => entries.filter((entry) => entry.excluded),
    [entries],
  );

  // Ids already represented in the editor, so the search picker can mark a
  // result as "already added" / "back in pool" rather than create a duplicate.
  const presentIds = useMemo(
    () => new Set(entries.map((entry) => entry.anilistId)),
    [entries],
  );

  function markDirty() {
    setSaved(false);
    setError(null);
  }

  /** Toggle an auto-pool show off (exclude) or back on. No-op when frozen. */
  function toggleExcluded(anilistId: number) {
    if (frozen) return;
    markDirty();
    setEntries((prev) =>
      prev.map((entry) =>
        entry.anilistId === anilistId && entry.source === "auto"
          ? { ...entry, excluded: !entry.excluded }
          : entry,
      ),
    );
  }

  /** Drop a manual addition entirely. No-op when frozen. */
  function removeAddition(anilistId: number) {
    if (frozen) return;
    markDirty();
    setEntries((prev) =>
      prev.filter(
        (entry) =>
          !(entry.anilistId === anilistId && entry.source === "manual"),
      ),
    );
  }

  /**
   * Add a searched show. If it's already an excluded auto-pool show, re-include
   * it; if it's already present, do nothing; otherwise append a manual entry.
   */
  function addShow(show: PoolShow) {
    if (frozen) return;
    markDirty();
    setEntries((prev) => {
      const existing = prev.find((entry) => entry.anilistId === show.anilistId);
      if (existing) {
        return existing.excluded
          ? prev.map((entry) =>
              entry.anilistId === show.anilistId
                ? { ...entry, excluded: false }
                : entry,
            )
          : prev;
      }
      return [
        ...prev,
        { ...show, source: "manual" as const, excluded: false },
      ];
    });
  }

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    setError(null);

    const exclusions = entries
      .filter((entry) => entry.source === "auto" && entry.excluded)
      .map((entry) => entry.anilistId);
    const additions = entries
      .filter((entry) => entry.source === "manual")
      .map((entry) => ({
        anilistId: entry.anilistId,
        title: entry.title,
        coverImage: entry.coverImage,
      }));

    try {
      const res = await fetch(`/api/leagues/${view.leagueId}/pool`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ exclusions, additions }),
      });

      if (res.status === 200) {
        setSaved(true);
        return;
      }
      if (res.status === 409) {
        setError(
          "The pool is locked now that the league has been finalized. Reload to see the final pool.",
        );
        return;
      }
      if (res.status === 403) {
        setError("Only the commissioner can edit this league's pool.");
        return;
      }
      if (res.status === 401) {
        setError("Your session expired. Please sign in again.");
        return;
      }
      setError("Something went wrong saving the pool.");
    } catch {
      setError("Network error — check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-8">
      {frozen && (
        <div
          role="note"
          className="rounded-md border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground"
        >
          This league is finalized. The draft pool is locked and can no longer be
          changed.
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive-foreground"
        >
          {error}
        </div>
      )}

      {saved && (
        <div
          role="status"
          className="rounded-md border border-primary/40 bg-accent px-4 py-3 text-sm"
        >
          Pool saved.
        </div>
      )}

      {!frozen && (
        <AddShowSearch
          leagueId={view.leagueId}
          presentIds={presentIds}
          onAdd={addShow}
        />
      )}

      <ShowList
        heading="In pool"
        emptyText="No shows in the pool yet. Search above to add one."
        count={inPool.length}
        shows={inPool}
        frozen={frozen}
        renderAction={(entry) =>
          entry.source === "manual" ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => removeAddition(entry.anilistId)}
            >
              Remove
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => toggleExcluded(entry.anilistId)}
            >
              Exclude
            </Button>
          )
        }
      />

      <ShowList
        heading="Excluded"
        emptyText="Nothing excluded. Every auto-fetched show is in the pool."
        count={excluded.length}
        shows={excluded}
        frozen={frozen}
        renderAction={(entry) => (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => toggleExcluded(entry.anilistId)}
          >
            Add back
          </Button>
        )}
      />

      {!frozen && (
        <div className="flex items-center justify-end">
          <Button type="button" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save pool"}
          </Button>
        </div>
      )}
    </div>
  );
}

const showTitle = (show: PoolShow) =>
  show.title.trim() ? show.title : SHOW_PLACEHOLDER_TITLE;

/** A titled list of show rows with a per-row action slot. */
function ShowList({
  heading,
  emptyText,
  count,
  shows,
  frozen,
  renderAction,
}: {
  heading: string;
  emptyText: string;
  count: number;
  shows: PoolEntry[];
  frozen: boolean;
  renderAction: (entry: PoolEntry) => React.ReactNode;
}) {
  return (
    <section className="space-y-3" aria-label={heading}>
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">{heading}</h2>
        <span className="text-sm text-muted-foreground">{count}</span>
      </div>

      {shows.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          {emptyText}
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {shows.map((entry) => (
            <li
              key={entry.anilistId}
              className="flex items-center gap-3 px-4 py-3"
            >
              <ShowThumb show={entry} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {showTitle(entry)}
                </span>
                <span className="text-xs text-muted-foreground">
                  {entry.source === "manual" ? "Added manually" : "AniList pool"}
                </span>
              </span>
              {!frozen && renderAction(entry)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Search box that queries AniList and lets the commissioner add a result. */
function AddShowSearch({
  leagueId,
  presentIds,
  onAdd,
}: {
  leagueId: string;
  presentIds: Set<number>;
  onAdd: (show: PoolShow) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PoolShow[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  async function handleSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = query.trim();
    if (trimmed === "") return;
    setSearching(true);
    setError(null);
    setSearched(true);
    try {
      const res = await fetch(
        `/api/leagues/${leagueId}/pool?search=${encodeURIComponent(trimmed)}`,
      );
      if (!res.ok) {
        setError("Search failed. Try again.");
        setResults([]);
        return;
      }
      const body = (await res.json()) as { results: PoolShow[] };
      setResults(body.results);
    } catch {
      setError("Network error while searching.");
      setResults([]);
    } finally {
      setSearching(false);
    }
  }

  return (
    <section className="space-y-3" aria-label="Add a show">
      <h2 className="text-lg font-semibold">Add a show</h2>
      <form onSubmit={handleSearch} className="flex gap-2">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search AniList…"
          aria-label="Search AniList for a show"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        />
        <Button type="submit" disabled={searching || query.trim() === ""}>
          {searching ? "Searching…" : "Search"}
        </Button>
      </form>

      {error && (
        <p role="alert" className="text-sm text-destructive-foreground">
          {error}
        </p>
      )}

      {searched && !searching && !error && results.length === 0 && (
        <p className="text-sm text-muted-foreground">No shows found.</p>
      )}

      {results.length > 0 && (
        <ul className="divide-y divide-border rounded-md border border-border">
          {results.map((show) => {
            const alreadyPresent = presentIds.has(show.anilistId);
            return (
              <li
                key={show.anilistId}
                className="flex items-center gap-3 px-4 py-3"
              >
                <ShowThumb show={show} />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {showTitle(show)}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={alreadyPresent}
                  onClick={() => onAdd(show)}
                >
                  {alreadyPresent ? "In pool" : "Add"}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Small cover thumbnail; falls back to a neutral block when art is missing. */
function ShowThumb({ show }: { show: PoolShow }) {
  if (!show.coverImage) {
    return (
      <span
        aria-hidden="true"
        className="h-14 w-10 shrink-0 rounded bg-muted"
      />
    );
  }
  return (
    <Image
      src={show.coverImage}
      alt=""
      width={40}
      height={56}
      className="h-14 w-10 shrink-0 rounded object-cover"
    />
  );
}
