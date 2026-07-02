import { db } from "@/lib/db";
import { getCachedAnime } from "@/lib/anime/getCachedAnime";

/**
 * `GET /api/anime/[id]` — anime metadata + per-episode scores from the local
 * cache only (issue #45).
 *
 * This endpoint **never calls AniList live**: it reads the `anime` / `episodes`
 * mirror via {@link getCachedAnime} (which imports `@anidraft/db` only), so
 * user-triggered traffic can't burn the AniList rate limit. The cache is
 * populated out of band by the season-pool fetcher (#43) and the cron worker.
 *
 * No auth gate: anime metadata is public, non-user-scoped data, and absorbing
 * anonymous traffic is the whole point. The proxy (`proxy.ts`) excludes `/api`,
 * so the handler owns its own (absent) gate by design.
 *
 * - `200` — a {@link SerializedCachedAnime} body (`{ anime, episodes,
 *   fetchedAt, stale }` with `Date`s as ISO strings); `stale: true` when the
 *   cache is older than 7 days (or has no episode data yet).
 * - `400` — the id segment isn't a positive integer (AniList media ids are).
 * - `404` — a well-formed id that isn't in the cache yet.
 *
 * The `200` carries a `Cache-Control` header: the data is public and
 * explicitly stale-tolerant, so a short shared-cache TTL plus a long
 * `stale-while-revalidate` lets a CDN absorb repeat hits on a hot show instead
 * of every request reaching the DB. The TTL stays short (not the full 7-day
 * window) so a weekly cron refresh propagates quickly.
 *
 * `params` is a Promise in this Next version (App Router), hence the `await`.
 */

/** Shared-cache policy for the successful read (see the docblock above). */
const CACHE_CONTROL = "public, s-maxage=300, stale-while-revalidate=86400";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;

  // The AniList media id is a positive integer (the `anime` primary key). Reject
  // a malformed segment as a bad request rather than treating it as a miss.
  const animeId = Number(id);
  if (!/^\d+$/.test(id) || !Number.isSafeInteger(animeId) || animeId <= 0) {
    return Response.json({ error: "Invalid anime id" }, { status: 400 });
  }

  let cached;
  try {
    cached = await getCachedAnime(db, animeId);
  } catch (error) {
    console.error("Failed to read cached anime", error);
    return Response.json({ error: "Failed to load anime" }, { status: 500 });
  }

  if (!cached) {
    return Response.json({ error: "Anime not found" }, { status: 404 });
  }

  return Response.json(cached, {
    status: 200,
    headers: { "Cache-Control": CACHE_CONTROL },
  });
}
