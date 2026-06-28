/**
 * In-process rate-limit pacer for AniList (issue #42).
 *
 * AniList caps unauthenticated/authenticated clients at ~90 requests/minute and
 * answers 429 once you cross it. Rather than react to 429s alone, we *pace*
 * outbound requests so we stay under the cap by construction: a minimum gap
 * between consecutive requests.
 *
 * `DEFAULT_MIN_INTERVAL_MS = 700` → at most one request every 700ms ≈ 85.7
 * req/min, a safe margin under the 90 cap. The schedule is intentionally
 * conservative: bursting to exactly 90 leaves no headroom for clock skew or the
 * server's own window boundary.
 *
 * The exported `sharedPacer` is a module singleton, so *every* client instance
 * that doesn't pass its own pacer shares one pacing window across the whole
 * process — that's what enforces the cap "across all client instances", not
 * just per client.
 */

/** Default minimum gap between requests: ~85 req/min, safely under the 90 cap. */
export const DEFAULT_MIN_INTERVAL_MS = 700;

/** Resolve to a promise after `ms` milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Serializes request *timing* (not the requests themselves): each `acquire()`
 * call atomically reserves the next time slot and resolves once that slot is
 * reached. Concurrent callers therefore queue up at `minIntervalMs` spacing
 * without any of them racing for the same slot — slot reservation is a single
 * synchronous read-modify-write, uninterruptible in JS's single-threaded model.
 */
export class Pacer {
  readonly minIntervalMs: number;
  /** Epoch ms of the next free slot; 0 means "available now". */
  private nextSlot = 0;

  constructor(minIntervalMs: number = DEFAULT_MIN_INTERVAL_MS) {
    if (minIntervalMs < 0) {
      throw new RangeError("Pacer minIntervalMs must be >= 0");
    }
    this.minIntervalMs = minIntervalMs;
  }

  /** Wait until this caller's reserved slot, then resolve. */
  async acquire(): Promise<void> {
    const now = Date.now();
    // Reserve a slot no earlier than now and no earlier than the last reservation.
    const slot = Math.max(now, this.nextSlot);
    this.nextSlot = slot + this.minIntervalMs;
    const wait = slot - now;
    if (wait > 0) await sleep(wait);
  }
}

/**
 * Process-wide pacer shared by every `AniListClient` that doesn't supply its
 * own. This is what keeps the *aggregate* request rate under the cap even when
 * the cron worker and a web reader hold separate client instances.
 */
export const sharedPacer = new Pacer();
