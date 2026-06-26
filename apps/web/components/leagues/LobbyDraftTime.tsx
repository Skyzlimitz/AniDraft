"use client";

import { useSyncExternalStore } from "react";

/**
 * Renders a lobby's draft time in the **viewer's** timezone.
 *
 * The surrounding `LobbyCard` is a Server Component, so formatting the date
 * there would use the deployment's `TZ` (UTC on most hosts) and silently
 * present a UTC wall-clock as if it were local. Instead the card passes the raw
 * ISO instant and this Client Component formats it: the server (and the first,
 * hydration-matching client render) show an explicit `UTC` time, then once
 * hydrated we render in the browser's local zone. Both renderings carry a
 * `timeZoneName`, so the time is never ambiguous.
 *
 * `useSyncExternalStore` drives the swap without a `setState`-in-effect: it
 * returns the server snapshot (`false`) during SSR and first paint — so the
 * markup matches and there's no hydration mismatch — then the client snapshot
 * (`true`) after hydration, triggering a normal re-render into local time.
 */

const subscribe = () => () => {};

function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}

export function LobbyDraftTime({ iso }: { iso: string }) {
  const hydrated = useHydrated();
  const date = new Date(iso);
  const text = hydrated
    ? date.toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
        timeZoneName: "short",
      })
    : date.toLocaleString("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "UTC",
        timeZoneName: "short",
      });

  return <time dateTime={iso}>{text}</time>;
}
