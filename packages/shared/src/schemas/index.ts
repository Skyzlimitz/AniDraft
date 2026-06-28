import { z } from "zod";

/**
 * Zod validation schemas for user inputs.
 * Used by both client (form validation) and server (API validation).
 */

/**
 * Inclusive bounds for a league's player count. Exported so form controls and
 * tests can reference the same numbers the validator enforces. The lower bound
 * keeps a draft competitive; the upper bound keeps `calculateDraftSize`
 * (`floor(50 / maxPlayers)`) from collapsing the per-player roster too far.
 */
export const MIN_LEAGUE_PLAYERS = 4;
export const MAX_LEAGUE_PLAYERS = 16;

/**
 * The minimum number of active members a league must have before a commissioner
 * can **finalize** it (issue #37). This is deliberately looser than
 * {@link MIN_LEAGUE_PLAYERS} (the floor for a league's *capacity*): a league is
 * created with room for at least {@link MIN_LEAGUE_PLAYERS}, but a draft only
 * needs two participants to be meaningful, so finalize is gated on actual
 * sign-ups, not the configured capacity. Exported so the finalize domain logic,
 * its API route, and the settings UI all reference one number.
 */
export const MIN_LEAGUE_MEMBERS_TO_FINALIZE = 2;

/**
 * Inclusive bounds (in seconds) for a league's per-pick draft timer, plus the
 * value the settings UI offers as a sensible starting point. Exported so the
 * commissioner settings form and the API validator agree on one set of numbers.
 * The `leagues.pick_timer_seconds` column defaults to 60 at the DB level; the
 * settings editor lets a private-league commissioner tune it anywhere in
 * [30, 300]. Public leagues are locked to {@link PUBLIC_PICK_TIMER_SECONDS}
 * (90) in `createLeague` and are never editable.
 */
export const MIN_PICK_TIMER_SECONDS = 30;
export const MAX_PICK_TIMER_SECONDS = 300;
export const DEFAULT_PICK_TIMER_SECONDS = 90;

export const createLeagueSchema = z.object({
  name: z
    .string()
    .min(3, "League name must be at least 3 characters")
    .max(50, "League name must be at most 50 characters"),
  visibility: z.enum(["public", "private"]),
  maxPlayers: z
    .number()
    .int("Max players must be a whole number")
    .min(
      MIN_LEAGUE_PLAYERS,
      `League needs at least ${MIN_LEAGUE_PLAYERS} players`,
    )
    .max(
      MAX_LEAGUE_PLAYERS,
      `League can hold at most ${MAX_LEAGUE_PLAYERS} players`,
    ),
  seasonYear: z
    .number()
    .int("Season year must be a whole number")
    .min(2020, "Season year must be 2020 or later")
    .max(2030, "Season year must be 2030 or earlier"),
  season: z.enum(["WINTER", "SPRING", "SUMMER", "FALL"]),
  // Optional to mirror the nullable `leagues.draft_starts_at` column: a
  // commissioner may schedule the draft later from league settings. When
  // supplied it must be a real, future instant. `z.coerce.date()` accepts the
  // ISO string an HTML `datetime-local` input (or JSON body) sends.
  draftStartsAt: z.coerce
    .date({ message: "Draft start must be a valid date and time" })
    .refine((value) => value.getTime() > Date.now(), {
      message: "Draft start must be in the future",
    })
    .optional(),
});

export type CreateLeagueInput = z.infer<typeof createLeagueSchema>;

/**
 * Body for `PATCH /api/leagues/:id` — a commissioner editing a private league's
 * settings. Every field is **optional**: the form sends only what changed, so
 * this is a partial update. A request with no editable field is rejected so an
 * empty PATCH can't masquerade as a successful no-op.
 *
 * What this schema can and cannot enforce:
 * - Static bounds live here — `name` length, `maxPlayers` in
 *   [{@link MIN_LEAGUE_PLAYERS}, {@link MAX_LEAGUE_PLAYERS}], `pickTimerSeconds`
 *   in [{@link MIN_PICK_TIMER_SECONDS}, {@link MAX_PICK_TIMER_SECONDS}], and a
 *   future-only `draftStartsAt`.
 * - State- and runtime-dependent rules do NOT — that only `draftStartsAt` is
 *   editable once a league is `finalized`, and that `maxPlayers` cannot drop
 *   below the current member count, both need the league row and live member
 *   count, so the domain layer (`updateLeagueSettings`) owns them.
 *
 * `draftStartsAt` is `.nullable()`: an ISO string (re)schedules the draft, and
 * an explicit `null` clears the schedule. Omitting the key leaves it untouched.
 */
export const updateLeagueSettingsSchema = z
  .object({
    name: z
      .string()
      .min(3, "League name must be at least 3 characters")
      .max(50, "League name must be at most 50 characters")
      .optional(),
    maxPlayers: z
      .number()
      .int("Max players must be a whole number")
      .min(
        MIN_LEAGUE_PLAYERS,
        `League needs at least ${MIN_LEAGUE_PLAYERS} players`,
      )
      .max(
        MAX_LEAGUE_PLAYERS,
        `League can hold at most ${MAX_LEAGUE_PLAYERS} players`,
      )
      .optional(),
    pickTimerSeconds: z
      .number()
      .int("Pick timer must be a whole number of seconds")
      .min(
        MIN_PICK_TIMER_SECONDS,
        `Pick timer must be at least ${MIN_PICK_TIMER_SECONDS} seconds`,
      )
      .max(
        MAX_PICK_TIMER_SECONDS,
        `Pick timer must be at most ${MAX_PICK_TIMER_SECONDS} seconds`,
      )
      .optional(),
    draftStartsAt: z.coerce
      .date({ message: "Draft start must be a valid date and time" })
      .refine((value) => value.getTime() > Date.now(), {
        message: "Draft start must be in the future",
      })
      .nullable()
      .optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "No settings to update",
  });

export type UpdateLeagueSettingsInput = z.infer<
  typeof updateLeagueSettingsSchema
>;

/**
 * Upper bound on how many shows a commissioner may manually add to the pool
 * (issue #36). The auto-fetched season pool is already dozens of shows; manual
 * additions are for the handful the AniList season filter missed, so this cap is
 * generous but keeps a single PUT from writing an unbounded number of rows.
 */
export const MAX_POOL_ADDITIONS = 50;

/**
 * One manually-added show in a pool-override payload. The client echoes back the
 * `title`/`coverImage` it received from the editor's GET so an added show — one
 * that is *not* in the AniList season fetch — can be rendered later without a
 * second lookup. `anilistId` identifies the show; `title` is required (a show
 * with no title is unrenderable); `coverImage` is optional (AniList may lack
 * art) and accepted as a URL or `null`.
 */
export const poolAdditionSchema = z.object({
  anilistId: z
    .number()
    .int("AniList id must be a whole number")
    .positive("AniList id must be positive"),
  title: z
    .string()
    .trim()
    .min(1, "Title is required")
    .max(500, "Title is too long"),
  coverImage: z
    .string()
    .trim()
    .url("Cover image must be a URL")
    .nullable()
    .default(null),
});

export type PoolAdditionInput = z.infer<typeof poolAdditionSchema>;

/**
 * Body for `PUT /api/leagues/:id/pool` — the commissioner's full override set
 * for a private league's draft pool (issue #36). This is a **replace**, not a
 * patch: the two arrays together describe the entire override state, so the
 * domain layer can rebuild it transactionally and a removed exclusion/addition
 * simply isn't present. Both default to empty, so an "all overrides cleared"
 * save is a `{}` (or `{ exclusions: [], additions: [] }`) body.
 *
 * - `exclusions` — AniList ids of auto-pool shows the commissioner removed.
 * - `additions`  — shows the commissioner added that the season fetch missed.
 */
export const updatePoolOverridesSchema = z.object({
  exclusions: z
    .array(
      z
        .number()
        .int("AniList id must be a whole number")
        .positive("AniList id must be positive"),
    )
    .max(500, "Too many exclusions")
    .default([]),
  additions: z
    .array(poolAdditionSchema)
    .max(MAX_POOL_ADDITIONS, `At most ${MAX_POOL_ADDITIONS} added shows`)
    .default([]),
});

export type UpdatePoolOverridesInput = z.infer<
  typeof updatePoolOverridesSchema
>;

export const joinLeagueSchema = z.object({
  // Normalize before validating: codes are generated from an uppercase-only
  // alphabet, so a hand-typed `join2345` or one with stray surrounding
  // whitespace should match the stored code rather than fail as `invalid_code`.
  // Trim + uppercase first, then enforce the length the generator produces.
  inviteCode: z
    .string()
    .trim()
    .toUpperCase()
    .pipe(z.string().length(8, "Invite code must be 8 characters")),
});

export type JoinLeagueInput = z.infer<typeof joinLeagueSchema>;

/**
 * Body for the code-free, public-lobby join: the league is named directly by
 * its id (a UUID), so there's no secret to present — the league's `public`
 * visibility is the invitation. Mirrors `joinLeagueSchema` for the no-code case.
 */
export const joinPublicLeagueSchema = z.object({
  leagueId: z.string().trim().min(1, "leagueId is required"),
});

export type JoinPublicLeagueInput = z.infer<typeof joinPublicLeagueSchema>;
