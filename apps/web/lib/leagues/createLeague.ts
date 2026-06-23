import { eq } from "drizzle-orm";
import { inviteCodes, leagueMembers, leagues, type Db } from "@anidraft/db";
import { generateInviteCode, type CreateLeagueInput } from "@anidraft/shared";

/**
 * Create-league domain logic, kept free of any HTTP/Next concerns so it can be
 * driven by the `POST /api/leagues` route handler and exercised directly in
 * tests against an in-memory database.
 *
 * The whole creation is one transaction: a league, its commissioner membership,
 * and (for private leagues) an invite code either all land or none do — a
 * half-created league with no commissioner would be unreachable.
 */

/**
 * Pick-timer seconds forced on a public ("lobby") league. Public leagues run on
 * stripped, non-negotiable settings so lobby games are uniform; the
 * commissioner cannot lengthen or shorten the timer later. Private leagues keep
 * the schema default (60s) and may be tuned in the settings editor (separate
 * issue).
 */
export const PUBLIC_PICK_TIMER_SECONDS = 90;

/** How many times we retry on the astronomically rare invite-code collision. */
const INVITE_CODE_MAX_ATTEMPTS = 5;

export interface CreateLeagueResult {
  /** The new league's id. */
  leagueId: string;
  /** The generated invite code for a private league; `null` for a public one. */
  inviteCode: string | null;
}

/**
 * Persist a new league owned by `commissionerId`.
 *
 * - Inserts the `leagues` row (starting in `setup`); public leagues get the
 *   forced {@link PUBLIC_PICK_TIMER_SECONDS} timer.
 * - Adds the creator to `league_members` as the `commissioner`.
 * - For a private league, generates a unique invite code and stores it.
 *
 * @throws if a unique invite code cannot be generated after several attempts.
 */
export async function createLeague(
  db: Db,
  commissionerId: string,
  input: CreateLeagueInput,
): Promise<CreateLeagueResult> {
  const isPublic = input.visibility === "public";

  return db.transaction(async (tx) => {
    const [league] = await tx
      .insert(leagues)
      .values({
        name: input.name,
        visibility: input.visibility,
        commissionerId,
        season: input.season,
        seasonYear: input.seasonYear,
        maxPlayers: input.maxPlayers,
        // Public leagues are locked to the stripped lobby timer; private
        // leagues fall back to the column default (60s).
        ...(isPublic ? { pickTimerSeconds: PUBLIC_PICK_TIMER_SECONDS } : {}),
        draftStartsAt: input.draftStartsAt ?? null,
        // `status` defaults to "setup" in the schema.
      })
      .returning({ id: leagues.id });

    if (!league) {
      throw new Error("Failed to create league");
    }

    await tx.insert(leagueMembers).values({
      leagueId: league.id,
      userId: commissionerId,
      role: "commissioner",
    });

    let inviteCode: string | null = null;
    if (!isPublic) {
      for (let attempt = 0; attempt < INVITE_CODE_MAX_ATTEMPTS; attempt++) {
        const candidate = generateInviteCode();
        const existing = await tx
          .select({ code: inviteCodes.code })
          .from(inviteCodes)
          .where(eq(inviteCodes.code, candidate))
          .limit(1);
        if (existing.length === 0) {
          await tx
            .insert(inviteCodes)
            .values({ code: candidate, leagueId: league.id });
          inviteCode = candidate;
          break;
        }
      }
      if (inviteCode === null) {
        throw new Error("Could not generate a unique invite code");
      }
    }

    return { leagueId: league.id, inviteCode };
  });
}
