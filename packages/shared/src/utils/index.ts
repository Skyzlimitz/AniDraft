/**
 * Shared utility functions.
 */

/**
 * Characters used in invite codes. 32 unambiguous symbols — no I/O/0/1, which
 * are easy to misread aloud or in print.
 */
const INVITE_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const INVITE_CODE_LENGTH = 8;

/**
 * Generate a random 8-character invite code.
 *
 * Uses the Web Crypto CSPRNG (`crypto.getRandomValues`), not `Math.random()`:
 * the code is the access gate for a private league, so it must not be
 * predictable. The alphabet is exactly 32 characters, which divides 256
 * evenly, so mapping each random byte with `% 32` is unbiased — no rejection
 * sampling needed.
 */
export function generateInviteCode(): string {
  const bytes = new Uint8Array(INVITE_CODE_LENGTH);
  globalThis.crypto.getRandomValues(bytes);
  let code = "";
  for (const byte of bytes) {
    code += INVITE_CODE_ALPHABET[byte % INVITE_CODE_ALPHABET.length];
  }
  return code;
}

/**
 * Format a date as a relative time string (e.g., "2 hours ago").
 */
export function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

  const intervals = [
    { label: "year", seconds: 31536000 },
    { label: "month", seconds: 2592000 },
    { label: "week", seconds: 604800 },
    { label: "day", seconds: 86400 },
    { label: "hour", seconds: 3600 },
    { label: "minute", seconds: 60 },
  ] as const;

  for (const interval of intervals) {
    const count = Math.floor(seconds / interval.seconds);
    if (count >= 1) {
      return `${count} ${interval.label}${count > 1 ? "s" : ""} ago`;
    }
  }

  return "just now";
}

/**
 * Calculate draft size: 50 / number of players.
 */
export function calculateDraftSize(playerCount: number): number {
  return Math.floor(50 / playerCount);
}
