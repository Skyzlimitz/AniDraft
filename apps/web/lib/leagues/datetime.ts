/**
 * Date helpers shared by the league settings forms. Kept here (not inside a
 * component) so the private and public settings editors format the draft start
 * time identically and a single unit test pins the behaviour.
 */

/**
 * Format a `Date` for an `<input type="datetime-local">` value.
 *
 * `datetime-local` carries no timezone and wants `YYYY-MM-DDTHH:mm`, so we build
 * the string from the date's **local** parts — the same wall-clock time the
 * viewer sees. Returns an empty string for `null` (an unscheduled draft), which
 * renders as a blank input.
 */
export function toDateTimeLocal(date: Date | null): string {
  if (!date) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}
