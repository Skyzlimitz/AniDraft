import type { LobbyListing } from "@/lib/leagues/listLobbies";

import { JoinLobbyButton } from "./JoinLobbyButton";
import { LobbyDraftTime } from "./LobbyDraftTime";

/**
 * One lobby row: league name, commissioner, season, draft time, and seat count,
 * plus a Join control. This is a Server Component; the interactive Join button
 * and the draft-time stamp (which formats in the viewer's timezone) are the
 * Client Components that hydrate.
 */
export function LobbyCard({ lobby }: { lobby: LobbyListing }) {
  return (
    <article className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="space-y-2">
        <h2 className="text-lg font-semibold tracking-tight">{lobby.name}</h2>
        <dl className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <div className="flex gap-1">
            <dt className="sr-only">Commissioner</dt>
            <dd>👤 {lobby.commissionerName ?? "Unknown"}</dd>
          </div>
          <div className="flex gap-1">
            <dt className="sr-only">Season</dt>
            <dd>📺 {formatSeason(lobby.season, lobby.seasonYear)}</dd>
          </div>
          <div className="flex gap-1">
            <dt className="sr-only">Draft time</dt>
            <dd>
              🗓️{" "}
              {lobby.draftStartsAt ? (
                <LobbyDraftTime iso={lobby.draftStartsAt.toISOString()} />
              ) : (
                "Draft time TBD"
              )}
            </dd>
          </div>
        </dl>
      </div>

      <div className="flex items-center gap-4 sm:flex-col sm:items-end">
        <p className="text-sm font-medium" aria-label="Players">
          <span className="tabular-nums">
            {lobby.memberCount}/{lobby.maxPlayers}
          </span>{" "}
          <span className="text-muted-foreground">players</span>
        </p>
        {lobby.viewerIsMember ? (
          <p className="text-sm font-medium text-primary">You&apos;re in 👍</p>
        ) : (
          <JoinLobbyButton leagueId={lobby.id} leagueName={lobby.name} />
        )}
      </div>
    </article>
  );
}

/** "SPRING", 2026 → "Spring 2026". */
function formatSeason(season: string, year: number): string {
  const label = season.charAt(0) + season.slice(1).toLowerCase();
  return `${label} ${year}`;
}
