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

export const createLeagueSchema = z.object({
  name: z
    .string()
    .min(3, "League name must be at least 3 characters")
    .max(50, "League name must be at most 50 characters"),
  visibility: z.enum(["public", "private"]),
  maxPlayers: z
    .number()
    .int("Max players must be a whole number")
    .min(MIN_LEAGUE_PLAYERS, `League needs at least ${MIN_LEAGUE_PLAYERS} players`)
    .max(MAX_LEAGUE_PLAYERS, `League can hold at most ${MAX_LEAGUE_PLAYERS} players`),
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

export const joinLeagueSchema = z.object({
  inviteCode: z.string().length(8, "Invite code must be 8 characters"),
});

export type JoinLeagueInput = z.infer<typeof joinLeagueSchema>;
