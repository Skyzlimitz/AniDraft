import type { Metadata } from "next";
import Link from "next/link";

import { auth } from "@/auth";
import { Button } from "@/components/ui/button";
import { LobbyCard } from "@/components/leagues/LobbyCard";
import { db } from "@/lib/db";
import { listLobbies, LOBBY_PAGE_SIZE } from "@/lib/leagues/listLobbies";

export const metadata: Metadata = {
  title: "Lobbies · AniDraft",
  description:
    "Browse public AniDraft leagues that are open and looking for players to join.",
};

// The lobby reflects live membership (a league drops off as it fills or drafts),
// so it must never be statically cached. `auth()` already opts the route into
// dynamic rendering; this makes the intent explicit.
export const dynamic = "force-dynamic";

/**
 * `/lobbies` — the site-wide list of public leagues currently accepting players
 * (issue #31). Public per `PUBLIC_ROUTES`, so a signed-out visitor can browse;
 * the Join button re-checks auth and bounces them to sign-in if needed.
 *
 * `searchParams` is a Promise in this Next version (App Router); `?page` drives
 * offset pagination. We pass the viewer's id (if any) so their own public
 * leagues render a "you're in" badge instead of a Join button.
 */
export default async function LobbiesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageParam } = await searchParams;
  const requestedPage = Number.parseInt(pageParam ?? "1", 10);
  const page = Number.isFinite(requestedPage) ? requestedPage : 1;

  const session = await auth();
  const viewerId = session?.user?.id ?? null;

  const { lobbies, total, page: currentPage, totalPages } = await listLobbies(db, {
    page,
    pageSize: LOBBY_PAGE_SIZE,
    viewerId,
  });

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">Open lobbies</h1>
          <p className="text-sm text-muted-foreground">
            {total === 0
              ? "No public leagues are open right now."
              : `${total} public ${total === 1 ? "league is" : "leagues are"} looking for players.`}
          </p>
        </div>
        {viewerId && (
          <Button asChild variant="outline">
            <Link href="/leagues/new">Create a league</Link>
          </Button>
        )}
      </div>

      {lobbies.length === 0 ? (
        <EmptyState canCreate={!!viewerId} />
      ) : (
        <ul className="space-y-4">
          {lobbies.map((lobby) => (
            <li key={lobby.id}>
              <LobbyCard lobby={lobby} />
            </li>
          ))}
        </ul>
      )}

      {totalPages > 1 && (
        <nav
          className="mt-8 flex items-center justify-between"
          aria-label="Lobby pages"
        >
          <PageLink page={currentPage - 1} disabled={currentPage <= 1}>
            ← Previous
          </PageLink>
          <span className="text-sm text-muted-foreground" aria-current="page">
            Page {currentPage} of {totalPages}
          </span>
          <PageLink page={currentPage + 1} disabled={currentPage >= totalPages}>
            Next →
          </PageLink>
        </nav>
      )}
    </main>
  );
}

/** A prev/next pagination control; renders a disabled span at the ends. */
function PageLink({
  page,
  disabled,
  children,
}: {
  page: number;
  disabled: boolean;
  children: React.ReactNode;
}) {
  if (disabled) {
    return (
      <span className="text-sm text-muted-foreground/50" aria-disabled="true">
        {children}
      </span>
    );
  }
  return (
    <Button asChild variant="ghost" size="sm">
      <Link href={`/lobbies?page=${page}`}>{children}</Link>
    </Button>
  );
}

/** Shown when no lobby is open — nudges signed-in users to start one. */
function EmptyState({ canCreate }: { canCreate: boolean }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card/50 p-10 text-center">
      <p className="text-3xl" aria-hidden="true">
        🏟️
      </p>
      <h2 className="mt-3 text-lg font-semibold">No open lobbies yet</h2>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
        Public leagues show up here while they&apos;re in setup and have room.
        {canCreate
          ? " Be the first to spin one up."
          : " Sign in to create one and get the lobby started."}
      </p>
      <div className="mt-5">
        <Button asChild>
          <Link href={canCreate ? "/leagues/new" : "/sign-in?callbackUrl=%2Flobbies"}>
            {canCreate ? "Create a league" : "Sign in"}
          </Link>
        </Button>
      </div>
    </div>
  );
}
