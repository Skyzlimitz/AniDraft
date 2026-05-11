import { z } from "zod";

/**
 * Zod validation schemas for user inputs.
 * Used by both client (form validation) and server (API validation).
 */

export const createLeagueSchema = z.object({
  name: z
    .string()
    .min(3, "League name must be at least 3 characters")
    .max(50, "League name must be at most 50 characters"),
  visibility: z.enum(["public", "private"]),
  maxPlayers: z.number().int().min(2).max(12),
  seasonYear: z.number().int().min(2020).max(2030),
  season: z.enum(["WINTER", "SPRING", "SUMMER", "FALL"]),
});

export type CreateLeagueInput = z.infer<typeof createLeagueSchema>;

export const joinLeagueSchema = z.object({
  inviteCode: z.string().length(8, "Invite code must be 8 characters"),
});

export type JoinLeagueInput = z.infer<typeof joinLeagueSchema>;
